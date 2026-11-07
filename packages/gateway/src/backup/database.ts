import { createHash } from 'node:crypto';
import { getTableColumns, getTableName, gt, sql } from 'drizzle-orm';
import { alias, pgSchema, pgTable, text } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { getDb } from '../db/connection.js';
import * as schema from '../db/schema.js';
import type { tableProof } from './manifest.js';

type TableProof = z.infer<typeof tableProof>;
export async function hashTable(
  input: Pick<TableProof, 'schema' | 'name' | 'primary'>,
): Promise<TableProof> {
  const original =
    input.schema === 'public'
      ? pgTable(input.name, { cursor: text(input.primary) })
      : pgSchema(input.schema).table(input.name, { cursor: text(input.primary) });
  const source = alias(original, 'backup_row');
  const hash = createHash('sha256');
  let rows = 0;
  let cursor: string | number | undefined;
  for (;;) {
    const page = await getDb()
      .select({ value: sql<string>`to_jsonb(${source})::text` })
      .from(source)
      .where(cursor === undefined ? undefined : gt(source.cursor, String(cursor)))
      .orderBy(source.cursor)
      .limit(500);
    for (const row of page) {
      hash.update(row.value);
      hash.update('\n');
      rows++;
      const parsed = JSON.parse(row.value) as Record<string, unknown>;
      const value = parsed[input.primary];
      if (typeof value !== 'string' && typeof value !== 'number')
        throw new Error('unsupported_backup_primary_key');
      cursor = value;
    }
    if (page.length < 500) break;
  }
  return { ...input, rows, sha256: hash.digest('hex') };
}
export async function databaseProofs(): Promise<TableProof[]> {
  const results: TableProof[] = [];
  for (const table of Object.values(schema)) {
    const columns = getTableColumns(table);
    const primary = 'id' in columns ? columns.id : 'key' in columns ? columns.key : undefined;
    if (!primary) throw new Error('unsupported_backup_table');
    results.push(
      await hashTable({ schema: 'public', name: getTableName(table), primary: primary.name }),
    );
  }
  // Production backups require the migration journal, never silently skip it.
  results.push(await hashTable({ schema: 'drizzle', name: '__drizzle_migrations', primary: 'id' }));
  return results;
}
