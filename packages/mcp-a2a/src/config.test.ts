import { describe, expect, test } from 'bun:test';
import { basename } from 'node:path';
import { loadConfig } from './config.js';

const base = { CONFER_USERNAME: 'alice', CONFER_PASSWORD: 'secret' };

describe('loadConfig', () => {
  test('populates config from a complete env', () => {
    const cfg = loadConfig({
      ...base,
      CONFER_GATEWAY_URL: 'http://gw:3000',
      CONFER_CONSULT_WAIT: '40',
      CONFER_PROJECT_ID: 'my-project',
    });
    expect(cfg).toEqual({
      gatewayUrl: 'http://gw:3000',
      username: 'alice',
      password: 'secret',
      defaultWaitSeconds: 40,
      projectId: 'my-project',
    });
  });

  test('throws when CONFER_USERNAME is missing', () => {
    expect(() => loadConfig({ CONFER_PASSWORD: 'secret' })).toThrow(/CONFER_USERNAME/);
  });

  test('throws when CONFER_PASSWORD is missing', () => {
    expect(() => loadConfig({ CONFER_USERNAME: 'alice' })).toThrow(/CONFER_PASSWORD/);
  });

  test('defaults the consult wait to 25 seconds', () => {
    expect(loadConfig(base).defaultWaitSeconds).toBe(25);
  });

  test('parses an overridden consult wait', () => {
    expect(loadConfig({ ...base, CONFER_CONSULT_WAIT: '10' }).defaultWaitSeconds).toBe(10);
  });

  test('defaults the gateway url to localhost:3000', () => {
    expect(loadConfig(base).gatewayUrl).toBe('http://localhost:3000');
  });

  test('strips a trailing slash from the gateway url', () => {
    expect(loadConfig({ ...base, CONFER_GATEWAY_URL: 'http://gw:3000/' }).gatewayUrl).toBe(
      'http://gw:3000',
    );
  });

  test('defaults the project id to the cwd basename', () => {
    expect(loadConfig(base).projectId).toBe(basename(process.cwd()));
  });

  test('parses an overridden project id', () => {
    expect(loadConfig({ ...base, CONFER_PROJECT_ID: 'widgets' }).projectId).toBe('widgets');
  });

  // Claude Code passes the literal `${VAR}` from .mcp.json when the variable is
  // not exported, so each of these arrives looking like a real value. Built by
  // escaping rather than written out, so the shape stays exactly what the
  // plugin ships without reading as a forgotten template string.
  const unexpanded = (body: string) => `\${${body}}`;

  describe('unexpanded placeholders', () => {
    test('rejects a placeholder username', () => {
      expect(() =>
        loadConfig({ CONFER_USERNAME: unexpanded('CONFER_USERNAME'), CONFER_PASSWORD: 'secret' }),
      ).toThrow(/CONFER_USERNAME/);
    });

    test('rejects a placeholder password', () => {
      expect(() =>
        loadConfig({ CONFER_USERNAME: 'alice', CONFER_PASSWORD: unexpanded('CONFER_PASSWORD') }),
      ).toThrow(/CONFER_PASSWORD/);
    });

    test('falls back to the default gateway url', () => {
      const env = {
        ...base,
        CONFER_GATEWAY_URL: unexpanded('CONFER_GATEWAY_URL:-http://localhost:3000'),
      };
      expect(loadConfig(env).gatewayUrl).toBe('http://localhost:3000');
    });

    test('falls back to the default consult wait', () => {
      const env = { ...base, CONFER_CONSULT_WAIT: unexpanded('CONFER_CONSULT_WAIT:-25') };
      expect(loadConfig(env).defaultWaitSeconds).toBe(25);
    });

    test('falls back to the cwd basename for the project id', () => {
      const env = { ...base, CONFER_PROJECT_ID: unexpanded('CONFER_PROJECT_ID') };
      expect(loadConfig(env).projectId).toBe(basename(process.cwd()));
    });

    // Only a value that is entirely a placeholder counts as one — a password
    // that merely contains those characters is a real password.
    test('accepts a value that only contains placeholder characters', () => {
      const password = `pa${unexpanded('ss')}word`;
      expect(loadConfig({ CONFER_USERNAME: 'alice', CONFER_PASSWORD: password }).password).toBe(
        password,
      );
    });
  });
});
