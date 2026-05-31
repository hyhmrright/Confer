import { useState } from 'react';
import { useContactsStore } from '../stores/contacts.js';
import { Bot, Loader, Search, X } from './Icons.js';

export function AddContactDialog() {
  const { dialogOpen, closeDialog, lookupByDomain, addContact, loading, error } =
    useContactsStore();
  const [domain, setDomain] = useState('');
  const [results, setResults] = useState<
    Array<{ id: string; did: string; name?: string; description?: string }>
  >([]);
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
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800">添加联系人</h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-4">
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
              <input
                type="text"
                name="contact-domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="输入域名，如 acme.com"
                className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <button
              type="submit"
              disabled={searching || !domain.trim()}
              className="px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm hover:bg-primary-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              {searching ? <Loader className="w-3.5 h-3.5" /> : <Search className="w-3.5 h-3.5" />}
              搜索
            </button>
          </form>
        </div>

        {error && (
          <div className="mx-6 mb-3 px-3 py-2 bg-red-50 border border-red-100 rounded-lg">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        {/* Results */}
        <div className="px-6 pb-6">
          {results.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
              {results.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center gap-3 p-3 border border-gray-200 rounded-xl hover:border-gray-300 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                    <Bot className="w-5 h-5 text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800">
                      {agent.name ?? 'Unnamed agent'}
                    </div>
                    <div className="text-xs text-gray-400 truncate">{agent.did}</div>
                    {agent.description && (
                      <div className="text-xs text-gray-400 truncate mt-0.5">
                        {agent.description}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => addContact(agent.id)}
                    disabled={loading}
                    className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors shrink-0"
                  >
                    添加
                  </button>
                </div>
              ))}
            </div>
          ) : (
            domain &&
            !searching &&
            !error && (
              <div className="text-center py-8">
                <Bot className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-400">未找到 Agent</p>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
