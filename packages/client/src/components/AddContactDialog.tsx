import { useState } from 'react';
import { useContactsStore } from '../stores/contacts.js';

export default function AddContactDialog() {
  const { dialogOpen, closeDialog, lookupByDomain, addContact, loading, error } =
    useContactsStore();
  const [domain, setDomain] = useState('');
  const [results, setResults] = useState<Array<{ id: string; did: string; name?: string }>>([]);
  const [searching, setSearching] = useState(false);

  if (!dialogOpen) return null;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain.trim()) return;
    setSearching(true);
    try {
      const candidates = await lookupByDomain(domain.trim());
      setResults(candidates);
    } catch {
      setResults([]);
    }
    setSearching(false);
  };

  const handleClose = () => {
    setDomain('');
    setResults([]);
    closeDialog();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">添加联系人</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 text-xl">
            &times;
          </button>
        </div>

        <form onSubmit={handleSearch} className="flex gap-2 mb-4">
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="输入域名，如 acme.com"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            type="submit"
            disabled={searching}
            className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
          >
            {searching ? '搜索中...' : '搜索'}
          </button>
        </form>

        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

        {results.length > 0 ? (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {results.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center justify-between p-3 border border-gray-200 rounded-md"
              >
                <div>
                  <div className="text-sm font-medium">{agent.name ?? 'Unnamed agent'}</div>
                  <div className="text-xs text-gray-400">{agent.did}</div>
                </div>
                <button
                  onClick={() => addContact(agent.id)}
                  disabled={loading}
                  className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50"
                >
                  添加
                </button>
              </div>
            ))}
          </div>
        ) : (
          domain && !searching && (
            <p className="text-sm text-gray-400 text-center py-4">未找到 Agent</p>
          )
        )}
      </div>
    </div>
  );
}
