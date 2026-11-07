import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { createGunzip, createGzip } from 'node:zlib';
import { z } from 'zod';
import {
  canonical,
  decryptFile,
  encryptFile,
  hashStream,
  loadKey,
  readSealedJson,
} from './crypto.js';
import { composeDocument, docker, dockerStream, processStream } from './docker.js';
import { dataManifest, type SnapshotManifest, snapshotManifest } from './manifest.js';
import { atomicJson, pruneVerified, scheduleSlot } from './policy.js';

export interface BackupOptions {
  root: string;
  compose: string;
  project?: string;
  directory: string;
  keyFile: string;
  keep: number;
  workerImage?: string;
}
export const composeArgs = (options: BackupOptions) => [
  'compose',
  '--project-directory',
  options.root,
  ...(options.project ? ['--project-name', options.project] : []),
  '-f',
  options.compose,
];
const healthSchema = z.object({
  backup_control: z.literal(1),
  instance_id: z.string(),
  generation: z.number().int(),
  maintenance: z.boolean(),
  ready: z.boolean(),
  lease_until: z.number(),
});
const health = async (options: BackupOptions) =>
  healthSchema.parse(
    JSON.parse(
      await docker(
        [
          ...composeArgs(options),
          'exec',
          '-T',
          'gateway',
          'bun',
          '-e',
          "const r=await fetch('http://127.0.0.1:'+(process.env.PORT??3000)+'/health');console.log(JSON.stringify(await r.json()))",
        ],
        10_000,
      ),
    ),
  );
const control = (options: BackupOptions, enabled: boolean) =>
  docker(
    [
      ...composeArgs(options),
      'exec',
      '-T',
      'gateway',
      'bun',
      '-e',
      `process.kill(1,'${enabled ? 'SIGUSR2' : 'SIGUSR1'}')`,
    ],
    10_000,
  );
