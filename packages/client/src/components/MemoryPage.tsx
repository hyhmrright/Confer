import { useEffect, useState } from 'react';
import { useMemoriesStore } from '../stores/memories.js';
import { Trash, Plus, Search } from './Icons.js';

export function MemoryPage() {
  const { memories, loading, loadMemories, createMemory, updateMemory, deleteMemory } = useMemoriesStore();
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  const filtered = memories.filter(
    (m) =>
      m.title.toLowerCase().includes(query.toLowerCase()) ||
      m.content.toLowerCase().includes(query.toLowerCase()),
  );

  const handleCreate = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    setSaving(true);
    try {
      await createMemory(newTitle.trim(), newContent.trim());
      setNewTitle('');
      setNewContent('');
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePin = async (id: string, pinned: boolean) => {
    await updateMemory(id, { pinned: !pinned });
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-50 min-w-0 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 bg-white border-b border-gray-200 flex items-center gap-3">
        <h2 className="text-base font-semibold text-gray-800 flex-1">记忆</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          新建
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-3 bg-white border-b border-gray-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索记忆..."
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* New memory form */}
      {showForm && (
        <div className="px-4 py-3 bg-white border-b border-gray-200 space-y-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="标题"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="内容..."
            rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={saving || !newTitle.trim() || !newContent.trim()}
              className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              保存
            </button>
          </div>
        </div>
      )}

      {/* Memory list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
        {loading ? (
          <div className="flex justify-center pt-10">
            <div className="flex gap-1.5">
              <span className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-300 pt-16">
            <p className="text-base font-medium">暂无记忆</p>
            <p className="text-sm mt-1">点击右上角按钮添加</p>
          </div>
        ) : (
          filtered.map((mem) => (
            <div
              key={mem.id}
              className={`bg-white rounded-xl border p-4 shadow-sm group ${mem.pinned ? 'border-primary-200 bg-primary-50' : 'border-gray-100'}`}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {mem.pinned && (
                      <span className="text-xs font-medium text-primary-600 bg-primary-100 px-1.5 py-0.5 rounded">
                        置顶
                      </span>
                    )}
                    <h3 className="text-sm font-semibold text-gray-800 truncate">{mem.title}</h3>
                  </div>
                  <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap line-clamp-3">{mem.content}</p>
                  {mem.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {mem.tags.map((tag) => (
                        <span key={tag} className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-gray-400 mt-2">
                    {new Date(mem.updated_at).toLocaleString('zh-CN', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={() => handleTogglePin(mem.id, mem.pinned)}
                    className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                    title={mem.pinned ? '取消置顶' : '置顶'}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill={mem.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
                      <path d="M12 2L8 8H2l5 4-2 9 7-4 7 4-2-9 5-4h-6z" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    onClick={() => deleteMemory(mem.id)}
                    className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="删除"
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
