import { randomUUID } from 'node:crypto';
import { lstat, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SNAPSHOT_NAME = /^snapshot-\d{8}T\d{6}Z-[a-f0-9]{8}$/;
/** A local 03:00 backup day, independent of the OS scheduler's timezone. */
export function scheduleSlot(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const date = new Date(
    Date.UTC(value('year'), value('month') - 1, value('day') - (value('hour') < 3 ? 1 : 0)),
  );
  return date.toISOString().slice(0, 10);
}
export async function atomicJson(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await rename(temp, path);
}
export async function pruneVerified(directory: string, keep: number): Promise<void> {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('invalid_retention');
  const verified: string[] = [];
  for (const name of await readdir(directory)) {
    if (
      !SNAPSHOT_NAME.test(name) ||
      !(await lstat(join(directory, name))).isDirectory() ||
      (await lstat(join(directory, name))).isSymbolicLink()
    )
      continue;
    try {
      const report: unknown = JSON.parse(
        await readFile(join(directory, name, 'verification.json'), 'utf8'),
      );
      if (report && typeof report === 'object' && 'restored' in report && report.restored === true)
        verified.push(name);
    } catch {
      /* Unverified backups never displace a good restore point. */
    }
  }
  for (const name of verified.sort().reverse().slice(keep))
    await rm(join(directory, name), { recursive: true });
}

/** Bound failed encrypted exports without removing any verified restore point. */
export async function pruneIncomplete(directory: string): Promise<void> {
  const names: string[] = [];
  for (const name of await readdir(directory)) {
    if (!name.startsWith('.partial-') || !SNAPSHOT_NAME.test(name.slice(9))) continue;
    const stat = await lstat(join(directory, name));
    if (stat.isDirectory() && !stat.isSymbolicLink()) names.push(name);
  }
  for (const name of names.sort().reverse().slice(2))
    await rm(join(directory, name), { recursive: true });
}
