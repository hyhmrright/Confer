import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateSecrets,
  instanceUrl,
  parseArgs,
  renderEnvFile,
  stopFlags,
  storedDomain,
  validateDomain,
  withEnvValue,
} from './index.js';

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

describe('--domain', () => {
  test('is carried through and leaves the http port alone', () => {
    expect(ok(['--domain', 'confer.example.com'])).toMatchObject({
      domain: 'confer.example.com',
      port: 80,
    });
  });

  test('is absent unless asked for', () => {
    expect(ok([]).domain).toBeUndefined();
  });

  // Each of these is handed to Caddy as the name to obtain a certificate for,
  // and to the gateway as the authority it mints every DID from. A wrong one
  // fails late and obscurely, so it is refused here with the reason.
  test.each([
    ['https://confer.example.com', 'https://'],
    ['confer.example.com/app', 'path'],
    ['confer.example.com:8443', 'port'],
    ['localhost', 'public domain'],
    ['-bad.example.com', 'valid domain'],
  ])('rejects %s', (value, because) => {
    expect(validateDomain(value)).toContain(because);
    expect(parseArgs(['--domain', value])).toHaveProperty('error');
  });

  test('accepts a plain name', () => {
    expect(validateDomain('confer.example.com')).toBeUndefined();
    expect(validateDomain('a.b.c.co.uk')).toBeUndefined();
  });

  // Caddy binds 80 and 443 under TLS, so a --port would publish on a port
  // nothing serves. Refused rather than silently overridden.
  test('refuses --port alongside it', () => {
    const parsed = parseArgs(['--domain', 'confer.example.com', '--port', '8080']);
    expect((parsed as { error: string }).error).toContain('--port has no meaning with --domain');
  });
});

describe('withEnvValue', () => {
  test('replaces a value in place, leaving everything else', () => {
    const body = 'JWT_SECRET=a\nPUBLIC_HOST=localhost\nENCRYPTION_KEY=b\n';
    expect(withEnvValue(body, 'PUBLIC_HOST', 'confer.example.com')).toBe(
      'JWT_SECRET=a\nPUBLIC_HOST=confer.example.com\nENCRYPTION_KEY=b\n',
    );
  });

  test('appends when the key is absent', () => {
    expect(withEnvValue('JWT_SECRET=a\n', 'PUBLIC_HOST', 'x.example')).toBe(
      'JWT_SECRET=a\nPUBLIC_HOST=x.example\n',
    );
  });

  test('does not match a key that merely starts the same', () => {
    const body = 'PUBLIC_HOSTNAME=keep\n';
    expect(withEnvValue(body, 'PUBLIC_HOST', 'x.example')).toBe(
      'PUBLIC_HOSTNAME=keep\nPUBLIC_HOST=x.example\n',
    );
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

describe('storedDomain', () => {
  function envDir(body: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'confer-cli-env-'));
    writeFileSync(join(dir, '.env'), body);
    return dir;
  }

  test('reads back what up --domain recorded', () => {
    expect(storedDomain(envDir('PUBLIC_HOST=x.example\nCONFER_DOMAIN=x.example\n'))).toBe(
      'x.example',
    );
  });

  // PUBLIC_HOST answers a different question — it is legitimately localhost, an
  // IP, or a domain — so TLS must not be inferred from it. Inferring would
  // compose the TLS overlay for anyone who set it to a bare IP.
  test('does not infer TLS from PUBLIC_HOST alone', () => {
    expect(storedDomain(envDir('PUBLIC_HOST=203.0.113.4\n'))).toBeUndefined();
    expect(storedDomain(envDir('PUBLIC_HOST=confer.example.com\n'))).toBeUndefined();
    expect(storedDomain(envDir('PUBLIC_HOST=localhost\n'))).toBeUndefined();
  });

  test('is undefined when there is no instance there', () => {
    expect(storedDomain(join(tmpdir(), 'confer-cli-nothing-here'))).toBeUndefined();
  });
});

describe('instanceUrl', () => {
  test('is https at the domain when there is one', () => {
    expect(instanceUrl({ domain: 'confer.example.com', port: 80 })).toBe(
      'https://confer.example.com',
    );
  });

  test('drops the default port and keeps any other', () => {
    expect(instanceUrl({ port: 80 })).toBe('http://localhost');
    expect(instanceUrl({ port: 8080 })).toBe('http://localhost:8080');
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

// Nothing in-process can exercise the entry guard: it turns on module identity
// and process.argv, which are fixed by the time a test runs. So build the real
// bundle and run it the way npm installs it. 0.3.1 shipped with this broken —
// the guard compared an unresolved argv[1] against a resolved import.meta.url,
// so `npx confer-cli` did nothing at all and still exited 0.
describe('the binary the CLI ships', () => {
  test('does its job when invoked through a bin symlink', () => {
    const dir = mkdtempSync(join(tmpdir(), 'confer-cli-entry-'));
    try {
      const bundle = join(dir, 'confer.mjs');
      const built = spawnSync(
        'bun',
        ['build', join(import.meta.dir, 'index.ts'), '--target=node', '--outfile', bundle],
        { encoding: 'utf8' },
      );
      expect(built.status).toBe(0);

      // What `npm install` creates: node_modules/.bin/confer -> the real file.
      const shim = join(dir, 'confer');
      symlinkSync(bundle, shim);

      const ran = spawnSync('node', [shim, '--help'], { encoding: 'utf8' });
      expect(ran.status).toBe(0);
      expect(ran.stdout).toContain('run a self-hosted Confer instance');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

// `--domain` composes this on top of the file above, so it ships too.
describe('the TLS overlay the CLI ships', () => {
  const overlay = readFileSync(
    join(import.meta.dir, '..', '..', '..', 'docker-compose.tls.yml'),
    'utf8',
  );

  test('adds the TLS terminator', () => {
    expect(overlay).toContain('\n  caddy:');
    expect(overlay).toContain('"443:443"');
  });

  test('takes the published port away from the client', () => {
    // Both would otherwise bind 80. Compose MERGES sequences, so only an
    // explicit !override empties the base file's list — a bare `ports: []`
    // here would leave the collision in place.
    expect(overlay).toContain('ports: !override []');
  });

  test('demands a domain rather than defaulting to one', () => {
    // `${PUBLIC_HOST:-localhost}` here would have Caddy issue itself an
    // untrusted certificate for "localhost" and report success.
    expect(overlay).toContain('${PUBLIC_HOST:?');
    expect(overlay).not.toContain('${PUBLIC_HOST:-');
  });
});
