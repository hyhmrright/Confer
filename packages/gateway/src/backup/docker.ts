import { execFile, spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export function docker(args: string[], timeout = 20 * 60_000): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile('docker', args, { timeout, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`docker_${args[0]}_failed`, { cause: stderr }));
      else resolve(stdout.trim());
    }),
  );
}
/** No shell, and no database bodies/credentials in command logs or error text. */
export function processStream(binary: string, args: string[], input?: Readable) {
  const child = spawn(binary, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  if (!child.stdout || !child.stderr) throw new Error('docker_stream_unavailable');
  child.stderr.resume();
  const completed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 20 * 60_000);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('docker_stream_start_failed'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('docker_stream_failed'));
    });
  });
  const fed = input && child.stdin ? pipeline(input, child.stdin) : Promise.resolve();
  return {
    output: child.stdout,
    completed: Promise.all([completed, fed]),
    stop: () => child.kill('SIGTERM'),
  };
}

export function dockerStream(args: string[], input?: Readable) {
  return processStream('docker', args, input);
}

/** Compose interpolates dollar signs even inside JSON environment values. */
export function composeDocument(value: unknown): string {
  const protectValues = (item: unknown): unknown =>
    typeof item === 'string'
      ? item.replaceAll('$', () => '$$')
      : Array.isArray(item)
        ? item.map(protectValues)
        : item && typeof item === 'object'
          ? Object.fromEntries(
              Object.entries(item).map(([key, entry]) => [key, protectValues(entry)]),
            )
          : item;
  return JSON.stringify(protectValues(value));
}
