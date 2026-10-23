import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const getBlob = mock(async (_path: string) => new Blob(['x'], { type: 'image/png' }));
const postForm = mock(async (_path: string, _form: FormData) => ({}) as unknown);
const post = mock(async (_path: string, _body?: unknown) => ({}) as unknown);
mock.module('../lib/api.js', () => ({
  api: {
    getBlob,
    postForm,
    post,
    get: mock(async () => ({ documents: [], total: 0, conversations: [] })),
    put: mock(async () => ({})),
    patch: mock(async () => ({})),
    delete: mock(async () => ({})),
  },
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
  setOnAuthExpired: mock(() => {}),
  refreshSession: mock(async () => false),
  setOnTokenRefreshed: mock(() => {}),
  getToken: mock(() => null),
}));

const { changeLanguage } = await import('../i18n/index.js');
const { MessageAttachments } = await import('./MessageAttachments.js');
const { MessageView } = await import('./MessageView.js');
const { useChatStore } = await import('../stores/chat.js');

const meta = (id: string, filename: string, content_type: string) => ({
  id,
  filename,
  content_type,
  size_bytes: 1,
});

// happy-dom follows a clicked blob link and leaves the window's origin as
// "null" for every suite after this one, so the download's click is a no-op.
const realClick = HTMLAnchorElement.prototype.click;
afterEach(() => {
  HTMLAnchorElement.prototype.click = realClick;
});

beforeEach(async () => {
  HTMLAnchorElement.prototype.click = () => {};
  getBlob.mockClear();
  postForm.mockReset();
  post.mockReset();
  await changeLanguage('en');
});
// The composer test leaves a sent message in the store, which outlives this
// file; a later suite would render it against an api mock without getBlob.
afterEach(() => {
  cleanup();
  useChatStore.setState({ messages: [], activeConversationId: null });
});

describe('MessageAttachments', () => {
  // An <img src> cannot carry the session token, so the image is fetched with
  // it and shown from a blob URL.
  test('shows an image through an authenticated fetch, and offers a document', async () => {
    render(
      <MessageAttachments
        attachments={[
          meta('a1', 'cat.png', 'image/png'),
          meta('a2', 'plan.pdf', 'application/pdf'),
        ]}
      />,
    );
    const img = await screen.findByRole('img', { name: 'cat.png' });
    expect(img.getAttribute('src')?.startsWith('blob:')).toBe(true);
    expect(getBlob).toHaveBeenCalledWith('/attachments/a1/content');

    fireEvent.click(screen.getByRole('button', { name: 'Download plan.pdf' }));
    await waitFor(() => expect(getBlob).toHaveBeenCalledWith('/attachments/a2/content'));
  });
});

describe('composer', () => {
  // The reply stream is a plain fetch; refuse it here rather than let it reach
  // whatever happens to be listening on this machine's localhost.
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('uploads a picked file at once, and sends it with the message by id', async () => {
    useChatStore.setState({ activeConversationId: 'c1', messages: [], streaming: false });
    postForm.mockResolvedValueOnce({ attachment: meta('att-1', 'cat.png', 'image/png') });
    post.mockResolvedValueOnce({ id: 'm1', stream_url: '/nowhere' });
    const { container } = render(<MessageView />);

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'cat.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(postForm).toHaveBeenCalledTimes(1));
    expect(postForm.mock.calls[0]?.[0]).toBe('/attachments');
    await waitFor(() => expect(screen.queryByText('Uploading…')).toBeNull());

    // No caption: an image alone is a message.
    const send = container.querySelector('button.bg-primary-600') as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]).toEqual([
      '/conversations/c1/messages',
      { content: '', content_type: 'text', via: 'web', attachment_ids: ['att-1'] },
    ]);
  });
});
