import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const get = mock(async (_path: string) => ({}) as unknown);
const patch = mock(async (_path: string, body?: unknown) => ({ conversation: body }) as unknown);
const post = mock(async (_path: string, _body?: unknown) => ({}) as unknown);
mock.module('../lib/api.js', () => ({
  api: { get, patch, post, put: mock(async () => ({})), delete: mock(async () => ({})) },
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
  setOnAuthExpired: mock(() => {}),
  refreshSession: mock(async () => false),
  setOnTokenRefreshed: mock(() => {}),
  getToken: mock(() => null),
}));

const { changeLanguage } = await import('../i18n/index.js');
const { useChatStore } = await import('../stores/chat.js');
const { ConversationsPanel } = await import('./ConversationsPanel.js');

const conv = (id: string, name: string, unread_count: number) => ({
  id,
  type: 'direct_user_agent',
  name,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  unread_count,
});

// Every path a store calls gets its real shape. The knowledge-base upload
// poller from another suite outlives that suite by up to 30s and shares this
// module mock, so an arm missing here throws inside whatever test is running.
let hits: unknown[] = [];
function serve(conversations: unknown[] = []) {
  get.mockImplementation(async (path: string) =>
    path.startsWith('/knowledge-bases')
      ? { documents: [], total: 0 }
      : path.startsWith('/search/messages')
        ? { results: hits }
        : { conversations },
  );
}

beforeEach(async () => {
  serve();
  patch.mockClear();
  await changeLanguage('en');
  useChatStore.setState({
    conversations: [conv('c1', 'Open one', 3), conv('c2', 'Vendor thread', 5)],
    activeConversationId: 'c1',
    showArchived: false,
  });
});
afterEach(cleanup);

describe('ConversationsPanel', () => {
  // The open thread is being read as it arrives, so a list fetched a moment
  // before the read landed must not badge it.
  test('badges unread threads, but never the one that is open', () => {
    render(<ConversationsPanel />);
    expect(screen.getByRole('status', { name: '5 unread' })).toBeDefined();
    expect(screen.queryByRole('status', { name: '3 unread' })).toBeNull();
  });

  test('renames inline: Enter saves the trimmed name, Escape abandons it', async () => {
    render(<ConversationsPanel />);
    const row = screen.getByText('Vendor thread').closest('div.group') as HTMLElement;

    fireEvent.mouseEnter(row);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Conversation name' });
    fireEvent.change(input, { target: { value: '  Acme pricing ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith('/conversations/c2', { name: 'Acme pricing' });
    await waitFor(() => expect(screen.getByText('Acme pricing')).toBeDefined());

    fireEvent.mouseEnter(row);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Conversation name' }), {
      key: 'Escape',
    });
    expect(patch).toHaveBeenCalledTimes(1);
  });

  test('archiving takes the thread off this shelf; the toggle shows the other one', async () => {
    render(<ConversationsPanel />);
    const row = screen.getByText('Vendor thread').closest('div.group') as HTMLElement;

    fireEvent.mouseEnter(row);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(screen.queryByText('Vendor thread')).toBeNull());
    expect(patch).toHaveBeenCalledWith('/conversations/c2', { archived: true });

    serve([conv('c2', 'Vendor thread', 0)]);
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    await waitFor(() => expect(screen.getByText('Vendor thread')).toBeDefined());
    expect(get).toHaveBeenCalledWith('/conversations?archived=1');
  });

  // Message text lives only on the server; a hit opens its thread even when
  // that thread is on the other shelf, under its own name.
  test('searches message text and opens the thread a hit belongs to', async () => {
    hits = [
      {
        message_id: 'm9',
        conversation_id: 'c-archived',
        conversation_name: 'Old vendor thread',
        sender_type: 'peer_agent',
        content: `${'filler '.repeat(20)}the quote was 4200 per seat${' filler'.repeat(20)}`,
        created_at: '2026-09-01T00:00:00Z',
      },
    ];
    render(<ConversationsPanel />);

    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'quote' } });
    const hit = await screen.findByText(/the quote was 4200/);
    expect(hit.textContent?.startsWith('…')).toBe(true);
    expect(get).toHaveBeenCalledWith('/search/messages?q=quote');

    fireEvent.click(hit);
    await waitFor(() => expect(useChatStore.getState().activeConversationId).toBe('c-archived'));
    expect(useChatStore.getState().activeConversationName).toBe('Old vendor thread');
    hits = [];
  });
});
