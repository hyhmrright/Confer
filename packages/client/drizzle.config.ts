import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/cache/schema.ts',
  out: './src-tauri/cache-migrations',
  dialect: 'sqlite',
});
