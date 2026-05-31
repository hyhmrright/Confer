import { create } from 'zustand';
import { api } from '../lib/api.js';

export interface KnowledgeBase {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeDocument {
  id: string;
  kb_id: string;
  user_id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  chunk_count: number | null;
  status: string | null;
  created_at: string;
}

interface KbState {
  kbs: KnowledgeBase[];
  documents: Record<string, KnowledgeDocument[]>;
  loading: boolean;
  uploading: boolean;
  fetchKbs: () => Promise<void>;
  createKb: (name: string, description?: string) => Promise<void>;
  deleteKb: (kbId: string) => Promise<void>;
  fetchDocuments: (kbId: string) => Promise<void>;
  uploadDocument: (kbId: string, file: File) => Promise<void>;
  deleteDocument: (kbId: string, docId: string) => Promise<void>;
  retryDocument: (kbId: string, docId: string) => Promise<void>;
}

const TERMINAL_STATUSES = new Set(['ready', 'error', 'failed']);

// Embedding runs server-side after upload, so a freshly uploaded document stays
// "processing" until it finishes. Poll a few times to reflect the terminal
// status without making the user reload. Best-effort: stops on error or timeout.
async function pollDocumentStatus(kbId: string, docId: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    let docs: KnowledgeDocument[];
    try {
      const data = await api.get<{ documents: KnowledgeDocument[] }>(
        `/knowledge-bases/${kbId}/documents`,
      );
      docs = data.documents;
    } catch {
      return;
    }
    useKbStore.setState((s) => ({ documents: { ...s.documents, [kbId]: docs } }));
    const doc = docs.find((d) => d.id === docId);
    if (!doc || (doc.status != null && TERMINAL_STATUSES.has(doc.status))) return;
  }
}

export const useKbStore = create<KbState>((set) => ({
  kbs: [],
  documents: {},
  loading: false,
  uploading: false,

  fetchKbs: async () => {
    set({ loading: true });
    try {
      const data = await api.get<{ knowledge_bases: KnowledgeBase[] }>('/knowledge-bases');
      set({ kbs: data.knowledge_bases });
    } finally {
      set({ loading: false });
    }
  },

  createKb: async (name, description) => {
    const data = await api.post<{ knowledge_base: KnowledgeBase }>('/knowledge-bases', {
      name,
      description,
    });
    set((s) => ({ kbs: [data.knowledge_base, ...s.kbs] }));
  },

  deleteKb: async (kbId) => {
    await api.delete(`/knowledge-bases/${kbId}`);
    set((s) => ({
      kbs: s.kbs.filter((kb) => kb.id !== kbId),
      documents: Object.fromEntries(Object.entries(s.documents).filter(([k]) => k !== kbId)),
    }));
  },

  fetchDocuments: async (kbId) => {
    const data = await api.get<{ documents: KnowledgeDocument[] }>(
      `/knowledge-bases/${kbId}/documents`,
    );
    set((s) => ({ documents: { ...s.documents, [kbId]: data.documents } }));
  },

  uploadDocument: async (kbId, file) => {
    set({ uploading: true });
    try {
      const form = new FormData();
      form.append('file', file);
      const data = await api.postForm<{ document: KnowledgeDocument }>(
        `/knowledge-bases/${kbId}/documents`,
        form,
      );
      set((s) => ({
        documents: {
          ...s.documents,
          [kbId]: [data.document, ...(s.documents[kbId] ?? [])],
        },
      }));
      if (data.document.status == null || !TERMINAL_STATUSES.has(data.document.status)) {
        void pollDocumentStatus(kbId, data.document.id);
      }
    } finally {
      set({ uploading: false });
    }
  },

  deleteDocument: async (kbId, docId) => {
    await api.delete(`/knowledge-bases/${kbId}/documents/${docId}`);
    set((s) => ({
      documents: {
        ...s.documents,
        [kbId]: (s.documents[kbId] ?? []).filter((d) => d.id !== docId),
      },
    }));
  },

  retryDocument: async (kbId, docId) => {
    const data = await api.post<{ document: KnowledgeDocument }>(
      `/knowledge-bases/${kbId}/documents/${docId}/retry`,
      {},
    );
    set((s) => ({
      documents: {
        ...s.documents,
        [kbId]: (s.documents[kbId] ?? []).map((d) => (d.id === docId ? data.document : d)),
      },
    }));
  },
}));
