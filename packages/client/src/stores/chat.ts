import { create } from 'zustand';
import { api } from '../lib/api.js';

interface Citation {
  source: string;
  url?: string;
  page?: string;
  passage?: string;
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

  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  createConversation: (name?: string) => Promise<string>;
  sendMessage: (content: string) => Promise<void>;
  addMessage: (msg: Message) => void;
  setStreaming: (streaming: boolean, content?: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  streaming: false,
  streamContent: '',

  loadConversations: async () => {
    const data = await api.get<{ conversations: Conversation[] }>('/conversations');
    set({ conversations: data.conversations });
  },

  selectConversation: async (id) => {
    set({ activeConversationId: id, messages: [], streaming: false, streamContent: '' });
    const data = await api.get<{ messages: Message[] }>(`/conversations/${id}/messages`);
    set({ messages: data.messages });
  },

  createConversation: async (name) => {
    const data = await api.post<{ conversation: Conversation }>('/conversations', {
      type: 'direct_user_agent',
      name,
    });
    set((s) => ({ conversations: [data.conversation, ...s.conversations] }));
    return data.conversation.id;
  },

  sendMessage: async (content) => {
    const { activeConversationId } = get();
    if (!activeConversationId) return;

    const data = await api.post<{ id: string; stream_url: string }>(
      `/conversations/${activeConversationId}/messages`,
      { content, content_type: 'text' },
    );

    const userMsg: Message = {
      id: data.id,
      conversation_id: activeConversationId,
      sender_type: 'user',
      sender_id: '',
      content,
      content_type: 'text',
      created_at: new Date().toISOString(),
    };
    set((s) => ({ messages: [...s.messages, userMsg] }));

    set({ streaming: true, streamContent: '' });
    try {
      const streamUrl = data.stream_url.replace('/api/v1/conversations/', '/stream/').replace('/messages/', '/');
      const res = await fetch(`/api/v1${streamUrl}`);
      if (!res.ok || !res.body) {
        set({ streaming: false });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const jsonStr = line.slice(5).trim();
            if (!jsonStr) continue;
            try {
              const event = JSON.parse(jsonStr);
              if (event.text) {
                fullContent += event.text;
                set({ streamContent: fullContent });
              }
              if (event.message_id) {
                const agentMsg: Message = {
                  id: event.message_id,
                  conversation_id: activeConversationId,
                  sender_type: 'agent',
                  sender_id: '',
                  content: fullContent,
                  content_type: 'text',
                  created_at: new Date().toISOString(),
                  in_reply_to: data.id,
                };
                set((s) => ({
                  messages: [...s.messages, agentMsg],
                  streaming: false,
                  streamContent: '',
                }));
              }
            } catch {
              // skip malformed events
            }
          }
        }
      }
    } catch {
      set({ streaming: false, streamContent: '' });
    }
  },

  addMessage: (msg) => {
    set((s) => ({ messages: [...s.messages, msg] }));
  },

  setStreaming: (streaming, content) => {
    set({ streaming, streamContent: content ?? '' });
  },
}));
