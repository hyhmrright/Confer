// Runs inside a one-shot gateway image: never starts an API or rehosts identities.
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { decrypt, type EncryptedValue } from '@confer/shared';
import { eq } from 'drizzle-orm';
import * as jose from 'jose';
import * as Minio from 'minio';
import { getDb } from '../db/connection.js';
import { a2aPushConfigs, keypairs, peerCredentials, users } from '../db/schema.js';
import { getEnv } from '../env.js';
import {
  canonical,
  decryptFile,
  encryptFile,
  hashStream,
  loadKey,
  readSealedJson,
} from './crypto.js';
import { databaseProofs, hashTable } from './database.js';
import { type DataManifest, dataManifest, recoverySchema } from './manifest.js';

const directory = process.env.BACKUP_DIRECTORY ?? '/backup';
const key = await loadKey(process.env.BACKUP_KEY_FILE ?? '/backup-key');
async function qdrant(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${process.env.QDRANT_URL}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!response.ok) throw new Error('qdrant_backup_operation_failed');
  return ((await response.json()) as { result: unknown }).result;
}
function objectClient() {
  return new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT ?? 'minio',
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY ?? '',
    secretKey: process.env.MINIO_SECRET_KEY ?? '',
  });
}
async function pointProof(name: string) {
  const hash = createHash('sha256');
  let points = 0;
  let offset: unknown;
  for (;;) {
    const result = (await qdrant(`/collections/${encodeURIComponent(name)}/points/scroll`, 'POST', {
      limit: 128,
      with_vector: true,
      with_payload: true,
      ...(offset === undefined ? {} : { offset }),
    })) as { points: unknown[]; next_page_offset?: unknown };
    for (const point of result.points) {
      hash.update(canonical(point));
      hash.update('\n');
      points++;
    }
    if (result.next_page_offset === null || result.next_page_offset === undefined) break;
    offset = result.next_page_offset;
  }
  return { points, points_sha256: hash.digest('hex') };
}
async function collectionConfig(name: string) {
  const result = (await qdrant(`/collections/${encodeURIComponent(name)}`)) as {
    config: unknown;
    payload_schema: Record<string, { data_type: unknown; params?: unknown }>;
  };
  return {
    config: result.config,
    indexes: Object.fromEntries(
      Object.entries(result.payload_schema).map(([field, index]) => [
        field,
        { data_type: index.data_type, params: index.params },
      ]),
    ),
  };
}
async function exportData(): Promise<void> {
  const env = getEnv();
  const manifest: DataManifest = {
    version: 1,
    tables: await databaseProofs(),
    recovery: { file: 'recovery.enc', bytes: 0, sha256: '' },
    bucket: env.MINIO_BUCKET,
    objects: [],
    collections: [],
    aliases: [],
  };
  manifest.recovery = {
    file: 'recovery.enc',
    ...(await encryptFile(
      join(directory, 'recovery.enc'),
      key,
      Readable.from([JSON.stringify(recoverySchema.parse(env))]),
    )),
  };
  const collections = (await qdrant('/collections')) as { collections: { name: string }[] };
  for (const [index, collection] of collections.collections.entries()) {
    const path = `/collections/${encodeURIComponent(collection.name)}/snapshots`;
    const snapshot = (await qdrant(`${path}?wait=true`, 'POST')) as { name: string };
    try {
      const response = await fetch(
        `${env.QDRANT_URL}${path}/${encodeURIComponent(snapshot.name)}`,
        { signal: AbortSignal.timeout(10 * 60_000) },
      );
      if (!response.ok || !response.body) throw new Error('snapshot_download_failed');
      const file = `qdrant-${index}.enc`;
      const proof = await encryptFile(join(directory, file), key, Readable.from(response.body));
      manifest.collections.push({
        name: collection.name,
        file,
        ...proof,
        ...(await pointProof(collection.name)),
        config: await collectionConfig(collection.name),
      });
    } finally {
      await qdrant(`${path}/${encodeURIComponent(snapshot.name)}?wait=true`, 'DELETE');
    }
  }
  const aliases = (await qdrant('/aliases')) as { aliases: DataManifest['aliases'] };
  manifest.aliases = aliases.aliases;
  const client = objectClient();
  if (await client.bucketExists(env.MINIO_BUCKET)) {
    for await (const item of client.listObjectsV2(env.MINIO_BUCKET, '', true)) {
      if (item.name === undefined) continue;
      const file = `object-${manifest.objects.length}.enc`;
      const stat = await client.statObject(env.MINIO_BUCKET, item.name);
      const proof = await encryptFile(
        join(directory, file),
        key,
        await client.getObject(env.MINIO_BUCKET, item.name),
      );
      const metadata = Object.fromEntries(
        Object.entries(stat.metaData).filter(
          (pair): pair is [string, string] => typeof pair[1] === 'string',
        ),
      );
      manifest.objects.push({ key: item.name, metadata, file, ...proof });
    }
  }
  await encryptFile(join(directory, 'data.enc'), key, Readable.from([JSON.stringify(manifest)]));
}
async function verifySecrets(encryptionKey: string): Promise<number> {
  const db = getDb();
  let total = 0;
  const check = async (value: unknown) => {
    if (value === null || value === undefined) return;
    const opened = await decrypt(value as EncryptedValue, encryptionKey);
    if (!opened.ok) throw new Error('restored_secret_decryption_failed');
    total++;
  };
  for (const user of await db.select().from(users)) {
    for (const value of Object.values((user.llm_keys_json as Record<string, unknown>) ?? {}))
      await check(value);
    await check(user.totp_secret_json);
  }
  for (const row of await db.select().from(keypairs)) await check(row.private_key_jwk_encrypted);
  for (const row of await db.select().from(a2aPushConfigs)) await check(row.token_json);
  for (const row of await db.select().from(peerCredentials)) await check(row.token_json);
  return total;
}
async function restoreData(): Promise<void> {
  // The host has authenticated every encrypted file before any restore starts.
  const manifest = dataManifest.parse(await readSealedJson(join(directory, 'data.enc'), key));
  const recovery = recoverySchema.parse(await readSealedJson(join(directory, 'recovery.enc'), key));
  Object.assign(process.env, recovery);
  for (const collection of manifest.collections) {
    const temp = join(tmpdir(), `${randomUUID()}.snapshot`);
    try {
      await pipeline(
        await decryptFile(join(directory, collection.file), key),
        createWriteStream(temp, { flags: 'wx', mode: 0o600 }),
      );
      const form = new FormData();
      form.append('snapshot', Bun.file(temp), 'restore.snapshot');
      const response = await fetch(
        `${process.env.QDRANT_URL}/collections/${encodeURIComponent(collection.name)}/snapshots/upload?wait=true&priority=snapshot`,
        { method: 'POST', body: form, signal: AbortSignal.timeout(10 * 60_000) },
      );
      if (!response.ok) throw new Error('snapshot_restore_failed');
    } finally {
      await rm(temp, { force: true });
    }
    const actual = await pointProof(collection.name);
    if (
      actual.points !== collection.points ||
      actual.points_sha256 !== collection.points_sha256 ||
      canonical(await collectionConfig(collection.name)) !== canonical(collection.config)
    )
      throw new Error('restored_vectors_mismatch');
  }
  if (manifest.aliases.length)
    await qdrant('/collections/aliases', 'POST', {
      actions: manifest.aliases.map((alias) => ({ create_alias: alias })),
    });
  const client = objectClient();
  if (!(await client.bucketExists(manifest.bucket))) await client.makeBucket(manifest.bucket);
  for (const object of manifest.objects) {
    await client.putObject(
      manifest.bucket,
      object.key,
      await decryptFile(join(directory, object.file), key),
      object.bytes,
      object.metadata,
    );
    const stat = await client.statObject(manifest.bucket, object.key);
    if (Object.entries(object.metadata).some(([name, value]) => stat.metaData[name] !== value))
      throw new Error('restored_object_metadata_mismatch');
    const actual = await hashStream(await client.getObject(manifest.bucket, object.key));
    if (actual.sha256 !== object.sha256 || actual.bytes !== object.bytes)
      throw new Error('restored_object_mismatch');
  }
  for (const expected of manifest.tables) {
    const actual = await hashTable(expected);
    if (actual.rows !== expected.rows || actual.sha256 !== expected.sha256)
      throw new Error('restored_table_mismatch');
  }
  const secrets = await verifySecrets(recovery.ENCRYPTION_KEY);
  const { app } = await import('../app.js');
  if ((await app.request('/health')).status !== 200) throw new Error('restored_api_health_failed');
  const [owner] = await getDb().select().from(users).where(eq(users.status, 'active')).limit(1);
  if (owner) {
    const token = await new jose.SignJWT({ username: owner.username, typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(owner.id)
      .setIssuer(recovery.JWT_ISSUER)
      .setExpirationTime('1m')
      .sign(new TextEncoder().encode(recovery.JWT_SECRET));
    const response = await app.request('/api/v1/users/me', {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status !== 200 || (await response.json()).user.id !== owner.id)
      throw new Error('restored_authentication_failed');
  }
  console.log(
    JSON.stringify({
      restored: true,
      tables: manifest.tables.length,
      rows: manifest.tables.reduce((sum, t) => sum + t.rows, 0),
      collections: manifest.collections.length,
      points: manifest.collections.reduce((sum, c) => sum + c.points, 0),
      objects: manifest.objects.length,
      decrypted_secrets: secrets,
    }),
  );
}
try {
  await mkdir(directory, { recursive: true });
  if (process.argv[2] === 'export') await exportData();
  else if (process.argv[2] === 'restore') await restoreData();
  else throw new Error('unknown_backup_worker_command');
  process.exit(0);
} catch {
  console.error('backup_worker_failed');
  process.exit(1);
}
