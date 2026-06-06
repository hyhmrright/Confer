import { create } from 'zustand';
import i18n, { dateLocale } from '../i18n/index.js';
import { api, getToken } from '../lib/api.js';
import { useAuthStore } from './auth.js';

interface Citation {
  source: string;
  url?: string;
  page?: number;
  passage?: string;
  trust_level?: string;
}

interface Message {
  id: string;
  conversation_id: string;
  sender_type: string;
  sender_id: string;
  content: string | null;
  content_type: string;
  citations?: Citation[];
  created_at: string;
  in_reply_to?: string;
  content_json?: unknown;
}

interface Conversation {
  id: string;
  type: string;
  name?: string;
  created_at: string;
  updated_at: string;
}

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Message[];
  streaming: boolean;
  streamContent: string;
  streamCitations: Citation[];
  agentStatus: string | null;

  messagesLoading: boolean;

  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  createConversation: (peerId?: string, name?: string) => Promise<string>;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  addMessage: (msg: Message) => void;
  setStreaming: (streaming: boolean, content?: string) => void;
  setAgentStatus: (status: string | null) => void;
}

// Backend stores RAG citations as `citations_json` (an array of raw doc/kb/excerpt
// rows). The UI renders the typed `citations` shape, so map at this boundary when
// the message hasn't already been normalized. Pure — exported for testing.
export function normalizeMessage(apiMsg: Message & { citations_json?: unknown }): Message {
  if (!apiMsg.citations && apiMsg.citations_json) {
    const raw = apiMsg.citations_json as Array<Record<string, unknown>>;
    return {
      ...apiMsg,
      citations: raw.map((c) => ({
        source: `${c.doc_name as string}（${c.kb_name as string}）`,
        passage: c.excerpt as string | undefined,
      })),
    };
  }
  return apiMsg;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  messagesLoading: false,
  streaming: false,
  streamContent: '',
  streamCitations: [],
  agentStatus: null,

  loadConversations: async () => {
    const data = await api.get<{ conversations: Conversation[] }>('/conversations');
    set({ conversations: data.conversations });
  },

  selectConversation: async (id) => {
    set({
      activeConversationId: id,
      messages: [],
      messagesLoading: true,
      streaming: false,
      streamContent: '',
      streamCitations: [],
      agentStatus: null,
    });
    try {
      const data = await api.get<{ messages: Array<Message & { citations_json?: unknown }> }>(
        `/conversations/${id}/messages`,
      );
      set({ messages: data.messages.map(normalizeMessage), messagesLoading: false });
    } catch {
      set({ messagesLoading: false });
    }
  },

  createConversation: async (peerId, name) => {
    const autoName =
      name ??
      new Date().toLocaleString(dateLocale(), {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    const body: Record<string, unknown> = { type: 'direct_user_agent', name: autoName };
    if (peerId) body.peer_id = peerId;
    const data = await api.post<{ conversation: Conversation }>('/conversations', body);
    set((s) => ({ conversations: [data.conversation, ...s.conversations] }));
    return data.conversation.id;
  },

  deleteConversation: async (id) => {
    await api.delete(`/conversations/${id}`);
    set((s) => {
      const filtered = s.conversations.filter((c) => c.id !== id);
      const next =
        s.activeConversationId === id ? (filtered[0]?.id ?? null) : s.activeConversationId;
      return {
        conversations: filtered,
        activeConversationId: next,
        messages: s.activeConversationId === id ? [] : s.messages,
      };
    });
  },

  sendMessage: async (content) => {
    const { activeConversationId } = get();
    if (!activeConversationId) return;

    const data = await api.post<{ id: string; stream_url: string }>(
      `/conversations/${activeConversationId}/messages`,
      { content, content_type: 'text', via: 'web' },
    );

    const { user } = useAuthStore.getState();
    const userMsg: Message = {
      id: data.id,
      conversation_id: activeConversationId,
      sender_type: 'user',
      sender_id: user?.id ?? '',
      content,
      content_type: 'text',
      created_at: new Date().toISOString(),
    };
    set((s) => ({ messages: [...s.messages, userMsg] }));

    set({
      streaming: true,
      streamContent: '',
      streamCitations: [],
      agentStatus: i18n.t('message.statusThinking'),
    });

    try {
      const res = await fetch(data.stream_url, {
        headers: { Authorization: `Bearer ${getToken() ?? ''}` },
      });
      if (!res.ok || !res.body) {
        set({ streaming: false, agentStatus: null });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      const citations: Citation[] = [];

      const finalizeAgent = (messageId?: string) => {
        const agentMsg: Message = {
          id: messageId ?? crypto.randomUUID(),
          conversation_id: activeConversationId,
          sender_type: 'own_agent',
          sender_id: '',
          content: fullContent,
          content_type: 'text',
          citations: citations.length > 0 ? citations : undefined,
          created_at: new Date().toISOString(),
          in_reply_to: data.id,
        };
        set((s) => ({
          messages: [...s.messages, agentMsg],
          streaming: false,
          streamContent: '',
          streamCitations: [],
          agentStatus: null,
        }));
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            continue;
          }
          if (!line.startsWith('data:')) continue;

          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);

            if (event.text) {
              fullContent += event.text;
              set({ streamContent: fullContent, agentStatus: null });
            }

            if (event.source) {
              citations.push(event);
              set({ streamCitations: [...citations] });
            }

            if (event.tool) {
              set({ agentStatus: i18n.t('message.statusCallingTool', { tool: event.tool }) });
            }

            if (event.result !== undefined) {
              set({ agentStatus: null });
            }

            if (event.finish_reason || event.message_id) {
              finalizeAgent(event.message_id);
            }
          } catch {
            // skip malformed events
          }
        }
      }

      if (get().streaming) {
        finalizeAgent();
      }
    } catch {
      set({ streaming: false, streamContent: '', agentStatus: null });
    }
  },

  addMessage: (msg) => {
    set((s) => {
      if (msg.conversation_id !== s.activeConversationId) return s;
      if (s.messages.some((m) => m.id === msg.id)) return s;
      return { messages: [...s.messages, msg] };
    });
  },

  setStreaming: (streaming, content) => {
    set({ streaming, streamContent: content ?? '' });
  },

  setAgentStatus: (status) => {
    set({ agentStatus: status });
  },
}));
