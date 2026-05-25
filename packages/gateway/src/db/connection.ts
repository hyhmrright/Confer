import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getEnv } from '../env.js';
import * as schema from './schema.js';

let _db: ReturnType<typeof createDb> | undefined;

function createDb() {
  const sql = postgres(getEnv().DATABASE_URL);
  return drizzle(sql, { schema });
}

export function getDb() {
  if (!_db) {
    _db = createDb();
  }
  return _db;
}

export type Database = ReturnType<typeof getDb>;
