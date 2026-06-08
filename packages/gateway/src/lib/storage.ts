import * as Minio from 'minio';
import { getEnv } from '../env.js';

const env = getEnv();

const client = new Minio.Client({
  endPoint: env.MINIO_ENDPOINT,
  port: env.MINIO_PORT,
  useSSL: env.MINIO_USE_SSL,
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY,
});

async function ensureBucket(): Promise<void> {
  const exists = await client.bucketExists(env.MINIO_BUCKET);
  if (!exists) await client.makeBucket(env.MINIO_BUCKET);
}

export async function putObject(key: string, buffer: Buffer, contentType: string): Promise<void> {
  await ensureBucket();
  await client.putObject(env.MINIO_BUCKET, key, buffer, buffer.length, {
    'Content-Type': contentType,
  });
}

export async function getObject(key: string): Promise<Buffer> {
  const stream = await client.getObject(env.MINIO_BUCKET, key);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

export async function removeObject(key: string): Promise<void> {
  await client.removeObject(env.MINIO_BUCKET, key);
}
