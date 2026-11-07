#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKey, loadKey } from './crypto.js';
import {
  type BackupOptions,
  captureSnapshot,
  cleanupExpiredDrills,
  verifySnapshot,
  withBackupLock,
} from './operations.js';
import { atomicJson, pruneIncomplete, scheduleSlot } from './policy.js';
import { installSchedule } from './scheduler.js';

export function backupOptions(args: string[]): BackupOptions {
  const option = (name: string) => {
    const index = args.indexOf(`--${name}`);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error('missing_option_value');
    return value;
  };
  const root = resolve(option('root') ?? fileURLToPath(new URL('../../../../', import.meta.url)));
  const compose = resolve(root, option('compose') ?? 'docker-compose.prod.yml');
  const id = createHash('sha256')
    .update(compose)
    .update(option('project') ?? '')
    .digest('hex')
    .slice(0, 12);
  const directory = resolve(
    option('directory') ?? join(homedir(), '.local', 'share', 'confer', 'backups', id),
  );
  const keyFile = resolve(
    option('key') ?? join(homedir(), '.config', 'confer', 'backup', `${id}.key`),
  );
  const checkoutRelative = relative(root, keyFile);
  const outside = (path: string) =>
    isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`);
  if (!outside(checkoutRelative)) throw new Error('backup_key_must_be_outside_checkout');
  if ([directory, keyFile].some((path) => path.includes(':') || path.includes(',')))
    throw new Error('unsupported_backup_path');
  const keyRelative = relative(directory, keyFile);
  if (!outside(keyRelative)) throw new Error('backup_key_must_be_separate');
  const keep = Number(option('keep') ?? '7');
  if (!Number.isInteger(keep) || keep < 1 || keep > 365) throw new Error('invalid_retention');
  return {
    root,
    compose,
    directory,
    keyFile,
    keep,
    project: option('project'),
    workerImage: option('worker-image'),
  };
}
async function initialize(options: BackupOptions) {
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(options.directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
    throw new Error('backup_directory_permissions');
  try {
    await loadKey(options.keyFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (
      (await readdir(options.directory)).some(
        (name) => name.startsWith('snapshot-') || name.startsWith('.partial-snapshot-'),
      )
    )
      throw new Error('backup_key_missing_for_existing_snapshots');
    await mkdir(dirname(options.keyFile), { recursive: true, mode: 0o700 });
    await createKey(options.keyFile);
  }
}
async function readStatus(options: BackupOptions): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(join(options.directory, 'status.json'), 'utf8')) as Record<
      string,
      unknown
    >;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
      throw error;
    return {};
  }
}
async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);
  const options = backupOptions(args);
  if (command === 'status') {
    console.log(
      JSON.stringify(
        { directory: options.directory, key_file: options.keyFile, ...(await readStatus(options)) },
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'verify') {
    const snapshot = args[0];
    if (!snapshot || snapshot.startsWith('--')) throw new Error('snapshot_directory_required');
    const report = await verifySnapshot(resolve(snapshot), options);
    console.log(JSON.stringify(report));
    return;
  }
  if (command === 'install') {
    await initialize(options);
    const installed = await installSchedule(options);
    console.log(JSON.stringify(installed));
    return;
  }
  if (command !== 'backup' && command !== 'scheduled')
    throw new Error('usage_backup_install_status_verify');
  await initialize(options);
  if (command === 'scheduled') {
    const previous = await readStatus(options);
    if (previous.success && previous.slot === scheduleSlot()) return;
  }
  await withBackupLock(options, async () => {
    try {
      await cleanupExpiredDrills();
      const path = await captureSnapshot(options);
      console.log(JSON.stringify({ backup: path, verified: true }));
    } catch (error) {
      const previous = await readStatus(options);
      await atomicJson(join(options.directory, 'status.json'), {
        ...previous,
        success: false,
        last_attempt_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'backup_failed',
      });
      throw error;
    } finally {
      await pruneIncomplete(options.directory);
    }
  });
}
if (import.meta.main)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'backup_failed');
    process.exit(1);
  });
