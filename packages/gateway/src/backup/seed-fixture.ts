// Explicit opt-in fixture for the disposable backup integration stack only.
import { newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import * as Minio from 'minio';
import { getDb } from '../db/connection.js';
import { agentMemories, knowledgeBases, knowledgeDocuments, users } from '../db/schema.js';
import { getEnv } from '../env.js';
import { ensureMemoryCollection, upsertMemory } from '../lib/memory-store.js';
import { ensureCollection, upsertChunks } from '../lib/qdrant.js';
import { VECTOR_SIZE } from '../lib/rag-config.js';

if (
  process.env.NODE_ENV !== 'test' ||
  process.env.BACKUP_TEST_FIXTURE !== '1' ||
  process.env.PUBLIC_HOST !== 'backup-fixture.invalid'
)
  throw new Error('fixture_requires_disposable_test_stack');
const api = async (path: string, token?: string, body?: unknown) => {
  const response = await fetch(`http://gateway:3000/api/v1${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('fixture_api_failed');
  return response.json();
};
const registration = await api('/auth/register', undefined, {
  username: 'backup-fixture',
  password: 'test-only-password',
  device_id: 'backup-test',
});
const owner = registration.user.id as string;
const response = await fetch('http://gateway:3000/api/v1/agents/me/llm-keys', {
  method: 'PUT',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${registration.access_token}`,
  },
  body: JSON.stringify({ provider: 'openai', api_key: 'fixture-secret-must-survive-restore' }),
});
if (!response.ok) throw new Error('fixture_key_failed');
const kb = newId(),
  doc = newId(),
  memory = newId();
const object = 'knowledge/space and 文档.txt';
const text = 'Encrypted backup proof: 文档 + vectors + database';
await getDb()
  .insert(knowledgeBases)
  .values({ id: kb, user_id: owner, name: 'Backup fixture', shared_with_peers: true });
await getDb()
  .insert(knowledgeDocuments)
  .values({
    id: doc,
    kb_id: kb,
    user_id: owner,
    filename: '文档.txt',
    status: 'ready',
    storage_key: object,
    chunk_count: 1,
    size_bytes: Buffer.byteLength(text),
    content_type: 'text/plain',
  });
await getDb()
  .insert(agentMemories)
  .values({ id: memory, user_id: owner, title: 'Backup fixture', content: text, source: 'manual' });
const env = getEnv();
const client = new Minio.Client({
  endPoint: env.MINIO_ENDPOINT,
  port: env.MINIO_PORT,
  useSSL: false,
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY,
});
if (!(await client.bucketExists(env.MINIO_BUCKET))) await client.makeBucket(env.MINIO_BUCKET);
await client.putObject(env.MINIO_BUCKET, object, Buffer.from(text), Buffer.byteLength(text), {
  'Content-Type': 'text/plain',
});
const vector = new Array(VECTOR_SIZE).fill(0);
vector[0] = 1;
await ensureCollection();
await ensureMemoryCollection();
await upsertChunks([
  {
    chunk_id: newId(),
    kb_id: kb,
    kb_name: 'Backup fixture',
    doc_id: doc,
    doc_name: '文档.txt',
    user_id: owner,
    text,
    chunk_index: 0,
    vector,
    provider: 'openai',
    lang: 'en',
  },
]);
await upsertMemory({
  memoryId: memory,
  userId: owner,
  text,
  vector,
  provider: 'openai',
  source: 'manual',
});
const row = await getDb().select().from(users).where(eq(users.id, owner));
if (!row[0]?.llm_keys_json) throw new Error('fixture_not_ready');
console.log('backup fixture ready');
process.exit(0);
