import { create } from 'zustand';
import i18n from '../i18n/index.js';
import { agentFailureText } from '../lib/agent-failure-text.js';
import { api, getToken } from '../lib/api.js';
import { formatShortDateTime } from '../lib/format-date.js';
import { gatewayOrigin } from '../lib/gateway.js';
import { prependNew } from '../lib/list.js';
import { useAuthStore } from './auth.js';

// Exported because the components that render a thread need the same two
// shapes, and each had been re-declaring them verbatim — `Citation` in three
// files, `Message` in two. The store is what fills them, so it owns them.
export interface Citation {
  source: string;
  url?: string;
  page?: number;
  passage?: string;
  trust_level?: string;
}

/** A file sent with a message; the bytes are fetched on demand. */
export interface AttachmentMeta {
  id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
}

export interface Message {
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
  attachments?: AttachmentMeta[];
}

interface Conversation {
  id: string;
  type: string;
  name?: string;
  created_at: string;
  updated_at: string;
  unread_count?: number;
}

// Matches the gateway's cap for this endpoint's default; one "load older" step.
const MESSAGE_PAGE_SIZE = 50;

/**
 * What to show the reader for a stream error, or null when there is nothing to
 * say. `already_generating` is not a failure: another tab, or the request from
 * before a reload, is producing this very answer and it arrives over the
 * WebSocket. Every other code is worded by `agentFailureText`, which the A2A
 * failure notice also goes through.
 */
function streamErrorText(code: string): string | null {
  if (code === 'already_generating') return null;
  return agentFailureText(code);
}

interface MessagePage {
  messages: Array<Message & { citations_json?: unknown }>;
}

export interface PeerTurn {
  conversation_id: string;
  state: 'thinking' | 'tool';
  tool?: string;
}

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Message[];
  streaming: boolean;
  streamContent: string;
  streamCitations: Citation[];
  agentStatus: string | null;
  // What the owner's agent is doing for a PEER right now (an inbound A2A turn),
  // which arrives over the socket rather than this tab's own SSE stream. Kept
  // apart from `agentStatus` because it is not tied to `streaming`, and as facts
  // rather than a sentence so the header can word it in the reader's locale.
  peerTurn: PeerTurn | null;

  messagesLoading: boolean;
  loadingOlder: boolean;
  // Keyset paging has no total to compare against, so "there is more" is
  // inferred from the last page coming back full.
  hasOlderMessages: boolean;
  // Which shelf the list shows: live threads, or the archived ones.
  showArchived: boolean;
  // The open thread's name as of when it was opened. The list is the fresher
  // source, but switching shelves can take the open thread out of it.
  activeConversationName?: string;

  loadConversations: () => Promise<void>;
  setShowArchived: (show: boolean) => Promise<void>;
  renameConversation: (id: string, name: string) => Promise<void>;
  setArchived: (id: string, archived: boolean) => Promise<void>;
  markRead: (id: string) => Promise<void>;
  // `name` covers a thread that is not in the list on screen, e.g. a search
  // hit in the other shelf.
  selectConversation: (id: string, name?: string) => Promise<void>;
  loadOlderMessages: () => Promise<void>;
  createConversation: (name?: string) => Promise<string>;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (content: string, attachments?: AttachmentMeta[]) => Promise<void>;
  addMessage: (msg: Message) => void;
  setPeerTurn: (turn: PeerTurn | null) => void;
}

