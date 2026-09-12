import { mock } from 'bun:test';

// Preloaded before any gateway test (see bunfig.toml). Points the app at the
// isolated test backend stack (docker-compose.test.yml) and supplies the env
// vars getEnv() requires. Real env values (e.g. in CI) take precedence.
const TEST_ENV: Record<string, string> = {
  DATABASE_URL: 'postgres://confer:confer@127.0.0.1:5433/confer_test',
  QDRANT_URL: 'http://127.0.0.1:6335',
  MINIO_ENDPOINT: '127.0.0.1',
  MINIO_PORT: '9002',
  MINIO_USE_SSL: 'false',
  MINIO_ACCESS_KEY: 'confer',
  MINIO_SECRET_KEY: 'confer-secret',
  MINIO_BUCKET: 'knowledge-docs-test',
  JWT_SECRET: 'test-jwt-secret-0123456789',
  JWT_ISSUER: 'confer',
  ENCRYPTION_KEY: '0'.repeat(64),
  NODE_ENV: 'test',
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  if (!process.env[key]) process.env[key] = value;
}

// `mockFetch` (test/helpers.ts) intercepts every outbound request, but the SSRF
// guard in @confer/identity resolves a DID's host through node:dns *before* it
// fetches, with a 5s deadline — the same 5s bun gives a test. So every signed
// request here sent `peer.example` to the OS resolver, and a CI runner whose
// resolver sat on that NXDOMAIN turned into a timed-out test reporting a 401
// (`did_resolution_failed`): issue #75, once in 25 runs, never reproducible
// locally. Answer every name in-process instead. Fixture hosts land in
// TEST-NET-3 (RFC 5737, never routable); `localhost` keeps its loopback
// address because the contact lookup's guard is expected to refuse it. Only
// `lookup` is stubbed — the guard uses nothing else from the module.
const TEST_NET_ADDRESS = '203.0.113.10';

mock.module('node:dns/promises', () => ({
  lookup: async (hostname: string, options?: { all?: boolean }) => {
    const entry = { address: hostname === 'localhost' ? '127.0.0.1' : TEST_NET_ADDRESS, family: 4 };
    return options?.all ? [entry] : entry;
  },
}));
