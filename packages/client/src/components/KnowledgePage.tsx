import { useEffect, useRef, useState } from 'react';
import { useKbStore, type KnowledgeDocument } from '../stores/knowledge-base.js';
import { Trash, Plus, ChevronDown } from './Icons.js';

function statusBadge(status: string | null) {
  const s = status ?? 'processing';
  const colors: Record<string, string> = {
    ready: 'bg-green-500/20 text-green-400',
    processing: 'bg-yellow-500/20 text-yellow-400',
    failed: 'bg-red-500/20 text-red-400',
  };
  const labels: Record<string, string> = { ready: '就绪', processing: '处理中', failed: '失败' };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[s] ?? colors.processing}`}>
      {labels[s] ?? s}
    </span>
  );
}

function DocRow({ doc, onDelete }: { doc: KnowledgeDocument; onDelete: () => void }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded bg-white/5 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <span className="truncate text-gray-200">{doc.filename}</span>
        {statusBadge(doc.status)}
        {doc.chunk_count != null && doc.status === 'ready' && (
          <span className="text-gray-500 text-xs">{doc.chunk_count} 块</span>
        )}
      </div>
      <button onClick={onDelete} className="text-gray-500 hover:text-red-400 ml-2 shrink-0">
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
    <div className="rounded-lg border border-white/10 bg-white/5">
      <div className="flex items-center justify-between px-4 py-3">
        <button className="flex items-center gap-2 flex-1 text-left" onClick={handleExpand}>
          <ChevronDown
            width={14}
            height={14}
            className={`text-gray-400 transition-transform ${expanded ? 'rotate-0' : '-rotate-90'}`}
          />
          <div>
            <div className="font-medium text-gray-100 text-sm">{kb.name}</div>
            {kb.description && <div className="text-xs text-gray-500 mt-0.5">{kb.description}</div>}
          </div>
        </button>
        <div className="flex items-center gap-1 ml-2 shrink-0">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="text-xs px-2 py-1 rounded bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 disabled:opacity-50"
          >
            {uploading ? '上传中…' : '上传文件'}
          </button>
          <button
            onClick={() => {
              if (confirm(`删除知识库「${kb.name}」？此操作不可恢复。`)) deleteKb(kbId);
            }}
            className="text-gray-500 hover:text-red-400 p-1"
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
        <div className="px-4 pb-3 flex flex-col gap-1.5">
          {!docs ? (
            <div className="text-xs text-gray-500">加载中…</div>
          ) : docs.length === 0 ? (
            <div className="text-xs text-gray-500">暂无文档，点击"上传文件"导入 .txt / .md / .pdf</div>
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
    <div className="flex flex-col h-full p-4 gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-100">知识库</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Plus width={14} height={14} />
          新建
        </button>
      </div>

      {showForm && (
        <div className="flex flex-col gap-2 p-3 rounded-lg border border-white/10 bg-white/5">
          <input
            type="text"
            placeholder="知识库名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-white/10 text-gray-100 text-sm px-3 py-2 rounded border border-white/10 focus:outline-none focus:border-blue-500"
          />
          <input
            type="text"
            placeholder="描述（可选）"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="bg-white/10 text-gray-100 text-sm px-3 py-2 rounded border border-white/10 focus:outline-none focus:border-blue-500"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!name.trim() || saving}
              className="flex-1 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50"
            >
              {saving ? '创建中…' : '创建'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-gray-300 text-sm"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto flex flex-col gap-3">
        {loading ? (
          <div className="text-sm text-gray-500 text-center mt-8">加载中…</div>
        ) : kbs.length === 0 ? (
          <div className="text-sm text-gray-500 text-center mt-8">
            暂无知识库。点击"新建"创建第一个知识库，然后上传文档。
          </div>
        ) : (
          kbs.map((kb) => <KbCard key={kb.id} kbId={kb.id} />)
        )}
      </div>
    </div>
  );
}
