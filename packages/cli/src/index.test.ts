import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateSecrets, parseArgs, renderEnvFile, stopFlags } from './index.js';

function ok(argv: string[]) {
  const parsed = parseArgs(argv);
  if ('error' in parsed) throw new Error(`expected a parse, got: ${parsed.error}`);
  return parsed;
}

describe('parseArgs', () => {
  test('defaults to bringing the stack up on port 80', () => {
    const parsed = ok([]);
    expect(parsed.command).toBe('up');
    expect(parsed.port).toBe(80);
    expect(parsed.project).toBe('confer');
    expect(parsed.version).toBe('latest');
    expect(parsed.dir).toEndWith('.confer');
  });

  test('accepts a subcommand', () => {
    expect(ok(['down']).command).toBe('down');
    expect(ok(['logs']).command).toBe('logs');
  });

  test('reads flags written either way', () => {
    expect(ok(['--port=8080']).port).toBe(8080);
    expect(ok(['--port', '8080']).port).toBe(8080);
  });

  test('carries every override through', () => {
    const parsed = ok(['up', '--dir', '/tmp/x', '--project', 'other', '--version', 'v0.3.1']);
    expect(parsed).toMatchObject({ dir: '/tmp/x', project: 'other', version: 'v0.3.1' });
  });

  test('--help wins over everything else', () => {
    expect(ok(['down', '--help']).command).toBe('help');
  });

  test('rejects an unknown command', () => {
    expect(parseArgs(['restart'])).toEqual({
      error: 'unknown command "restart" — expected up, down or logs',
    });
  });

  test.each([['0'], ['70000'], ['http'], ['8080.5']])('rejects --port %s', (value) => {
    expect(parseArgs(['--port', value])).toHaveProperty('error');
  });

  test('rejects a flag with no value', () => {
    expect(parseArgs(['--port'])).toEqual({ error: '--port needs a value' });
  });

  test('refuses a misspelled flag rather than ignoring it', () => {
    // `--prot 8080` silently starting on port 80 is the failure this prevents.
    const parsed = parseArgs(['--prot', '8080']);
    expect(parsed).toHaveProperty('error');
    expect((parsed as { error: string }).error).toContain('unknown option --prot');
  });
});

describe('generateSecrets', () => {
  test('produces an ENCRYPTION_KEY the gateway will accept', () => {
    // env.ts requires exactly 64 characters and crypto.ts reads them as hex.
    const { encryptionKey } = generateSecrets();
    expect(encryptionKey).toMatch(/^[0-9a-f]{64}$/);
  });

  test('produces a JWT_SECRET past the 16-character minimum', () => {
    expect(generateSecrets().jwtSecret.length).toBeGreaterThanOrEqual(16);
  });

  test('never repeats itself', () => {
    const first = generateSecrets();
    const second = generateSecrets();
    expect(first.encryptionKey).not.toBe(second.encryptionKey);
    expect(first.jwtSecret).not.toBe(second.jwtSecret);
  });
});

describe('stopFlags', () => {
  test('says nothing when nothing has to be repeated', () => {
    const defaults = ok([]);
    expect(stopFlags(defaults)).toBe('');
  });

  test('echoes back the flags that locate this instance', () => {
    expect(stopFlags({ dir: '/tmp/x', project: 'other' })).toBe(' --dir /tmp/x --project other');
  });

  test('leaves out the port, which down does not need', () => {
    const parsed = ok(['--port', '8080']);
    expect(stopFlags(parsed)).toBe('');
  });
});

describe('renderEnvFile', () => {
  test('writes KEY=value lines and warns about the file', () => {
    const rendered = renderEnvFile({ JWT_SECRET: 'a', ENCRYPTION_KEY: 'b' });
    expect(rendered).toContain('\nJWT_SECRET=a\n');
    expect(rendered).toContain('\nENCRYPTION_KEY=b\n');
    expect(rendered.startsWith('#')).toBe(true);
    expect(rendered).toEndWith('\n');
  });
});

// The CLI ships a copy of the repo's compose file rather than its own, so these
// guard the one file both paths depend on.
describe('the compose file the CLI ships', () => {
  const compose = readFileSync(
    join(import.meta.dir, '..', '..', '..', 'docker-compose.ghcr.yml'),
    'utf8',
  );

  test('declares every service the CLI names', () => {
    for (const service of ['postgres', 'qdrant', 'minio', 'migrate', 'gateway', 'client']) {
      expect(compose).toContain(`\n  ${service}:`);
    }
  });

  test('builds nothing', () => {
    // `npx confer-cli` runs from ~/.confer, where there is no source tree. A
    // build: key here would send every user into a build that cannot succeed.
    expect(compose).not.toMatch(/^\s+build:/m);
  });

  // Compose's own interpolation syntax, built by escaping so it doesn't read
  // as a template string someone forgot to make a template.
  const interpolate = (body: string) => `\${${body}}`;

  test('honours the port and tag the CLI passes in', () => {
    expect(compose).toContain(`${interpolate('EXPOSE_PORT:-80')}:80`);
    expect(compose).toContain(interpolate('CONFER_VERSION:-latest'));
  });

  test('leaves the two secrets without defaults', () => {
    // A default here would ship every instance the same AES key.
    expect(compose).toContain(`JWT_SECRET: ${interpolate('JWT_SECRET')}`);
    expect(compose).toContain(`ENCRYPTION_KEY: ${interpolate('ENCRYPTION_KEY')}`);
  });
});
