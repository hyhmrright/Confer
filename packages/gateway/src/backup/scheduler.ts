import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BackupOptions } from './operations.js';

function command(file: string, args: string[]) {
  return new Promise<void>((resolve, reject) =>
    execFile(file, args, { timeout: 30_000 }, (error) =>
      error ? reject(new Error('scheduler_install_failed')) : resolve(),
    ),
  );
}
export const xmlEscape = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
export function schedulerArguments(options: BackupOptions): string[] {
  return [
    process.execPath,
    fileURLToPath(new URL('./cli.ts', import.meta.url)),
    'scheduled',
    '--root',
    options.root,
    '--compose',
    options.compose,
    '--directory',
    options.directory,
    '--key',
    options.keyFile,
    '--keep',
    String(options.keep),
    ...(options.project ? ['--project', options.project] : []),
  ];
}
export async function installSchedule(options: BackupOptions) {
  const id = createHash('sha256').update(options.directory).digest('hex').slice(0, 12);
  const name = `io.confer.backup.${id}`;
  const args = schedulerArguments(options);
  // Polling plus the Shanghai backup-day calculation catches sleep/reboots and
  // retries failures without depending on the host scheduler's timezone.
  if (process.platform === 'darwin') {
    const folder = join(homedir(), 'Library', 'LaunchAgents');
    await mkdir(folder, { recursive: true });
    const path = join(folder, `${name}.plist`);
    const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${name}</string><key>ProgramArguments</key><array>${args.map((arg) => `<string>${xmlEscape(arg)}</string>`).join('')}</array><key>WorkingDirectory</key><string>${xmlEscape(options.root)}</string><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xmlEscape(process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin')}</string></dict><key>RunAtLoad</key><true/><key>StartInterval</key><integer>900</integer><key>StandardOutPath</key><string>${xmlEscape(join(options.directory, 'scheduler.log'))}</string><key>StandardErrorPath</key><string>${xmlEscape(join(options.directory, 'scheduler-error.log'))}</string></dict></plist>`;
    await writeFile(path, plist, { mode: 0o600 });
    const domain = `gui/${process.getuid?.()}`;
    await command('launchctl', ['bootout', `${domain}/${name}`]).catch(() => {});
    await command('launchctl', ['bootstrap', domain, path]);
    await command('launchctl', ['print', `${domain}/${name}`]);
    return {
      scheduler: 'launchd',
      name,
      path,
      timezone: 'Asia/Shanghai',
      hour: 3,
      interval_minutes: 15,
    };
  }
  if (process.platform === 'linux') {
    const folder = join(homedir(), '.config', 'systemd', 'user');
    await mkdir(folder, { recursive: true });
    // systemd has its own quoting/percent expansion, unrelated to shell quoting.
    const quote = (value: string) =>
      `"${value.replaceAll('%', '%%').replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
    await writeFile(
      join(folder, `${name}.service`),
      `[Unit]\nDescription=Confer encrypted backup and restore drill\n[Service]\nType=oneshot\nWorkingDirectory=${quote(options.root)}\nEnvironment=${quote(`PATH=${process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin'}`)}\nExecStart=${args.map(quote).join(' ')}\n`,
      { mode: 0o600 },
    );
    await writeFile(
      join(folder, `${name}.timer`),
      `[Unit]\nDescription=Confer daily backup with missed-run recovery\n[Timer]\nOnBootSec=2min\nOnUnitActiveSec=15min\n[Install]\nWantedBy=timers.target\n`,
      { mode: 0o600 },
    );
    await command('systemctl', ['--user', 'daemon-reload']);
    await command('systemctl', ['--user', 'enable', '--now', `${name}.timer`]);
    return {
      scheduler: 'systemd-user',
      name,
      timezone: 'Asia/Shanghai',
      hour: 3,
      interval_minutes: 15,
    };
  }
  throw new Error('automatic_backup_requires_launchd_or_systemd');
}