// Backend stores RAG citations as `citations_json` (an array of raw doc/kb/excerpt
// rows). The UI renders the typed `citations` shape, so map at this boundary when
// the message hasn't already been normalized.
function normalizeMessage(apiMsg: Message & { citations_json?: unknown }): Message {
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
  loadingOlder: false,
  hasOlderMessages: false,
  streaming: false,
  streamContent: '',
  streamCitations: [],
  agentStatus: null,
  peerTurn: null,
  showArchived: false,

  loadConversations: async () => {
    const shelf = get().showArchived;
    const data = await api.get<{ conversations: Conversation[] }>(
      shelf ? '/conversations?archived=1' : '/conversations',
    );
    // A reply for the other shelf, if the owner switched while it was in flight.
    if (get().showArchived === shelf) set({ conversations: data.conversations });
  },

  setShowArchived: async (show) => {
    set({ showArchived: show, conversations: [] });
    await get().loadConversations();
  },

  renameConversation: async (id, name) => {
    const data = await api.patch<{ conversation: Conversation }>(`/conversations/${id}`, { name });
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, name: data.conversation.name } : c,
      ),
    }));
  },

  // Either way the thread leaves the shelf on screen; it is on the other one now.
  setArchived: async (id, archived) => {
    await api.patch(`/conversations/${id}`, { archived });
    set((s) => ({ conversations: s.conversations.filter((c) => c.id !== id) }));
  },

  markRead: async (id) => {
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)),
    }));
    await api.post(`/conversations/${id}/read`, {});
  },

  selectConversation: async (id, name) => {
    set((s) => ({
      activeConversationId: id,
      activeConversationName: s.conversations.find((c) => c.id === id)?.name ?? name,
      messages: [],
      messagesLoading: true,
      // Thread-scoped, so they reset with the thread. This also releases the
      // flag if an older-history fetch is still in flight — it will find the
      // conversation changed and bail without touching state.
      loadingOlder: false,
      hasOlderMessages: false,
      streaming: false,
      streamContent: '',
      streamCitations: [],
      agentStatus: null,
    }));
    try {
      const data = await api.get<MessagePage>(
        `/conversations/${id}/messages?limit=${MESSAGE_PAGE_SIZE}`,
      );
      set({
        messages: data.messages.map(normalizeMessage),
        messagesLoading: false,
        hasOlderMessages: data.messages.length === MESSAGE_PAGE_SIZE,
      });
    } catch {
      set({ messagesLoading: false });
      return;
    }
    // Best-effort: a failed mark leaves a stale badge, not a broken thread.
    get()
      .markRead(id)
      .catch(() => {});
  },

  // Walk backwards through the thread. The endpoint has always supported this
  // (`before` + `limit`, keyset), but nothing ever called it with them, so a
  // conversation's fifty-first-oldest message and everything behind it were
  // unreachable from the UI.
  loadOlderMessages: async () => {
    const { activeConversationId, messages, loadingOlder, hasOlderMessages } = get();
    const oldest = messages[0];
    if (!activeConversationId || !oldest || loadingOlder || !hasOlderMessages) return;

    set({ loadingOlder: true });
    try {
      const data = await api.get<MessagePage>(
        `/conversations/${activeConversationId}/messages?limit=${MESSAGE_PAGE_SIZE}&before=${oldest.id}`,
      );
      // The user can switch conversations while this is in flight; without this
      // check the older page would be prepended to a different thread.
      if (get().activeConversationId !== activeConversationId) return;
      const older = data.messages.map(normalizeMessage);
      set((s) => ({
        messages: prependNew(s.messages, older),
        hasOlderMessages: older.length === MESSAGE_PAGE_SIZE,
        loadingOlder: false,
      }));
    } catch {
      set({ loadingOlder: false });
    }
  },

  // `name` only. This also sent `peer_id`, which `POST /conversations` has
  // never read — the endpoint creates a thread between you and your own agent,
  // and there is no field on it for a peer. Sending it made the call look like
  // it opened a thread with that contact; it never did. Reaching a peer goes
  // through the consult routes, which derive their own thread per (user, peer).
  createConversation: async (name) => {
    const autoName = name ?? formatShortDateTime(new Date());
    const data = await api.post<{ conversation: Conversation }>('/conversations', {
      type: 'direct_user_agent',
      name: autoName,
    });
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

  sendMessage: async (content, attachments = []) => {
    const { activeConversationId } = get();
    if (!activeConversationId) return;

    const data = await api.post<{ id: string; stream_url: string }>(
      `/conversations/${activeConversationId}/messages`,
      { content, content_type: 'text', via: 'web', attachment_ids: attachments.map((a) => a.id) },
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
      attachments,
    };
    set((s) => ({ messages: [...s.messages, userMsg] }));

    set({
      streaming: true,
      streamContent: '',
      streamCitations: [],
      agentStatus: i18n.t('message.statusThinking'),
    });

    try {
      // The gateway hands back a path, not a URL — it has no idea which address
      // this client reached it on. Relative is right for the web build and
      // resolves to the app bundle in a desktop one, so it goes through the same
      // origin every other request does.
      const res = await fetch(`${gatewayOrigin()}${data.stream_url}`, {
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
          // The gateway broadcasts `message.new` over the WebSocket *before* it
          // writes the stream's `done` event, so this same reply has usually
          // already arrived via addMessage. Appending unconditionally rendered
          // every answer twice until the next reload.
          messages: s.messages.some((m) => m.id === agentMsg.id)
            ? s.messages
            : [...s.messages, agentMsg],
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

            // The reader keys off the payload, not the `event:` line it skips,
            // and only the error event carries `message`. Without this branch
            // the loop ends having collected nothing and the tail call below
            // committed an empty reply under a made-up id — a blank bubble
            // presented as the agent's answer.
            if (event.message) {
              set({
                streaming: false,
                streamContent: '',
                streamCitations: [],
                agentStatus: streamErrorText(event.message),
              });
              return;
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
      // The agent's reply ends its peer turn. The `idle` status says so too, but
      // a socket that dropped mid-turn never hears it, and the header would
      // otherwise claim the agent is still answering for good.
      const peerTurn =
        msg.sender_type === 'own_agent' && s.peerTurn?.conversation_id === msg.conversation_id
          ? null
          : s.peerTurn;
      if (msg.conversation_id !== s.activeConversationId) return { peerTurn };
      if (s.messages.some((m) => m.id === msg.id)) return { peerTurn };
      return { messages: [...s.messages, msg], peerTurn };
    });
  },

  setPeerTurn: (turn) => {
    set({ peerTurn: turn });
  },
}));
