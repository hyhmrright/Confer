import { afterEach, describe, expect, mock, test } from 'bun:test';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import * as reactMarkdown from 'react-markdown';

// Read out before the `mock.module` below, so this const holds the real
// component. A plain `import RealMarkdown from 'react-markdown'` does not work:
// `mock.module` rebinds that binding to the replacement, which then renders
// itself and hangs the run — tried, not assumed.
const RealMarkdown = reactMarkdown.default;

// The point of this file. `d37518c` moved the per-token stream state out of
// MessageView and into StreamingMessage, and memoised MessageBubble, on the
// argument that the list was otherwise re-parsing every message's markdown once
// per streamed token. That argument was never measured — the authenticated
// shell is not reachable from a headless run — so it is pinned here instead.
//
// react-markdown parses inside its render body with no cache (`runSync(parse())`
// in lib/index.js), so one render of it *is* one parse. Counting renders of the
// wrapper below therefore counts real parse work, and separating them by content
// prefix keeps the streaming bubble — which is supposed to re-render per token —
// out of the number under test.
let historyParses = 0;
let streamParses = 0;

// The counter wraps the real renderer rather than standing in for it, and that
// is load-bearing: `mock.module` is process-global and permanent — bun cannot
// unregister one — and bun walks test files in filesystem order, not
// alphabetically. A stub returning `<span>{children}</span>` therefore reached
// MessageBubble.test.tsx, which asserts the *real* renderer's output, on every
// machine whose readdir put that file second. CI's did and a dev's macOS did
// not, so the suite was green locally and red on unrelated PRs. Wrapping does
// not stop the leak; it makes it behaviour-preserving, which is the only
// property available here. Same reason `remark-gfm` is left unmocked.
mock.module('react-markdown', () => ({
  default: (props: ComponentProps<typeof RealMarkdown>) => {
    const { children } = props;
    if (typeof children === 'string' && children.startsWith('HISTORY')) historyParses++;
    else streamParses++;
    return <RealMarkdown {...props} />;
  },
}));

mock.module('../lib/api.js', () => ({
  api: {
    get: mock(async () => ({})),
    post: mock(async () => ({})),
    put: mock(async () => ({})),
    patch: mock(async () => ({})),
    del: mock(async () => ({})),
  },
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
  setOnAuthExpired: mock(() => {}),
  setOnTokenRefreshed: mock(() => {}),
  getToken: mock(() => 'test-token'),
}));

mock.module('../lib/ws.js', () => ({
  connectWs: mock(() => {}),
  disconnectWs: mock(() => {}),
  reconnectWs: mock(() => {}),
  onWsMessage: mock(() => () => {}),
  subscribeConversation: mock(() => {}),
  unsubscribeConversation: mock(() => {}),
}));

const { MessageView } = await import('./MessageView.js');
const { useChatStore } = await import('../stores/chat.js');
const { changeLanguage } = await import('../i18n/index.js');

await changeLanguage('en');

const HISTORY_LENGTH = 20;
const TOKENS = 30;

const history = Array.from({ length: HISTORY_LENGTH }, (_, i) => ({
  id: `m${i}`,
  conversation_id: 'c1',
  sender_type: i % 2 === 0 ? 'user' : 'agent',
  sender_id: 'u1',
  content: `HISTORY message ${i}`,
  content_type: 'text',
  created_at: '2026-08-16T00:00:00.000Z',
}));

function seed() {
  historyParses = 0;
  streamParses = 0;
  useChatStore.setState({
    messages: history,
    conversations: [{ id: 'c1', type: 'direct', created_at: '', updated_at: '' }],
    activeConversationId: 'c1',
    messagesLoading: false,
    loadingOlder: false,
    hasOlderMessages: false,
    streaming: true,
    streamContent: '',
    streamCitations: [],
    agentStatus: null,
  });
}

// One `set` per token is exactly what the SSE handler does in the real store.
function streamTokens(count: number) {
  for (let i = 0; i < count; i++) {
    act(() => {
      useChatStore.setState((s) => ({ streamContent: `${s.streamContent}tok${i} ` }));
    });
  }
}

afterEach(cleanup);

describe('MessageView streaming cost', () => {
  test('a streamed token does not re-parse the messages already on screen', () => {
    seed();
    render(<MessageView />);
    expect(historyParses).toBe(HISTORY_LENGTH);

    const before = historyParses;
    streamTokens(TOKENS);

    // Zero, not "fewer": none of the history's props moved, so no amount of
    // streaming should touch it. With both of the fix's halves reverted this
    // grows to 600 for this run — measured, not estimated.
    //
    // Worth knowing which half you are relying on: MessageView's per-field
    // selectors and MessageBubble's `memo` are each *independently* sufficient
    // here, so this stays green if either one is removed alone. That is why
    // the two tests below pin `memo` separately — and why the selector split
    // still matters despite the redundancy: ChatLayout, ConversationsPanel and
    // ContactList subscribe to the same store with no memo to fall back on.
    expect(historyParses - before).toBe(0);
  });

  test('the streaming bubble does re-render, once per token', () => {
    seed();
    render(<MessageView />);

    const before = streamParses;
    streamTokens(TOKENS);

    // The other half of the same claim: the work was moved, not removed. If
    // this ever drops to 0 the stream has stopped rendering incrementally.
    expect(streamParses - before).toBe(TOKENS);
  });

  test('a new message in the list re-parses only itself', () => {
    seed();
    render(<MessageView />);
    const before = historyParses;

    act(() => {
      useChatStore.setState((s) => ({
        messages: [
          ...s.messages,
          {
            id: 'm-new',
            conversation_id: 'c1',
            sender_type: 'agent',
            sender_id: 'a1',
            content: 'HISTORY the reply',
            content_type: 'text',
            created_at: '2026-08-16T00:01:00.000Z',
          },
        ],
      }));
    });

    expect(historyParses - before).toBe(1);
  });

  test('switching language re-renders memoised bubbles', async () => {
    seed();
    render(<MessageView />);
    const before = historyParses;

    try {
      await act(async () => {
        await changeLanguage('ja');
      });

      // MessageBubble carries no strings of its own, so `memo` looks safe on it
      // — but it formats timestamps against the active locale. Without the
      // `useTranslation()` subscription that dependency is invisible to React
      // and every visible timestamp freezes in the previous language.
      expect(historyParses - before).toBe(HISTORY_LENGTH);
    } finally {
      // finally, not a trailing line: a failed assertion above would otherwise
      // leave the whole process in Japanese for every test that follows.
      await act(async () => {
        await changeLanguage('en');
      });
    }
  });

  test('the header tracks the active conversation without the list re-rendering', () => {
    seed();
    render(<MessageView />);
    const before = historyParses;

    act(() => {
      useChatStore.setState({
        conversations: [
          { id: 'c1', type: 'direct', name: 'Renamed', created_at: '', updated_at: '' },
        ],
      });
    });

    expect(screen.getByText('Renamed')).toBeDefined();
    expect(historyParses - before).toBe(0);
  });
});
