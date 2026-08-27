import { z } from 'zod';
import { parsePublicHost } from './lib/public-host.js';

// Every DID this instance mints is built from PUBLIC_HOST, so a value that
// cannot be parsed would mint identities no peer can resolve — silently, and
// permanently for every account created meanwhile. Fail at startup instead.
function isParsableHost(value: string): boolean {
  try {
    return parsePublicHost(value).hostname.length > 0;
  } catch {
    return false;
  }
}

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  JWT_ISSUER: z.string().default('confer'),
  // Comma-separated usernames promoted to the 'admin' role on gateway startup
  // (idempotent — already-admin accounts are skipped). This is how the first
  // admin is bootstrapped; the value is operator config, not a secret.
  // NOTE for ops: add ADMIN_USERNAMES to .env.example and the deploy docs.
  ADMIN_USERNAMES: z.string().default(''),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_HOST: z
    .string()
    .refine(isParsableHost, 'must be a host[:port] this instance is reachable at')
    .default('localhost:3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ENCRYPTION_KEY: z.string().length(64),
  TAVILY_API_KEY: z.string().default(''),
  QDRANT_URL: z.string().default('http://localhost:6333'),
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().default(9000),
  // prefault, not default: the fallback is the raw env-var string and must run
  // through the transform. Zod 4's .default() takes the *output* type (boolean).
  MINIO_USE_SSL: z
    .string()
    .transform((v) => v === 'true')
    .prefault('false'),
  MINIO_ACCESS_KEY: z.string().default('confer'),
  MINIO_SECRET_KEY: z.string().default('confer-secret'),
  MINIO_BUCKET: z.string().default('knowledge-docs'),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | undefined;

export function getEnv(): Env {
  if (!_env) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      console.error('Invalid environment variables:', result.error.flatten().fieldErrors);
      process.exit(1);
    }
    _env = result.data;
  }
  return _env;
}
