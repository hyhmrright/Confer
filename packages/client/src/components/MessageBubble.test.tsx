import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';

mock.module('../lib/api.js', () => ({
  api: { post: mock(async () => ({})), get: mock(async () => ({})), put: mock(async () => ({})) },
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
  setOnAuthExpired: mock(() => {}),
  setOnTokenRefreshed: mock(() => {}),
  getToken: mock(() => null),
}));

await import('../i18n/index.js');
const { MessageBubble } = await import('./MessageBubble.js');

const base = {
  id: 'm1',
  conversation_id: 'c1',
  sender_type: 'agent',
  sender_id: 'a1',
  content_type: 'text',
  created_at: '2026-08-07T10:30:00Z',
};

afterEach(cleanup);

describe('MessageBubble markdown rendering', () => {
  // react-markdown 10 dropped the `className` prop. These assertions fail loudly
  // if a future bump changes what the renderer emits for ordinary markdown.
  test('renders headings, emphasis, links and inline code as real elements', () => {
    render(
      <MessageBubble
        message={{
          ...base,
          content: '## 标题\n\n**粗体** 和 `code` 还有 [链接](https://example.com)',
        }}
      />,
    );
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('标题');
    expect(screen.getByText('粗体').tagName).toBe('STRONG');
    expect(screen.getByText('code').tagName).toBe('CODE');
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://example.com');
  });

  test('renders GFM tables — proves remarkGfm is still wired in', () => {
    render(<MessageBubble message={{ ...base, content: '| a | b |\n| --- | --- |\n| 1 | 2 |' }} />);
    expect(screen.getByRole('table')).toBeDefined();
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    expect(screen.getAllByRole('cell')).toHaveLength(2);
  });

  test('renders fenced code blocks inside a pre', () => {
    render(<MessageBubble message={{ ...base, content: '```ts\nconst x = 1;\n```' }} />);
    const code = screen.getByText(/const x = 1;/);
    expect(code.closest('pre')).not.toBeNull();
  });

  test('tolerates null content without throwing', () => {
    render(<MessageBubble message={{ ...base, content: null }} />);
    expect(screen.getByText(/\d{1,2}:\d{2}/)).toBeDefined();
  });

  test('a permission_request message renders the decision card, not markdown', () => {
    render(
      <MessageBubble
        message={{
          ...base,
          content: null,
          content_type: 'permission_request',
          content_json: {
            id: 'p1',
            level: 'L2',
            action: 'send_message',
            scope: {},
            peer_name: 'Bob',
            peer_did: 'did:web:example.com',
            requested_at: '2026-08-07T10:29:00Z',
          },
        }}
      />,
    );
    expect(screen.getByText(/Bob/)).toBeDefined();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  test('falls back to a normal bubble when content_json fails schema validation', () => {
    render(
      <MessageBubble
        message={{
          ...base,
          content: '普通文本',
          content_type: 'permission_request',
          content_json: { nope: true },
        }}
      />,
    );
    expect(screen.getByText('普通文本')).toBeDefined();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('agent-turn failure notice', () => {
  const notice = {
    ...base,
    sender_type: 'own_agent',
    content_type: 'system_notice',
    // The English fallback the gateway writes for peers that are not our UI.
    content: 'The agent you asked has no model configured yet.',
  };

  test('words the machine code instead of showing the gateway English', () => {
    // The gateway has no locale context, so what it wrote is a fallback for
    // non-UI readers. Rendering it here would put English in front of every
    // zh/ja user — the exact boundary `permission.request` already respects.
    render(
      <MessageBubble
        message={{
          ...notice,
          content_json: { kind: 'a2a_turn_failed', error: 'no_model_configured' },
        }}
      />,
    );

    expect(screen.queryByText(/no model configured yet/i)).toBeNull();
    expect(screen.getByText(/设置|Settings|設定/)).toBeDefined();
  });

  test('falls back to a generic sentence for a code it does not know', () => {
    // A newer gateway can add codes; an unknown one must still say something.
    render(
      <MessageBubble
        message={{ ...notice, content_json: { kind: 'a2a_turn_failed', error: 'agent_error' } }}
      />,
    );
    expect(screen.getByText(/没有完成|did not finish|完了しませんでした/)).toBeDefined();
    expect(screen.queryByText(/no model configured yet/i)).toBeNull();
  });

  test('renders a malformed payload as an ordinary message rather than blank', () => {
    render(<MessageBubble message={{ ...notice, content_json: { unexpected: true } }} />);
    expect(screen.getByText(/no model configured yet/i)).toBeDefined();
  });
});
