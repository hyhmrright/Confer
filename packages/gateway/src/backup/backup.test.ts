import { afterEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { backupOptions } from './cli.js';
import { canonical, createKey, decryptFile, encryptFile, hashStream, loadKey } from './crypto.js';
import { composeDocument } from './docker.js';
import { withBackupLock } from './operations.js';
import { atomicJson, pruneIncomplete, pruneVerified, scheduleSlot } from './policy.js';
import { schedulerArguments, xmlEscape } from './scheduler.js';

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function temp() {
  const root = await mkdtemp(join(tmpdir(), 'confer-backup-test-'));
  folders.push(root);
  return root;
}

describe('authenticated streaming backups', () => {
  test('round-trips large and empty streams, with independent nonces and no plaintext on disk', async () => {
    const root = await temp();
    const key = randomBytes(32);
    const secret = Buffer.from('private contents\n'.repeat(100000));
    const expected = await encryptFile(join(root, 'data.enc'), key, Readable.from([secret]));
    expect(await hashStream(await decryptFile(join(root, 'data.enc'), key))).toEqual(expected);
    expect((await readFile(join(root, 'data.enc'))).includes(Buffer.from('private contents'))).toBe(
      false,
    );
    await encryptFile(join(root, 'again.enc'), key, Readable.from([secret]));
    expect(
      (await readFile(join(root, 'data.enc'))).equals(await readFile(join(root, 'again.enc'))),
    ).toBe(false);
    const empty = await encryptFile(join(root, 'empty.enc'), key, Readable.from([]));
    expect(await hashStream(await decryptFile(join(root, 'empty.enc'), key))).toEqual(empty);
  });
  test('fails closed for wrong keys, truncated files and tampered ciphertext/tags', async () => {
    const root = await temp();
    const key = randomBytes(32);
    const path = join(root, 'data.enc');
    await encryptFile(path, key, Readable.from(['protected']));
    await expect(hashStream(await decryptFile(path, randomBytes(32)))).rejects.toThrow();
    const bytes = await readFile(path);
    for (const index of [18, bytes.length - 1]) {
      const changed = Buffer.from(bytes);
      changed[index] = (changed[index] ?? 0) ^ 1;
      await writeFile(join(root, 'bad.enc'), changed);
      await expect(hashStream(await decryptFile(join(root, 'bad.enc'), key))).rejects.toThrow();
    }
    await writeFile(join(root, 'short.enc'), bytes.subarray(0, 20));
    await expect(decryptFile(join(root, 'short.enc'), key)).rejects.toThrow();
  });
  test('keys are private, never overwritten, and symlinked keys are refused', async () => {
    const root = await temp();
    const path = join(root, 'key');
    await createKey(path);
    expect((await loadKey(path)).length).toBe(32);
    await expect(createKey(path)).rejects.toThrow();
    await symlink(path, join(root, 'link'));
    await expect(loadKey(join(root, 'link'))).rejects.toThrow('permissions');
  });
});

test('03:00 Shanghai scheduling survives host timezone, midnight and missed days', () => {
  expect(scheduleSlot(new Date('2026-11-06T18:59:59Z'))).toBe('2026-11-06');
  expect(scheduleSlot(new Date('2026-11-06T19:00:00Z'))).toBe('2026-11-07');
  expect(scheduleSlot(new Date('2027-01-01T00:00:00+08:00'))).toBe('2026-12-31');
});
test('retention removes only older verified restore points and preserves unrelated files', async () => {
  const root = await temp();
  for (let n = 1; n <= 4; n++) {
    const name = `snapshot-2026110${n}T030000Z-abcdef00`;
    await mkdir(join(root, name));
    await atomicJson(join(root, name, 'verification.json'), { restored: n !== 4 });
  }
  await mkdir(join(root, 'do-not-touch'));
  await pruneVerified(root, 2);
  expect(
    await readFile(join(root, 'snapshot-20261102T030000Z-abcdef00', 'verification.json'), 'utf8'),
  ).toContain('true');
  await expect(
    readFile(join(root, 'snapshot-20261101T030000Z-abcdef00', 'verification.json')),
  ).rejects.toThrow();
  expect(
    await readFile(join(root, 'snapshot-20261104T030000Z-abcdef00', 'verification.json'), 'utf8'),
  ).toContain('false');
  expect(
    await import('node:fs/promises').then((fs) => fs.stat(join(root, 'do-not-touch'))),
  ).toBeDefined();
});
test('configuration keeps raw keys separate from archives and scheduler metadata contains paths only', async () => {
  expect(() =>
    backupOptions(['--directory', '/tmp/archives', '--key', '/tmp/archives/key']),
  ).toThrow('separate');
  const options = backupOptions(['--directory', '/tmp/backups', '--key', '/tmp/key']);
  expect(JSON.parse(await readFile(join(options.root, 'package.json'), 'utf8')).name).toBe(
    'confer',
  );
  expect(schedulerArguments(options)).toContain('scheduled');
  expect(schedulerArguments(options)).toContain('/tmp/key');
  expect(xmlEscape('a & <b>')).toBe('a &amp; &lt;b&gt;');
  expect(canonical({ b: 2, a: 1 })).toBe(canonical({ a: 1, b: 2 }));
});

test('backup locks reject overlap, preserve a live owner and recover an abandoned process lock', async () => {
  const root = await temp();
  const options = backupOptions(['--directory', join(root, 'backups'), '--key', join(root, 'key')]);
  let release: () => void = () => {};
  let started: () => void = () => {};
  const running = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const first = withBackupLock(options, async () => {
    started();
    await running;
    return 'first';
  });
  await entered;
  expect(
    await withBackupLock(options, async () => {
      throw new Error('overlap');
    }),
  ).toBeUndefined();
  const lock = join(options.directory, '.lock');
  await utimes(lock, new Date(0), new Date(0));
  expect(
    await withBackupLock(options, async () => {
      throw new Error('live owner removed');
    }),
  ).toBeUndefined();
  release();
  expect(await first).toBe('first');
  await mkdir(lock);
  await atomicJson(join(lock, 'owner.json'), { pid: 2000000000 });
  expect(await withBackupLock(options, async () => 'recovered')).toBe('recovered');
});
test('failed export retention keeps two encrypted attempts without following symlinks', async () => {
  const root = await temp();
  for (let n = 1; n <= 3; n++)
    await mkdir(join(root, `.partial-snapshot-2026110${n}T030000Z-abcdef00`));
  await symlink(root, join(root, '.partial-snapshot-20261104T030000Z-abcdef00'));
  await pruneIncomplete(root);
  const fs = await import('node:fs/promises');
  expect((await fs.readdir(root)).filter((name) => name.startsWith('.partial-')).length).toBe(3);
  expect(
    (await fs.lstat(join(root, '.partial-snapshot-20261104T030000Z-abcdef00'))).isSymbolicLink(),
  ).toBe(true);
});

test('Compose interpolation cannot alter runtime credentials containing dollar signs', () => {
  const placeholder = '$' + '{value}';
  const value = { environment: { JWT_SECRET: `a${placeholder}b$literal$$` } };
  expect(JSON.parse(composeDocument(value)).environment.JWT_SECRET).toBe(
    `a$${placeholder}b$$literal$$$$`,
  );
});
