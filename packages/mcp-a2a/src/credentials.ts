import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export interface SavedCredentials {
  username: string;
  token: string;
}
const SERVICE = 'org.confer.mcp';

/** OS keychain only: credentials never enter project files or plugin config. */
export function readCredentials(gateway: string): SavedCredentials | null {
  try {
    const value =
      process.platform === 'darwin'
        ? execFileSync('security', ['find-generic-password', '-s', SERVICE, '-a', gateway, '-w'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          })
        : process.platform === 'linux'
          ? execFileSync('secret-tool', ['lookup', 'service', SERVICE, 'gateway', gateway], {
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'ignore'],
            })
          : process.platform === 'win32'
            ? windowsCredential(gateway)
            : null;
    if (!value) return null;
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { username, token } = parsed as Record<string, unknown>;
    return typeof username === 'string' && typeof token === 'string' ? { username, token } : null;
  } catch {
    return null;
  }
}

export function saveCredentials(gateway: string, credential: SavedCredentials): void {
  const value = JSON.stringify(credential);
  if (process.platform === 'darwin') {
    // `security -i` reads commands from stdin so the credential is absent from
    // argv/process listings. Quote for security's command parser, never a shell.
    const quote = (s: string) => `"${s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
    const result = spawnSync('security', ['-i'], {
      input: `add-generic-password -U -s ${quote(SERVICE)} -a ${quote(gateway)} -w ${quote(value)}\n`,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Interactive security can exit 0 after an individual command failed.
    if (result.status !== 0 || readCredentials(gateway)?.token !== credential.token) {
      throw new Error('Could not save the device credential to macOS Keychain.');
    }
  } else if (process.platform === 'linux') {
    const result = spawnSync(
      'secret-tool',
      ['store', '--label=Confer developer tool', 'service', SERVICE, 'gateway', gateway],
      {
        input: value,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    if (result.status !== 0)
      throw new Error('Install/unlock a Secret Service keyring and secret-tool, then retry.');
  } else if (process.platform === 'win32') {
    windowsCredential(gateway, value);
    if (readCredentials(gateway)?.token !== credential.token)
      throw new Error('Could not save the credential with Windows DPAPI.');
  } else {
    throw new Error(
      'OS credential storage is not available on this platform. Use CONFER_API_TOKEN.',
    );
  }
}

/** Windows DPAPI encrypts for the current OS user; no plaintext credential file. */
function windowsCredential(gateway: string, value?: string): string {
  const file = createHash('sha256').update(gateway).digest('hex');
  const setup = `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$directory = Join-Path $env:LOCALAPPDATA 'Confer/mcp-credentials'
$path = Join-Path $directory '${file}.dpapi'
`;
  const script =
    value === undefined
      ? `${setup}if (Test-Path $path) { $secret = [IO.File]::ReadAllText($path) | ConvertTo-SecureString; [Console]::Out.Write(([Net.NetworkCredential]::new('', $secret)).Password) }`
      : `${setup}[IO.Directory]::CreateDirectory($directory) | Out-Null
$plain = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(value).toString('base64')}'))
$encrypted = ConvertTo-SecureString $plain -AsPlainText -Force | ConvertFrom-SecureString
[IO.File]::WriteAllText($path, $encrypted)`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
    input: script,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) throw new Error('Windows credential storage failed.');
  return result.stdout.trim();
}
