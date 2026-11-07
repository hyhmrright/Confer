import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { PassThrough, Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MAGIC = Buffer.from('CFRB1\n');
export interface FileProof {
  file: string;
  bytes: number;
  sha256: string;
}
export async function loadKey(path: string): Promise<Buffer> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
    throw new Error('backup_key_permissions');
  const hex = (await readFile(path, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error('invalid_backup_key');
  return Buffer.from(hex, 'hex');
}
export async function createKey(path: string): Promise<void> {
  await writeFile(path, `${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
}
export async function encryptFile(
  path: string,
  key: Buffer,
  source: Readable,
): Promise<Omit<FileProof, 'file'>> {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  const hash = createHash('sha256');
  let bytes = 0;
  const transform = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      try {
        bytes += chunk.length;
        hash.update(chunk);
        done(null, cipher.update(chunk));
      } catch (error) {
        done(error as Error);
      }
    },
    final(done) {
      try {
        this.push(cipher.final());
        this.push(cipher.getAuthTag());
        done();
      } catch (error) {
        done(error as Error);
      }
    },
  });
  transform.push(Buffer.concat([MAGIC, iv]));
  try {
    await pipeline(source, transform, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
  } catch (error) {
    await unlink(path).catch(() => {});
    throw error;
  }
  return { bytes, sha256: hash.digest('hex') };
}
export async function decryptFile(path: string, key: Buffer): Promise<Readable> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 34)
    throw new Error('invalid_backup_file');
  const file = await open(path, 'r');
  const header = Buffer.alloc(18);
  const tag = Buffer.alloc(16);
  try {
    await file.read(header, 0, 18, 0);
    await file.read(tag, 0, 16, stat.size - 16);
  } finally {
    await file.close();
  }
  if (!header.subarray(0, 6).equals(MAGIC)) throw new Error('invalid_backup_format');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(6));
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  const input =
    stat.size === 34
      ? Readable.from([])
      : createReadStream(path, { start: 18, end: stat.size - 17 });
  const output = new PassThrough();
  void pipeline(input, decipher, output).catch((error) => output.destroy(error));
  return output;
}
export async function hashStream(source: Readable): Promise<Omit<FileProof, 'file'>> {
  const hash = createHash('sha256');
  let bytes = 0;
  await pipeline(
    source,
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        bytes += chunk.length;
        hash.update(chunk);
        done();
      },
    }),
  );
  return { bytes, sha256: hash.digest('hex') };
}
export async function readSealedJson(path: string, key: Buffer): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of await decryptFile(path, key)) {
    bytes += chunk.length;
    if (bytes > 32 * 1024 * 1024) throw new Error('backup_manifest_too_large');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
