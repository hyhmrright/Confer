import { useEffect, useRef, useState } from 'react';
import { useKbStore, type KnowledgeDocument } from '../stores/knowledge-base.js';
import { Trash, Plus, ChevronDown } from './Icons.js';

function statusBadge(status: string | null) {
  const s = status ?? 'processing';
  const colors: Record<string, string> = {
    ready: 'bg-green-100 text-green-700',
    processing: 'bg-yellow-100 text-yellow-700',
    failed: 'bg-red-100 text-red-700',
  };
  const labels: Record<string, string> = { ready: '就绪', processing: '处理中', failed: '失败' };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[s] ?? colors.processing}`}>
      {labels[s] ?? s}
    </span>
  );
}

function DocRow({ doc, onDelete }: { doc: KnowledgeDocument; onDelete: () => void }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <span className="truncate text-gray-700">{doc.filename}</span>
        {statusBadge(doc.status)}
        {doc.chunk_count != null && doc.status === 'ready' && (
          <span className="text-gray-400 text-xs shrink-0">{doc.chunk_count} 块</span>
        )}
      </div>
      <button onClick={onDelete} className="text-gray-400 hover:text-red-500 ml-2 shrink-0 transition-colors">
        <Trash width={14} height={14} />
      </button>
    </div>
  );
}

function KbCard({ kbId }: { kbId: string }) {
  const { kbs, documents, fetchDocuments, uploadDocument, deleteDocument, deleteKb, uploading } = useKbStore();
  const kb = kbs.find((k) => k.id === kbId);
  const [expanded, setExpanded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!kb) return null;

  const docs = documents[kbId];

  const handleExpand = async () => {
    if (!expanded && !docs) await fetchDocuments(kbId);
    setExpanded((v) => !v);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadDocument(kbId, file);
    e.target.value = '';
    if (!expanded) setExpanded(true);
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between px-4 py-3">
        <button className="flex items-center gap-2 flex-1 text-left min-w-0" onClick={handleExpand}>
          <ChevronDown
            width={14}
            height={14}
            className={`text-gray-400 transition-transform shrink-0 ${expanded ? 'rotate-0' : '-rotate-90'}`}
          />
          <div className="min-w-0">
            <div className="font-medium text-gray-800 text-sm truncate">{kb.name}</div>
            {kb.description && <div className="text-xs text-gray-500 mt-0.5 truncate">{kb.description}</div>}
          </div>
        </button>
        <div className="flex items-center gap-1 ml-2 shrink-0">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="text-xs px-2 py-1 rounded-lg bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-50 transition-colors"
          >
            {uploading ? '上传中…' : '上传'}
          </button>
          <button
            onClick={() => {
              if (confirm(`删除知识库「${kb.name}」？此操作不可恢复。`)) deleteKb(kbId);
            }}
            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
          >
            <Trash width={14} height={14} />
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.pdf"
          className="hidden"
          onChange={handleUpload}
        />
      </div>

      {expanded && (
        <div className="px-4 pb-3 flex flex-col gap-1.5 border-t border-gray-100 pt-2">
          {!docs ? (
            <div className="text-xs text-gray-400 py-2 text-center">加载中…</div>
          ) : docs.length === 0 ? (
            <div className="text-xs text-gray-400 py-2 text-center">暂无文档，点击"上传"导入 .txt / .md / .pdf</div>
          ) : (
            docs.map((doc) => (
              <DocRow
                key={doc.id}
                doc={doc}
                onDelete={() => deleteDocument(kbId, doc.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function KnowledgePage() {
  const { kbs, loading, fetchKbs, createKb } = useKbStore();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchKbs();
  }, [fetchKbs]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createKb(name.trim(), description.trim() || undefined);
      setName('');
      setDescription('');
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-50 min-w-0 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 bg-white border-b border-gray-200 flex items-center gap-3">
        <h2 className="text-base font-semibold text-gray-800 flex-1">知识库</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Plus width={14} height={14} />
          新建
        </button>
      </div>

      {/* New KB form */}
      {showForm && (
        <div className="px-4 py-3 bg-white border-b border-gray-200 space-y-2">
          <input
            type="text"
            placeholder="知识库名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <input
            type="text"
            placeholder="描述（可选）"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
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
              disabled={!name.trim() || saving}
              className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {saving ? '创建中…' : '创建'}
            </button>
          </div>
        </div>
      )}

      {/* KB list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
        {loading ? (
          <div className="flex justify-center pt-10">
            <div className="flex gap-1.5">
              <span className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        ) : kbs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-300 pt-16">
            <p className="text-base font-medium">暂无知识库</p>
            <p className="text-sm mt-1">点击右上角按钮创建</p>
          </div>
        ) : (
          kbs.map((kb) => <KbCard key={kb.id} kbId={kb.id} />)
        )}
      </div>
    </div>
  );
}
