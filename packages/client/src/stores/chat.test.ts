import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// Mock the HTTP layer so store logic is tested without a real backend.
const get = mock(async (_path: string) => ({}) as unknown);
const post = mock(async (_path: string, _body: unknown) => ({}) as unknown);
const del = mock(async (_path: string) => ({}) as unknown);
mock.module('../lib/api.js', () => ({
  api: { get, post, delete: del },
  getToken: mock(() => null),
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
}));

const { useChatStore } = await import('./chat.js');

const initial = useChatStore.getState();

const baseState = {
  conversations: [],
  activeConversationId: null,
  messages: [],
  messagesLoading: false,
  streaming: false,
  streamContent: '',
  streamCitations: [],
  agentStatus: null,
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  del.mockReset();
  useChatStore.setState(baseState);
});

afterEach(() => {
  useChatStore.setState(initial, true);
});

const makeMessage = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'm1',
  conversation_id: 'c1',
  sender_type: 'user',
  sender_id: 'u1',
  content: 'hi',
  content_type: 'text',
  created_at: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('chat store', () => {
  test('loadConversations stores the fetched list', async () => {
    const conversations = [{ id: 'c1', type: 'direct_user_agent', created_at: 'a', updated_at: 'b' }];
    get.mockResolvedValueOnce({ conversations });

    await useChatStore.getState().loadConversations();

    expect(get).toHaveBeenCalledWith('/conversations');
    expect(useChatStore.getState().conversations).toEqual(conversations as never);
  });

  test('selectConversation loads messages and resets stream state', async () => {
    const messages = [makeMessage()];
    get.mockResolvedValueOnce({ messages });

    await useChatStore.getState().selectConversation('c1');

    expect(get).toHaveBeenCalledWith('/conversations/c1/messages');
    const state = useChatStore.getState();
    expect(state.activeConversationId).toBe('c1');
    expect(state.messages).toEqual(messages as never);
    expect(state.messagesLoading).toBe(false);
    expect(state.streaming).toBe(false);
  });

  test('selectConversation maps citations_json into citations', async () => {
    const messages = [
      makeMessage({
        sender_type: 'own_agent',
        citations_json: [{ doc_name: 'Doc', kb_name: 'KB', excerpt: 'passage text' }],
      }),
    ];
    get.mockResolvedValueOnce({ messages });

    await useChatStore.getState().selectConversation('c1');

    const [msg] = useChatStore.getState().messages;
    expect(msg.citations).toEqual([{ source: 'Doc（KB）', passage: 'passage text' }] as never);
  });

  test('selectConversation stops loading when fetch fails', async () => {
    get.mockRejectedValueOnce(new Error('boom'));

    await useChatStore.getState().selectConversation('c1');

    const state = useChatStore.getState();
    expect(state.activeConversationId).toBe('c1');
    expect(state.messagesLoading).toBe(false);
    expect(state.messages).toEqual([]);
  });

  test('createConversation posts and prepends the new conversation', async () => {
    const conversation = { id: 'c2', type: 'direct_user_agent', created_at: 'a', updated_at: 'b' };
    useChatStore.setState({
      conversations: [{ id: 'c1', type: 'direct_user_agent', created_at: 'a', updated_at: 'b' }] as never,
    });
    post.mockResolvedValueOnce({ conversation });

    const id = await useChatStore.getState().createConversation('p1', 'My Chat');

    expect(post).toHaveBeenCalledWith('/conversations', {
      type: 'direct_user_agent',
      name: 'My Chat',
      peer_id: 'p1',
    });
    expect(id).toBe('c2');
    expect(useChatStore.getState().conversations.map((c) => c.id)).toEqual(['c2', 'c1']);
  });

  test('createConversation omits peer_id when none is given', async () => {
    const conversation = { id: 'c2', type: 'direct_user_agent', created_at: 'a', updated_at: 'b' };
    post.mockResolvedValueOnce({ conversation });

    await useChatStore.getState().createConversation(undefined, 'My Chat');

    expect(post).toHaveBeenCalledWith('/conversations', {
      type: 'direct_user_agent',
      name: 'My Chat',
    });
  });

  test('deleteConversation removes it and clears active selection + messages', async () => {
    useChatStore.setState({
      conversations: [
        { id: 'c1', type: 'direct_user_agent', created_at: 'a', updated_at: 'b' },
        { id: 'c2', type: 'direct_user_agent', created_at: 'a', updated_at: 'b' },
      ] as never,
      activeConversationId: 'c1',
      messages: [makeMessage()] as never,
    });

    await useChatStore.getState().deleteConversation('c1');

    expect(del).toHaveBeenCalledWith('/conversations/c1');
    const state = useChatStore.getState();
    expect(state.conversations.map((c) => c.id)).toEqual(['c2']);
    expect(state.activeConversationId).toBe('c2');
    expect(state.messages).toEqual([]);
  });

  test('deleteConversation keeps active selection when a different one is removed', async () => {
    useChatStore.setState({
      conversations: [
        { id: 'c1', type: 'direct_user_agent', created_at: 'a', updated_at: 'b' },
        { id: 'c2', type: 'direct_user_agent', created_at: 'a', updated_at: 'b' },
      ] as never,
      activeConversationId: 'c1',
      messages: [makeMessage()] as never,
    });

    await useChatStore.getState().deleteConversation('c2');

    const state = useChatStore.getState();
    expect(state.conversations.map((c) => c.id)).toEqual(['c1']);
    expect(state.activeConversationId).toBe('c1');
    expect(state.messages).toHaveLength(1);
  });

  test('addMessage appends a message for the active conversation', () => {
    useChatStore.setState({ activeConversationId: 'c1' });

    useChatStore.getState().addMessage(makeMessage() as never);

    expect(useChatStore.getState().messages.map((m) => m.id)).toEqual(['m1']);
  });

  test('addMessage ignores messages for other conversations', () => {
    useChatStore.setState({ activeConversationId: 'c1' });

    useChatStore.getState().addMessage(makeMessage({ conversation_id: 'other' }) as never);

    expect(useChatStore.getState().messages).toEqual([]);
  });

  test('addMessage deduplicates by id', () => {
    useChatStore.setState({ activeConversationId: 'c1', messages: [makeMessage()] as never });

    useChatStore.getState().addMessage(makeMessage({ content: 'changed' }) as never);

    const { messages } = useChatStore.getState();
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('hi');
  });

  test('setStreaming updates streaming flag and content', () => {
    useChatStore.getState().setStreaming(true, 'partial');
    expect(useChatStore.getState().streaming).toBe(true);
    expect(useChatStore.getState().streamContent).toBe('partial');

    useChatStore.getState().setStreaming(false);
    expect(useChatStore.getState().streaming).toBe(false);
    expect(useChatStore.getState().streamContent).toBe('');
  });

  test('setAgentStatus updates the agent status', () => {
    useChatStore.getState().setAgentStatus('thinking');
    expect(useChatStore.getState().agentStatus).toBe('thinking');

    useChatStore.getState().setAgentStatus(null);
    expect(useChatStore.getState().agentStatus).toBeNull();
  });
});
