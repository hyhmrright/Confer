interface CacheStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export async function cacheStorage(): Promise<CacheStorage> {
  if (!('__TAURI_INTERNALS__' in window)) {
    return {
      getItem: async (key) => localStorage.getItem(key),
      setItem: async (key, value) => localStorage.setItem(key, value),
      removeItem: async (key) => localStorage.removeItem(key),
      keys: async () =>
        Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(
          (key): key is string => key !== null,
        ),
    };
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return {
    getItem: (key) => invoke('message_cache', { operation: { op: 'get', key } }),
    setItem: (key, value) => invoke('message_cache', { operation: { op: 'set', key, value } }),
    removeItem: (key) => invoke('message_cache', { operation: { op: 'remove', key } }),
    keys: () => invoke('message_cache', { operation: { op: 'keys' } }),
  };
}
