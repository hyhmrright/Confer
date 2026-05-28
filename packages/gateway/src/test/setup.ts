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
