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
  setOnAuthExpired: mock(() => {}),
  setOnTokenRefreshed: mock(() => {}),
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
    const conversations = [
      { id: 'c1', type: 'direct_user_agent', created_at: 'a', updated_at: 'b' },
    ];
    get.mockResolvedValueOnce({ conversations });

    await useChatStore.getState().loadConversations();

    expect(get).toHaveBeenCalledWith('/conversations');
    expect(useChatStore.getState().conversations).toEqual(conversations as never);
  });

  test('selectConversation loads messages and resets stream state', async () => {
    const messages = [makeMessage()];
    get.mockResolvedValueOnce({ messages });

    await useChatStore.getState().selectConversation('c1');

    expect(get).toHaveBeenCalledWith('/conversations/c1/messages?limit=50');
    const state = useChatStore.getState();
    expect(state.activeConversationId).toBe('c1');
    expect(state.messages).toEqual(messages as never);
    expect(state.messagesLoading).toBe(false);
    expect(state.streaming).toBe(false);
    // A short page means the whole thread is on screen; no "load earlier" offer.
    expect(state.hasOlderMessages).toBe(false);
  });

  test('loadOlderMessages walks backwards from the oldest message on screen', async () => {
    // A full page on open is the signal that there is history behind it.
    get.mockResolvedValueOnce({
      messages: Array.from({ length: 50 }, (_, i) => makeMessage({ id: `m${i + 50}` })),
    });
    await useChatStore.getState().selectConversation('c1');
    expect(useChatStore.getState().hasOlderMessages).toBe(true);

    get.mockResolvedValueOnce({ messages: [makeMessage({ id: 'm1' })] });
    await useChatStore.getState().loadOlderMessages();

    expect(get).toHaveBeenLastCalledWith('/conversations/c1/messages?limit=50&before=m50');
    const state = useChatStore.getState();
    expect(state.messages[0]?.id).toBe('m1');
    expect(state.messages).toHaveLength(51);
    expect(state.loadingOlder).toBe(false);
    // The short page means we have reached the beginning of the thread.
    expect(state.hasOlderMessages).toBe(false);
  });

  test('loadOlderMessages discards a page that arrives after the user switched threads', async () => {
    get.mockResolvedValueOnce({
      messages: Array.from({ length: 50 }, (_, i) => makeMessage({ id: `m${i + 50}` })),
    });
    await useChatStore.getState().selectConversation('c1');

    // The older page resolves only after the active conversation has moved on.
    get.mockImplementationOnce(async () => {
      useChatStore.setState({ activeConversationId: 'c2', messages: [] });
      return { messages: [makeMessage({ id: 'm1' })] };
    });
    await useChatStore.getState().loadOlderMessages();

    expect(useChatStore.getState().messages).toEqual([]);
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
      conversations: [
        { id: 'c1', type: 'direct_user_agent', created_at: 'a', updated_at: 'b' },
      ] as never,
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

  test('createConversation falls back to a generated name when none is given', async () => {
    const conversation = { id: 'c2', type: 'direct_user_agent', created_at: 'a', updated_at: 'b' };
    post.mockResolvedValueOnce({ conversation });

    await useChatStore.getState().createConversation('p1');

    expect(post).toHaveBeenCalledWith(
      '/conversations',
      expect.objectContaining({
        type: 'direct_user_agent',
        peer_id: 'p1',
        name: expect.any(String),
      }),
    );
    const body = (post.mock.calls[0] as [string, { name: string }])[1];
    expect(body.name.length).toBeGreaterThan(0);
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

  test('sendMessage is a no-op when there is no active conversation', async () => {
    useChatStore.setState({ activeConversationId: null });
    await useChatStore.getState().sendMessage('hello');
    expect(post).not.toHaveBeenCalled();
    expect(useChatStore.getState().messages).toEqual([]);
  });

  // Regression: the gateway broadcasts `message.new` over the WebSocket before
  // it writes the stream's `done` event, so by the time the reply is finalized
  // it is normally already in `messages`. finalizeAgent appended regardless,
  // which rendered every single answer twice until the user reloaded.
  test('sendMessage does not re-append a reply the WebSocket already delivered', async () => {
    const sse = 'event: token\ndata: {"text":"hi"}\n\nevent: done\ndata: {"message_id":"a1"}\n\n';
    const realFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async () => new Response(sse, { status: 200 }),
    ) as unknown as typeof fetch;
    post.mockResolvedValue({ id: 'u1', stream_url: '/stream/c1/u1' });

    // The agent reply has already landed over the WebSocket.
    useChatStore.setState({
      activeConversationId: 'c1',
      messages: [makeMessage({ id: 'a1', sender_type: 'own_agent', content: 'hi' })] as never,
    });

    try {
      await useChatStore.getState().sendMessage('hello');
    } finally {
      globalThis.fetch = realFetch;
    }

    const { messages, streaming } = useChatStore.getState();
    expect(messages.filter((m) => m.id === 'a1')).toHaveLength(1);
    expect(streaming).toBe(false);
  });

  // Send one message against a stream that answers with a single error event,
  // and hand back the state the reader settled on.
  async function sendAgainstStreamError(message: string) {
    const sse = `event: error\ndata: ${JSON.stringify({ message })}\n\n`;
    const realFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async () => new Response(sse, { status: 200 }),
    ) as unknown as typeof fetch;
    post.mockResolvedValue({ id: 'u1', stream_url: '/stream/c1/u1' });
    useChatStore.setState({ activeConversationId: 'c1', messages: [] });

    try {
      await useChatStore.getState().sendMessage('hello');
    } finally {
      globalThis.fetch = realFetch;
    }
    return useChatStore.getState();
  }

  // The reader ignores `event:` lines and keys off the payload, so an error
  // event used to fall through to the tail finalize — committing an empty reply
  // under a random id. A blank bubble presented as the agent's answer is worse
  // than no bubble, and the gateway now sends this whenever a second request
  // arrives for a turn already being generated.
  test.each([
    // Not a failure: another tab is producing this very answer and it arrives
    // over the WebSocket, so the reader should go quiet rather than complain.
    ['already_generating', false],
    // A misconfiguration names its own fix rather than "try again": the reader
    // has not chosen a model, and retrying will fail exactly the same way.
    ['no_model_configured', true],
    ['no_key_for_provider', true],
    ['agent_error', true],
  ])('sendMessage commits nothing when the stream reports %s', async (message, notifies) => {
    const state = await sendAgainstStreamError(message);

    // Only the message the user sent; no agent turn was produced.
    expect(state.messages.map((m) => m.sender_type)).toEqual(['user']);
    expect(state.streaming).toBe(false);
    expect(state.agentStatus !== null).toBe(notifies);
    // Whatever is shown is the client's own translated copy, never the
    // gateway's wording — it has no locale to write in.
    expect(state.agentStatus).not.toBe(message);
  });

  // "That turn did not finish, try again" is wrong advice for an agent with no
  // model: retrying fails identically. The code has to survive the trip as a
  // code, not be flattened into one generic apology.
  test('a missing model is worded differently from a failed turn', async () => {
    const noModel = (await sendAgainstStreamError('no_model_configured')).agentStatus;
    const noKey = (await sendAgainstStreamError('no_key_for_provider')).agentStatus;
    const generic = (await sendAgainstStreamError('agent_error')).agentStatus;

    expect(noModel).not.toBe(generic);
    expect(noKey).not.toBe(generic);
    expect(noModel).not.toBe(noKey);
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
