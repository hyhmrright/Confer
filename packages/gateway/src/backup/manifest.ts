import { z } from 'zod';

const proof = z.object({
  file: z.string().regex(/^[a-z][a-z0-9-]*\.enc$/),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const tableProof = z.object({
  schema: z.enum(['public', 'drizzle']),
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/),
  primary: z.string().regex(/^[a-z_][a-z0-9_]*$/),
  rows: z.number().int().nonnegative(),
  sha256: z.string(),
});
export const dataManifest = z.object({
  version: z.literal(1),
  tables: z.array(tableProof),
  recovery: proof,
  bucket: z.string(),
  objects: z.array(proof.extend({ key: z.string(), metadata: z.record(z.string(), z.string()) })),
  collections: z.array(
    proof.extend({
      name: z.string(),
      points: z.number().int(),
      points_sha256: z.string(),
      config: z.unknown(),
    }),
  ),
  aliases: z.array(z.object({ collection_name: z.string(), alias_name: z.string() })),
});
export const snapshotManifest = z.object({
  version: z.literal(1),
  created_at: z.string().datetime(),
  source_commit: z.string(),
  images: z.object({
    postgres: z.string(),
    qdrant: z.string(),
    minio: z.string(),
    gateway: z.string(),
  }),
  data: dataManifest,
  data_file: proof,
  database: proof,
  image_archive: proof,
});
export type DataManifest = z.infer<typeof dataManifest>;
export type SnapshotManifest = z.infer<typeof snapshotManifest>;
export const recoverySchema = z.object({
  ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string(),
  PUBLIC_HOST: z.string(),
  MINIO_BUCKET: z.string(),
  ADMIN_USERNAMES: z.string(),
  TAVILY_API_KEY: z.string(),
  RERANK_ENABLED: z.boolean(),
});
