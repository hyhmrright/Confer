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

// Published in `.env.example`, so anyone who has read the repository can sign
// an access token for any account on an instance still using it — admins
// included. `cp .env.example .env` is the documented way to start.
const PLACEHOLDER_JWT_SECRET = 'change-me-in-production';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  // HS256: the secret is the whole of what stands between a guessed user id and
  // a working token for it. 32 characters is the floor, and the placeholder is
  // refused outright rather than warned about — a warning is a log line on an
  // instance that is already forgeable.
  JWT_SECRET: z
    .string()
    .min(32, 'must be at least 32 characters; generate one with `openssl rand -hex 32`')
    .refine(
      (value) => value !== PLACEHOLDER_JWT_SECRET,
      'is the published placeholder; generate one with `openssl rand -hex 32`',
    ),
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
  // Rerank knowledge-base hits with the agent's own model: retrieve
  // RECALL_DEPTH, then narrow to RERANK_TO. Off by default, and measurement
  // has now undercut it twice over. A local 27B took 15-28s per call and did
  // not actually rerank — it echoed the input order back, and at 20 candidates
  // returned []. More decisively, the recall headroom that justified it is an
  // artifact of a weak embedding model: under nomic-embed-text same-language
  // recall goes 84% → 100% between depth 5 and 20, but under GLM it is already
  // 100% at depth 5, so there is no ranking problem left to fix.
  // Before enabling, run `bun run eval:rag --rerank` against the model you
  // actually serve. It costs an extra model call per knowledge-base search.
  // prefault, not default: same reason as MINIO_USE_SSL.
  RERANK_ENABLED: z
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
