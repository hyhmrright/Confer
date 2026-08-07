import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';

mock.module('../lib/api.js', () => ({
  api: { post: mock(async () => ({})), get: mock(async () => ({})), put: mock(async () => ({})) },
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
  setOnAuthExpired: mock(() => {}),
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
            description: '请求发送消息',
            requested_at: '2026-08-07T10:29:00Z',
          },
        }}
      />,
    );
    expect(screen.getByText('请求发送消息')).toBeDefined();
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
