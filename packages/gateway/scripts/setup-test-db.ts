// Builds a fresh schema in the isolated test database for gateway integration
// tests by applying every Drizzle migration SQL file in order against a clean
// `public` schema. Re-runnable: it drops and rebuilds the schema each time, so
// it doesn't depend on the migration tracking table.
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://confer:confer@127.0.0.1:5433/confer_test';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');

const sql = postgres(DATABASE_URL, { max: 1 });

await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');

const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
for (const file of files) {
  const ddl = (await readFile(join(migrationsDir, file), 'utf8')).replaceAll(
    '--> statement-breakpoint',
    '',
  );
  await sql.unsafe(ddl);
  console.log(`applied ${file}`);
}

await sql.end();
console.log(`Test schema ready (${files.length} migrations)`);
