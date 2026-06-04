import type { AppConfigValues } from '@confer/shared';
import { inArray } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { appConfig } from '../db/schema.js';

// Code-level defaults. A config key absent from the app_config table resolves to
// its default here, so an empty table is fully backward compatible.
const DEFAULTS: AppConfigValues = {
  registration_open: true,
  instance_name: 'Confer',
};

// Values are stored as TEXT; parse per key so booleans round-trip.
function parse<K extends keyof AppConfigValues>(key: K, raw: string): AppConfigValues[K] {
  if (key === 'registration_open') {
    return (raw === 'true') as AppConfigValues[K];
  }
  return raw as AppConfigValues[K];
}

// Read all config, falling back to defaults for any missing key.
export async function getAppConfig(): Promise<AppConfigValues> {
  const rows = await getDb()
    .select({ key: appConfig.key, value: appConfig.value })
    .from(appConfig)
    .where(inArray(appConfig.key, ['registration_open', 'instance_name']));

  const result: AppConfigValues = { ...DEFAULTS };
  for (const row of rows) {
    if (row.key === 'registration_open' || row.key === 'instance_name') {
      result[row.key] = parse(row.key, row.value) as never;
    }
  }
  return result;
}

// Read a single typed config value with default fallback.
export async function getConfigValue<K extends keyof AppConfigValues>(
  key: K,
): Promise<AppConfigValues[K]> {
  const all = await getAppConfig();
  return all[key];
}

// Upsert one config key. Used by the admin config route.
export async function setConfigValue<K extends keyof AppConfigValues>(
  key: K,
  value: AppConfigValues[K],
): Promise<void> {
  const serialized = String(value);
  await getDb()
    .insert(appConfig)
    .values({ key, value: serialized, updated_at: new Date() })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value: serialized, updated_at: new Date() },
    });
}
