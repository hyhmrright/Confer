import { describe, expect, test } from 'bun:test';
import { loadConfig } from './config.js';

const base = { CONFER_USERNAME: 'alice', CONFER_PASSWORD: 'secret' };

describe('loadConfig', () => {
  test('populates config from a complete env', () => {
    const cfg = loadConfig({
      ...base,
      CONFER_GATEWAY_URL: 'http://gw:3000',
      CONFER_CONSULT_WAIT: '40',
    });
    expect(cfg).toEqual({
      gatewayUrl: 'http://gw:3000',
      username: 'alice',
      password: 'secret',
      defaultWaitSeconds: 40,
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
});
