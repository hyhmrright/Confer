// Separate Docker project: never uses the developer's dev/test/prod database.
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createKey, loadKey, readSealedJson } from '../src/backup/crypto.js';
import { composeDocument, docker } from '../src/backup/docker.js';
import {
  authenticateSnapshot,
  type BackupOptions,
  captureSnapshot,
  composeArgs,
} from '../src/backup/operations.js';

const root = resolve(import.meta.dir, '../../..');
const folder = await mkdtemp(join(tmpdir(), 'confer-backup-integration-'));
const compose = join(folder, 'compose.json');
const source = Bun.YAML.parse(await readFile(join(root, 'docker-compose.prod.yml'), 'utf8')) as {
  services: Record<string, { image: string }>;
};
const image = process.env.BACKUP_TEST_IMAGE ?? 'confer-backup-candidate:latest';
const environment = {
  DATABASE_URL: 'postgres://confer:fixture-only-secret@postgres:5432/confer',
  JWT_SECRET: 'backup-fixture-$literal-secret-0123456789012345',
  ENCRYPTION_KEY: '0'.repeat(64),
  NODE_ENV: 'test',
  HOST: '0.0.0.0',
  PORT: '3000',
  PUBLIC_HOST: 'backup-fixture.invalid',
  QDRANT_URL: 'http://qdrant:6333',
  MINIO_ENDPOINT: 'minio',
  MINIO_PORT: '9000',
  MINIO_ACCESS_KEY: 'fixture-only-key',
  MINIO_SECRET_KEY: 'fixture-only-secret',
  MINIO_BUCKET: 'knowledge-docs',
};
const config = {
  services: {
    postgres: {
      image: source.services.postgres?.image,
      environment: {
        POSTGRES_USER: 'confer',
        POSTGRES_PASSWORD: 'fixture-only-secret',
        POSTGRES_DB: 'confer',
      },
      healthcheck: {
        test: ['CMD-SHELL', 'pg_isready -U confer'],
        interval: '1s',
        timeout: '3s',
        retries: 40,
      },
    },
    qdrant: { image: source.services.qdrant?.image },
    minio: {
      image: source.services.minio?.image,
      environment: {
        MINIO_ROOT_USER: 'fixture-only-key',
        MINIO_ROOT_PASSWORD: 'fixture-only-secret',
      },
      command: ['server', '/data'],
    },
    gateway: {
      image,
      environment,
      depends_on: {
        postgres: { condition: 'service_healthy' },
        qdrant: { condition: 'service_started' },
        minio: { condition: 'service_started' },
      },
    },
  },
};
await writeFile(compose, composeDocument(config), { mode: 0o600 });
const options: BackupOptions = {
  root,
  compose,
  project: `confer-backup-test-${randomUUID().slice(0, 8)}`,
  directory: join(folder, 'backups'),
  keyFile: join(folder, 'backup.key'),
  keep: 2,
};
await mkdir(options.directory, { mode: 0o700 });
await createKey(options.keyFile);
const command = (...args: string[]) => docker([...composeArgs(options), ...args]);
try {
  await command('up', '-d', '--wait', 'postgres', 'qdrant', 'minio');
  await command(
    'run',
    '--rm',
    '-T',
    '--no-deps',
    '-w',
    '/app/packages/gateway',
    'gateway',
    'bun',
    'run',
    'src/db/migrate.ts',
  );
  await command('up', '-d', 'gateway');
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      await command(
        'exec',
        '-T',
        'gateway',
        'bun',
        '-e',
        "const r=await fetch('http://127.0.0.1:3000/health');if(!r.ok)process.exit(1)",
      );
      break;
    } catch {
      if (Date.now() > deadline) throw new Error('fixture_gateway_not_ready');
      await Bun.sleep(1000);
    }
  }
  await command(
    'run',
    '--rm',
    '-T',
    '--no-deps',
    '-e',
    'BACKUP_TEST_FIXTURE=1',
    'gateway',
    'bun',
    'run',
    'packages/gateway/src/backup/seed-fixture.ts',
  );
  const liveJwt = environment.JWT_SECRET;
  Object.assign(config.services.gateway.environment, {
    JWT_SECRET: 'fresh-compose-but-not-running-secret-012345',
    ENCRYPTION_KEY: '1'.repeat(64),
  });
  await writeFile(compose, composeDocument(config), { mode: 0o600 });
  const snapshot = await captureSnapshot(options);
  const status = JSON.parse(await readFile(join(options.directory, 'status.json'), 'utf8')) as {
    report: { points: number; objects: number; decrypted_secrets: number };
  };
  if (
    status.report.points !== 2 ||
    status.report.objects !== 1 ||
    status.report.decrypted_secrets < 3
  )
    throw new Error('fixture_restore_proof_incomplete');
  const manifest = await authenticateSnapshot(snapshot, options.keyFile);
  if (
    !manifest.data.tables.some(
      (table) =>
        table.schema === 'drizzle' && table.name === '__drizzle_migrations' && table.rows > 0,
    )
  )
    throw new Error('migration_journal_not_verified');
  const restoredConfig = (await readSealedJson(
    join(snapshot, 'recovery.enc'),
    await loadKey(options.keyFile),
  )) as { JWT_SECRET: string; ENCRYPTION_KEY: string };
  if (restoredConfig.JWT_SECRET !== liveJwt || restoredConfig.ENCRYPTION_KEY !== '0'.repeat(64))
    throw new Error('runtime_configuration_not_preserved');
  const object = manifest.data.objects[0];
  if (!object) throw new Error('fixture_object_missing');
  const path = join(snapshot, object.file);
  const original = await readFile(path);
  const changed = Buffer.from(original);
  changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
  await writeFile(path, changed);
  let refused = false;
  try {
    await authenticateSnapshot(snapshot, options.keyFile);
  } catch {
    refused = true;
  } finally {
    await writeFile(path, original);
  }
  if (!refused) throw new Error('corrupt_backup_accepted');
  const wrong = join(folder, 'wrong.key');
  await createKey(wrong);
  refused = false;
  try {
    await authenticateSnapshot(snapshot, wrong);
  } catch {
    refused = true;
  }
  if (!refused) throw new Error('wrong_backup_key_accepted');
  // Force a fast export failure AFTER drain; the original service must resume.
  Object.assign(config.services.gateway.environment, {
    JWT_SECRET: liveJwt,
    ENCRYPTION_KEY: '0'.repeat(64),
    MINIO_SECRET_KEY: 'incorrect-fixture-secret',
  });
  await writeFile(compose, composeDocument(config), { mode: 0o600 });
  await command('up', '-d', '--no-deps', 'gateway');
  refused = false;
  try {
    await captureSnapshot(options);
  } catch {
    refused = true;
  }
  if (!refused) throw new Error('failed_export_was_published');
  await command(
    'exec',
    '-T',
    'gateway',
    'bun',
    '-e',
    "const h=await(await fetch('http://127.0.0.1:3000/health')).json();if(h.maintenance)process.exit(1)",
  );
  await authenticateSnapshot(snapshot, options.keyFile);
  console.log(
    'backup integration passed: full restore, exact rows/vectors/objects, decryptable credentials, corruption rejection, failure recovery',
  );
} finally {
  await command('down', '-v', '--remove-orphans');
  await rm(folder, { recursive: true, force: true });
}