const mount = (source: string, target: string, readonly = true) => [
  '--mount',
  `type=bind,source=${resolve(source)},target=${target}${readonly ? ',readonly' : ''}`,
];
const workerUser = () => `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
const workerArgs = (directory: string, keyFile: string) => [
  '--user',
  workerUser(),
  ...mount(directory, '/backup'),
  ...mount(keyFile, '/backup-key'),
];
async function waitForGateway(options: BackupOptions) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      return await health(options);
    } catch (error) {
      if (error instanceof z.ZodError) throw new Error('gateway_backup_control_unsupported');
      if (Date.now() > deadline) throw new Error('gateway_not_ready');
      await Bun.sleep(1000);
    }
  }
}
async function exportUsingRunningEnvironment(
  options: BackupOptions,
  directory: string,
  image: string,
) {
  const id = await docker([...composeArgs(options), 'ps', '-q', 'gateway']);
  const values = JSON.parse(
    await docker(['inspect', '--format', '{{json .Config.Env}}', id]),
  ) as string[];
  const environment = Object.fromEntries(
    values.map((value) => {
      const at = value.indexOf('=');
      return [value.slice(0, at), value.slice(at + 1)];
    }),
  );
  const names = Object.keys(
    JSON.parse(
      await docker(['inspect', '--format', '{{json .NetworkSettings.Networks}}', id]),
    ) as Record<string, unknown>,
  );
  if (!names.length) throw new Error('source_network_required');
  const networks = Object.fromEntries(
    names.map((name, index) => [`source${index}`, { external: true, name }]),
  );
  const config = {
    services: {
      worker: {
        image,
        user: workerUser(),
        environment: {
          ...environment,
          BACKUP_DIRECTORY: '/backup',
          BACKUP_KEY_FILE: '/backup-key',
        },
        volumes: [
          { type: 'bind', source: directory, target: '/backup' },
          { type: 'bind', source: options.keyFile, target: '/backup-key', read_only: true },
        ],
        networks: Object.keys(networks),
      },
    },
    networks,
  };
  const job = dockerStream(
    [
      'compose',
      '--project-directory',
      options.root,
      '--project-name',
      `confer-backup-worker-${randomUUID().slice(0, 8)}`,
      '-f',
      '-',
      'run',
      '--rm',
      '--no-deps',
      '-T',
      'worker',
      'bun',
      'run',
      'packages/gateway/src/backup/worker.ts',
      'export',
    ],
    Readable.from([composeDocument(config)]),
  );
  job.output.resume();
  await job.completed;
}
async function imageFor(options: BackupOptions, service: string): Promise<string> {
  const id = await docker([...composeArgs(options), 'ps', '-q', service]);
  if (!/^[a-f0-9]+$/.test(id)) throw new Error('source_service_not_running');
  const image = await docker(['inspect', '--format', '{{.Image}}', id]);
  return image;
}
async function safeFile(directory: string, name: string): Promise<string> {
  if (!/^[a-z][a-z0-9-]*\.enc$/.test(name)) throw new Error('invalid_backup_filename');
  const path = join(directory, name);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe_backup_file');
  return path;
}
export async function authenticateSnapshot(
  directory: string,
  keyFile: string,
): Promise<SnapshotManifest> {
  const key = await loadKey(keyFile);
  const manifest = snapshotManifest.parse(
    await readSealedJson(await safeFile(directory, 'manifest.enc'), key),
  );
  const files = [
    manifest.data_file,
    manifest.database,
    manifest.image_archive,
    manifest.data.recovery,
    ...manifest.data.collections,
    ...manifest.data.objects,
  ];
  if (new Set(files.map((file) => file.file)).size !== files.length)
    throw new Error('duplicate_backup_file');
  for (const file of files) {
    const proof = await hashStream(await decryptFile(await safeFile(directory, file.file), key));
    if (proof.sha256 !== file.sha256 || proof.bytes !== file.bytes)
      throw new Error('backup_integrity_failed');
  }
  if (
    canonical(await readSealedJson(join(directory, 'data.enc'), key)) !== canonical(manifest.data)
  )
    throw new Error('backup_manifest_mismatch');
  return manifest;
}
async function imageArchiveEntry(
  directory: string,
  manifest: SnapshotManifest,
  key: Buffer,
  name: string,
): Promise<unknown> {
  const input = await decryptFile(join(directory, manifest.image_archive.file), key);
  const gunzip = createGunzip();
  input.on('error', (error) => gunzip.destroy(error));
  const listing = processStream('tar', ['-xOf', '-', name], input.pipe(gunzip));
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of listing.output) {
    bytes += chunk.length;
    if (bytes > 4 * 1024 * 1024) {
      listing.stop();
      throw new Error('image_manifest_too_large');
    }
    chunks.push(Buffer.from(chunk));
  }
  await listing.completed;
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
async function validateImageArchive(directory: string, manifest: SnapshotManifest, key: Buffer) {
  const records = z
    .array(z.object({ Config: z.string() }))
    .parse(await imageArchiveEntry(directory, manifest, key, 'manifest.json'));
  const ids = records.map(
    (record) =>
      `sha256:${record.Config.split('/')
        .at(-1)
        ?.replace(/\.json$/, '')}`,
  );
  // Docker's classic store identifies configs; its containerd store identifies
  // OCI manifests/indexes. Both are present in modern docker-save archives.
  if (Object.values(manifest.images).some((id) => !ids.includes(id))) {
    const index = z
      .object({ manifests: z.array(z.object({ digest: z.string() })) })
      .parse(await imageArchiveEntry(directory, manifest, key, 'index.json'));
    ids.push(...index.manifests.map((item) => item.digest));
  }
  if (Object.values(manifest.images).some((id) => !ids.includes(id)))
    throw new Error('runtime_image_missing_from_archive');
}
export async function verifySnapshot(
  directory: string,
  options: BackupOptions,
): Promise<Record<string, unknown>> {
  await atomicJson(join(directory, 'verification.json'), {
    restored: false,
    verified_at: new Date().toISOString(),
  });
  const manifest = await authenticateSnapshot(directory, options.keyFile);
  const key = await loadKey(options.keyFile);
  const prefix = `confer-drill-${randomUUID().slice(0, 8)}`;
  const network = `${prefix}-net`;
  const containers: string[] = [];
  const worker = options.workerImage ?? manifest.images.gateway;
  const label = [
    '--label',
    'org.confer.backup.drill=true',
    '--label',
    `org.confer.backup.expires=${Date.now() + 2 * 60 * 60_000}`,
  ];
  await validateImageArchive(directory, manifest, key);
  const imageInput = await decryptFile(join(directory, manifest.image_archive.file), key);
  const gunzip = createGunzip();
  imageInput.on('error', (error) => gunzip.destroy(error));
  const loading = dockerStream(['load', '--quiet'], imageInput.pipe(gunzip));
  loading.output.resume();
  await loading.completed;
  for (const image of new Set([
    manifest.images.postgres,
    manifest.images.qdrant,
    manifest.images.minio,
    worker,
  ]))
    await docker(['image', 'inspect', image]);
  await docker(['network', 'create', '--internal', ...label, network]);
  try {
    for (const role of ['postgres', 'qdrant', 'minio'] as const) {
      const name = `${prefix}-${role}`;
      const env =
        role === 'postgres'
          ? [
              '-e',
              'POSTGRES_USER=confer',
              '-e',
              'POSTGRES_DB=confer',
              '-e',
              'POSTGRES_PASSWORD=restore-only-secret',
            ]
          : role === 'minio'
            ? [
                '-e',
                'MINIO_ROOT_USER=restore-only-key',
                '-e',
                'MINIO_ROOT_PASSWORD=restore-only-secret',
              ]
            : [];
      await docker([
        'run',
        '-d',
        '--name',
        name,
        '--network',
        network,
        '--network-alias',
        role,
        ...label,
        ...env,
        manifest.images[role],
        ...(role === 'minio' ? ['server', '/data'] : []),
      ]);
      containers.push(name);
    }
    const deadline = Date.now() + 90_000;
    for (;;) {
      try {
        await docker(['exec', `${prefix}-postgres`, 'pg_isready', '-U', 'confer'], 10_000);
        await docker(
          [
            'run',
            '--rm',
            '--network',
            network,
            ...label,
            worker,
            'bun',
            '-e',
            "for(const u of ['http://qdrant:6333/healthz','http://minio:9000/minio/health/live']){const r=await fetch(u);if(!r.ok)process.exit(1)}",
          ],
          10_000,
        );
        break;
      } catch {
        if (Date.now() > deadline) throw new Error('restore_services_not_ready');
        await Bun.sleep(1000);
      }
    }
    const restoring = dockerStream(
      [
        'exec',
        '-i',
        `${prefix}-postgres`,
        'pg_restore',
        '-U',
        'confer',
        '-d',
        'confer',
        '--no-owner',
        '--no-privileges',
        '--exit-on-error',
      ],
      await decryptFile(join(directory, manifest.database.file), key),
    );
    restoring.output.resume();
    await restoring.completed;
    const output = await docker([
      'run',
      '--rm',
      '--network',
      network,
      ...label,
      ...workerArgs(directory, options.keyFile),
      '-e',
      'DATABASE_URL=postgres://confer:restore-only-secret@postgres:5432/confer',
      '-e',
      'NODE_ENV=test',
      '-e',
      'QDRANT_URL=http://qdrant:6333',
      '-e',
      'MINIO_ENDPOINT=minio',
      '-e',
      'MINIO_PORT=9000',
      '-e',
      'MINIO_ACCESS_KEY=restore-only-key',
      '-e',
      'MINIO_SECRET_KEY=restore-only-secret',
      worker,
      'bun',
      'run',
      'packages/gateway/src/backup/worker.ts',
      'restore',
    ]);
    const line = output.split('\n').findLast((value) => value.startsWith('{'));
    const report = z
      .object({
        restored: z.literal(true),
        tables: z.number(),
        rows: z.number(),
        collections: z.number(),
        points: z.number(),
        objects: z.number(),
        decrypted_secrets: z.number(),
      })
      .parse(JSON.parse(line ?? 'null'));
    const result = { ...report, verified_at: new Date().toISOString() };
    await atomicJson(join(directory, 'verification.json'), result);
    return result;
  } finally {
    // Fresh names and an internal network only; never attach to source volumes.
    await cleanupSandbox(containers, network);
  }
}
async function cleanupSandbox(containers: string[], network: string) {
  const failures: unknown[] = [];
  for (const name of [...containers].reverse()) {
    try {
      await docker(['rm', '-fv', name]);
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await docker(['network', 'rm', network]);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length) throw new Error('restore_sandbox_cleanup_failed');
}
export async function captureSnapshot(options: BackupOptions): Promise<string> {
  const key = await loadKey(options.keyFile);
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const name = `snapshot-${new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')}-${randomUUID().replaceAll('-', '').slice(0, 8)}`;
  const directory = join(options.directory, `.partial-${name}`);
  await mkdir(directory, { mode: 0o700 });
  const initial = await waitForGateway(options); // Check support BEFORE sending a signal to PID 1.
  if (initial.maintenance) throw new Error('gateway_already_in_maintenance');
  let captured: Omit<SnapshotManifest, 'image_archive'> | undefined;
  let heartbeat = Promise.resolve();
  let leaseFailed = false;
  let generation = -1;
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    await control(options, true);
    generation = (await health(options)).generation;
    timer = setInterval(() => {
      heartbeat = heartbeat
        .then(async () => {
          const before = await health(options);
          if (
            !before.maintenance ||
            before.instance_id !== initial.instance_id ||
            before.generation !== generation
          ) {
            leaseFailed = true;
            return;
          }
          await control(options, true);
          const h = await health(options);
          if (h.instance_id !== initial.instance_id || h.generation !== generation)
            leaseFailed = true;
        })
        .catch(() => {
          leaseFailed = true;
        });
    }, 30_000);
    const deadline = Date.now() + 120_000;
    for (;;) {
      const h = await health(options);
      if (h.instance_id !== initial.instance_id || h.generation !== generation)
        throw new Error('gateway_restarted_during_backup');
      if (h.ready) break;
      if (Date.now() > deadline) throw new Error('gateway_drain_timeout');
      await Bun.sleep(1000);
    }
    const images = {
      postgres: await imageFor(options, 'postgres'),
      qdrant: await imageFor(options, 'qdrant'),
      minio: await imageFor(options, 'minio'),
      gateway: await imageFor(options, 'gateway'),
    };
    const dump = dockerStream([
      ...composeArgs(options),
      'exec',
      '-T',
      'postgres',
      'pg_dump',
      '-U',
      'confer',
      '-d',
      'confer',
      '--format=custom',
    ]);
    const [database] = await Promise.all([
      encryptFile(join(directory, 'postgres.enc'), key, dump.output),
      dump.completed,
    ]);
    await exportUsingRunningEnvironment(options, directory, images.gateway);
    const current = await health(options);
    if (
      leaseFailed ||
      !current.ready ||
      current.instance_id !== initial.instance_id ||
      current.generation !== generation
    )
      throw new Error('backup_consistency_lease_lost');
    const data = dataManifest.parse(await readSealedJson(join(directory, 'data.enc'), key));
    const dataProof = await hashStream(await decryptFile(join(directory, 'data.enc'), key));
    const commit = await Bun.$`git -C ${options.root} rev-parse HEAD`.quiet().text();
    captured = {
      version: 1,
      created_at: new Date().toISOString(),
      source_commit: commit.trim(),
      images,
      data,
      data_file: { file: 'data.enc', ...dataProof },
      database: { file: 'postgres.enc', ...database },
    };
  } finally {
    if (timer) clearInterval(timer);
    await heartbeat;
    const current = await health(options);
    if (
      current.instance_id === initial.instance_id &&
      (generation < 0 || current.generation === generation)
    )
      await control(options, false);
  }
  if (!captured) throw new Error('backup_capture_incomplete');
  // Save immutable runtime image IDs after admitting traffic again. The archive
  // supports recovery even if registries disappear or old local images are pruned.
  const saving = dockerStream(['save', ...new Set(Object.values(captured.images))]);
  const gzip = createGzip({ level: 6 });
  saving.output.on('error', (error) => gzip.destroy(error));
  const [archive] = await Promise.all([
    encryptFile(join(directory, 'images.enc'), key, saving.output.pipe(gzip)),
    saving.completed,
  ]);
  await encryptFile(
    join(directory, 'manifest.enc'),
    key,
    Readable.from([
      JSON.stringify({ ...captured, image_archive: { file: 'images.enc', ...archive } }),
    ]),
  );
  // Service is already available while the isolated recovery is exercised.
  const report = await verifySnapshot(directory, options);
  const destination = join(options.directory, name);
  await rename(directory, destination);
  await atomicJson(join(options.directory, 'status.json'), {
    success: true,
    completed_at: new Date().toISOString(),
    slot: scheduleSlot(),
    snapshot: name,
    report,
  });
  await pruneVerified(options.directory, options.keep);
  return destination;
}
/** Reclaim only our expired, disposable drill resources after a killed job. */
export async function cleanupExpiredDrills(): Promise<void> {
  const ids = (await docker(['ps', '-aq', '--filter', 'label=org.confer.backup.drill=true']))
    .split('\n')
    .filter(Boolean);
  for (const id of ids) {
    const expires = Number(
      await docker([
        'inspect',
        '--format',
        '{{index .Config.Labels "org.confer.backup.expires"}}',
        id,
      ]),
    );
    if (expires > 0 && expires < Date.now()) await docker(['rm', '-fv', id]);
  }
  const networks = (
    await docker(['network', 'ls', '-q', '--filter', 'label=org.confer.backup.drill=true'])
  )
    .split('\n')
    .filter(Boolean);
  for (const network of networks) {
    const expires = Number(
      await docker([
        'network',
        'inspect',
        '--format',
        '{{index .Labels "org.confer.backup.expires"}}',
        network,
      ]),
    );
    if (expires > 0 && expires < Date.now()) await docker(['network', 'rm', network]);
  }
}
export async function withBackupLock<T>(
  options: BackupOptions,
  operation: () => Promise<T>,
): Promise<T | undefined> {
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const path = join(options.directory, '.lock');
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('unsafe_backup_lock');
    let stale = Date.now() - stat.mtimeMs > 2 * 60 * 60_000;
    try {
      const { pid } = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8')) as {
        pid: number;
      };
      try {
        process.kill(pid, 0);
        stale = false;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ESRCH') stale = true;
      }
    } catch {
      /* A newly acquired lock may not have written its owner yet. */
    }
    if (!stale) return undefined;
    await rm(path, { recursive: true });
    return withBackupLock(options, operation);
  }
  try {
    await atomicJson(join(path, 'owner.json'), { pid: process.pid });
    return await operation();
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}
