import { create } from 'zustand';
import { api } from '../lib/api.js';
import { appendNew, prependNew } from '../lib/list.js';

export interface KnowledgeBase {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  // Whether an inbound question from an external Agent may search this base.
  shared_with_peers: boolean;
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
  documentsTotal: Record<string, number>;
  loadingMoreDocs: string | null;
  loading: boolean;
  uploading: boolean;
  fetchKbs: () => Promise<void>;
  createKb: (name: string, description?: string) => Promise<void>;
  deleteKb: (kbId: string) => Promise<void>;
  setKbShared: (kbId: string, shared: boolean) => Promise<void>;
  fetchDocuments: (kbId: string) => Promise<void>;
  loadMoreDocuments: (kbId: string) => Promise<void>;
  uploadDocument: (kbId: string, file: File) => Promise<void>;
  deleteDocument: (kbId: string, docId: string) => Promise<void>;
  retryDocument: (kbId: string, docId: string) => Promise<void>;
}

const TERMINAL_STATUSES = new Set(['ready', 'error', 'failed']);

// A knowledge base is an upload target, so this list is the one that genuinely
// grows. One "load more" step; the gateway caps `limit` at 100.
const DOC_PAGE_SIZE = 50;

interface DocumentList {
  documents: KnowledgeDocument[];
  total: number;
}

// Fold a freshly-fetched first page over what is already cached: refresh the
// rows it covers, keep the ones it doesn't (anything the user paged in beyond
// it), and prepend rows that are genuinely new. The upload poller re-reads page
// one to watch a status settle, and a plain assignment there would silently
// throw away every page loaded after the first.
function mergeDocs(cached: KnowledgeDocument[], page: KnowledgeDocument[]): KnowledgeDocument[] {
  const fresh = new Map(page.map((doc) => [doc.id, doc]));
  const refreshed = cached.map((doc) => fresh.get(doc.id) ?? doc);
  return prependNew(refreshed, page);
}

export const useKbStore = create<KbState>((set, get) => ({
  kbs: [],
  documents: {},
  documentsTotal: {},
  loadingMoreDocs: null,
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
      documentsTotal: Object.fromEntries(
        Object.entries(s.documentsTotal).filter(([k]) => k !== kbId),
      ),
    }));
  },

  // Optimistic: the switch is the whole interaction, so waiting a round trip to
  // move it reads as a dead control. A failure puts it back and rethrows, which
  // is what the caller renders.
  setKbShared: async (kbId, shared) => {
    const apply = (value: boolean) =>
      set((s) => ({
        kbs: s.kbs.map((kb) => (kb.id === kbId ? { ...kb, shared_with_peers: value } : kb)),
      }));
    apply(shared);
    try {
      await api.patch(`/knowledge-bases/${kbId}`, { shared_with_peers: shared });
    } catch (err) {
      apply(!shared);
      throw err;
    }
  },

  fetchDocuments: async (kbId) => {
    const data = await api.get<DocumentList>(
      `/knowledge-bases/${kbId}/documents?limit=${DOC_PAGE_SIZE}&offset=0`,
    );
    set((s) => ({
      documents: { ...s.documents, [kbId]: data.documents },
      documentsTotal: { ...s.documentsTotal, [kbId]: data.total },
    }));
  },

  loadMoreDocuments: async (kbId) => {
    const { documents, documentsTotal, loadingMoreDocs } = get();
    const shown = documents[kbId] ?? [];
    if (loadingMoreDocs || shown.length >= (documentsTotal[kbId] ?? 0)) return;
    set({ loadingMoreDocs: kbId });
    try {
      const data = await api.get<DocumentList>(
        `/knowledge-bases/${kbId}/documents?limit=${DOC_PAGE_SIZE}&offset=${shown.length}`,
      );
      set((s) => ({
        documents: {
          ...s.documents,
          [kbId]: appendNew(s.documents[kbId] ?? [], data.documents),
        },
        documentsTotal: { ...s.documentsTotal, [kbId]: data.total },
        loadingMoreDocs: null,
      }));
    } catch {
      set({ loadingMoreDocs: null });
    }
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
        documentsTotal: { ...s.documentsTotal, [kbId]: (s.documentsTotal[kbId] ?? 0) + 1 },
      }));
      // Embedding runs server-side after upload, so a freshly uploaded document
      // stays "processing" until it finishes. Poll a few times to reflect the
      // terminal status without a reload. Best-effort: stops on error or timeout.
      if (data.document.status == null || !TERMINAL_STATUSES.has(data.document.status)) {
        const docId = data.document.id;
        void (async () => {
          for (let i = 0; i < 20; i++) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            let page: DocumentList;
            try {
              page = await api.get<DocumentList>(
                `/knowledge-bases/${kbId}/documents?limit=${DOC_PAGE_SIZE}&offset=0`,
              );
            } catch {
              return;
            }
            set((s) => ({
              documents: {
                ...s.documents,
                [kbId]: mergeDocs(s.documents[kbId] ?? [], page.documents),
              },
              documentsTotal: { ...s.documentsTotal, [kbId]: page.total },
            }));
            const doc = page.documents.find((d) => d.id === docId);
            if (!doc || (doc.status != null && TERMINAL_STATUSES.has(doc.status))) return;
          }
        })();
      }
    } finally {
      set({ uploading: false });
    }
  },

  deleteDocument: async (kbId, docId) => {
    await api.delete(`/knowledge-bases/${kbId}/documents/${docId}`);
    set((s) => ({
      documentsTotal: {
        ...s.documentsTotal,
        [kbId]: Math.max(0, (s.documentsTotal[kbId] ?? 0) - 1),
      },
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
