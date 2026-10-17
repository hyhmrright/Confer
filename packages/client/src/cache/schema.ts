import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const messageSnapshots = sqliteTable('message_snapshots', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
