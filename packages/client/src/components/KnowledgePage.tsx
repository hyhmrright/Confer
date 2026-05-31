import { useEffect, useRef, useState } from 'react';
import { INPUT_CLS } from '../lib/styles.js';
import { type KnowledgeDocument, useKbStore } from '../stores/knowledge-base.js';
import { ChevronDown, Plus, Trash } from './Icons.js';

function statusBadge(status: string | null) {
  const s = status ?? 'processing';
  const colors: Record<string, string> = {
    ready: 'bg-green-900/30 text-green-400 border-green-800/30',
    processing: 'bg-yellow-900/30 text-yellow-400 border-yellow-800/30',
    failed: 'bg-red-900/30 text-red-400 border-red-800/30',
  };
  const labels: Record<string, string> = { ready: '就绪', processing: '处理中', failed: '失败' };
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium border ${colors[s] ?? colors.processing}`}
    >
      {labels[s] ?? s}
    </span>
  );
}

function DocRow({
  doc,
  onDelete,
  onRetry,
}: { doc: KnowledgeDocument; onDelete: () => void; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-dark-input border border-dark-border text-xs group">
      <div className="flex items-center gap-2 min-w-0">
        <span className="truncate text-ink-secondary font-mono">{doc.filename}</span>
        {statusBadge(doc.status)}
        {doc.chunk_count != null && doc.status === 'ready' && (
          <span className="text-ink-muted shrink-0">{doc.chunk_count}块</span>
        )}
      </div>
      <div className="flex items-center gap-1 ml-2 shrink-0 opacity-0 group-hover:opacity-100">
        {doc.status === 'failed' && onRetry && (
          <button
            onClick={onRetry}
            className="text-[10px] px-1.5 py-0.5 rounded text-amber-400 hover:bg-amber-900/20 border border-amber-800/30 transition-colors"
          >
            重试
          </button>
        )}
        <button
          onClick={onDelete}
          className="text-ink-muted hover:text-red-400 hover:bg-red-900/20 p-0.5 rounded transition-colors"
        >
          <Trash width={12} height={12} />
        </button>
      </div>
    </div>
  );
}

function KbCard({ kbId }: { kbId: string }) {
  const {
    kbs,
    documents,
    fetchDocuments,
    uploadDocument,
    deleteDocument,
    deleteKb,
    retryDocument,
    uploading,
  } = useKbStore();
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
    <div className="rounded-xl border border-dark-border bg-dark-card overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5">
        <button
          className="flex items-center gap-2 flex-1 text-left min-w-0 group"
          onClick={handleExpand}
        >
          <ChevronDown
            width={12}
            height={12}
            className={`text-ink-muted transition-transform shrink-0 ${expanded ? 'rotate-0' : '-rotate-90'}`}
          />
          <div className="min-w-0">
            <p className="text-xs font-medium text-ink-primary truncate">{kb.name}</p>
            {kb.description && (
              <p className="text-[10px] text-ink-muted mt-0.5 truncate">{kb.description}</p>
            )}
          </div>
        </button>
        <div className="flex items-center gap-1 ml-2 shrink-0">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="text-[11px] px-2 py-0.5 rounded-md bg-primary-600/15 text-primary-400
              border border-primary-600/20 hover:bg-primary-600/25 disabled:opacity-40 transition-all"
          >
            {uploading ? '上传中…' : '上传'}
          </button>
          <button
            onClick={() => {
              if (confirm(`删除知识库「${kb.name}」？此操作不可恢复。`)) deleteKb(kbId);
            }}
            className="p-1 text-ink-muted hover:text-red-400 hover:bg-red-900/20 rounded transition-colors"
          >
            <Trash width={12} height={12} />
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
        <div className="px-3 pb-2.5 flex flex-col gap-1.5 border-t border-dark-border pt-2">
          {!docs ? (
            <p className="text-[10px] text-ink-muted py-1 text-center">加载中…</p>
          ) : docs.length === 0 ? (
            <p className="text-[10px] text-ink-muted py-1 text-center">
              暂无文档，点击"上传"导入 .txt / .md / .pdf
            </p>
          ) : (
            docs.map((doc) => (
              <DocRow
                key={doc.id}
                doc={doc}
                onDelete={() => deleteDocument(kbId, doc.id)}
                onRetry={() => retryDocument(kbId, doc.id)}
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
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-dark-border shrink-0">
        <span className="text-xs font-semibold text-ink-secondary tracking-wider uppercase font-mono">
          知识库
        </span>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md
            bg-primary-600/15 text-primary-400 border border-primary-600/20
            hover:bg-primary-600/25 transition-all"
        >
          <Plus className="w-3 h-3" />
          新建
        </button>
      </div>

      {/* New KB form */}
      {showForm && (
        <div className="px-3 py-3 border-b border-dark-border space-y-2 shrink-0 bg-dark-card/50">
          <input
            type="text"
            placeholder="知识库名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={INPUT_CLS}
          />
          <input
            type="text"
            placeholder="描述（可选）"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={INPUT_CLS}
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 text-xs text-ink-muted hover:text-ink-secondary transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={!name.trim() || saving}
              className="px-3 py-1.5 text-xs bg-primary-600 text-white rounded-lg
                hover:bg-primary-500 disabled:opacity-40 transition-colors"
            >
              {saving ? '创建中…' : '创建'}
            </button>
          </div>
        </div>
      )}

      {/* KB list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-2">
        {loading ? (
          <div className="flex justify-center pt-8">
            <div className="flex gap-1.5">
              {[0, 150, 300].map((d) => (
                <span
                  key={d}
                  className="w-1.5 h-1.5 rounded-full bg-dark-border animate-bounce"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </div>
          </div>
        ) : kbs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-ink-muted pt-10">
            <p className="text-xs">暂无知识库</p>
            <p className="text-[10px] mt-0.5 opacity-60">点击右上角新建</p>
          </div>
        ) : (
          kbs.map((kb) => <KbCard key={kb.id} kbId={kb.id} />)
        )}
      </div>
    </div>
  );
}
