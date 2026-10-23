import { beforeAll, describe, expect, test } from 'bun:test';
import { changeLanguage } from '../i18n/index.js';
import {
  type ConversationExport,
  exportFileName,
  exportToMarkdown,
} from './conversation-export.js';

const base = { sender_did: null, sender_name: null, content_type: 'text', citations_json: null };
const data: ConversationExport = {
  conversation: {
    id: '01ABCDEFGH',
    name: 'Acme: Q3 / pricing?',
    created_at: '2026-10-01T00:00:00Z',
  },
  truncated: false,
  messages: [
    {
      ...base,
      id: 'm1',
      sender_type: 'user',
      content: 'What is the price?',
      created_at: '2026-10-01T01:00:00Z',
    },
    {
      ...base,
      id: 'm2',
      sender_type: 'peer_agent',
      sender_did: 'did:web:acme.example',
      sender_name: 'Acme Bot',
      content: '4200 per seat.',
      citations_json: [{ doc_name: 'pricing.pdf', kb_name: 'Sales' }],
      created_at: '2026-10-01T01:01:00Z',
    },
    {
      ...base,
      id: 'm3',
      sender_type: 'own_agent',
      content_type: 'system_notice',
      content: 'The agent you asked has no model configured yet.',
      content_json: { kind: 'a2a_turn_failed', error: 'no_model_configured' },
      created_at: '2026-10-01T01:02:00Z',
    },
  ],
};

beforeAll(() => changeLanguage('en'));

describe('exportToMarkdown', () => {
  test('names each speaker, keeps sources, and words failure notices locally', async () => {
    const md = exportToMarkdown(data);
    expect(md.startsWith('# Acme: Q3 / pricing?\n')).toBe(true);
    expect(md).toContain('### You · ');
    expect(md).toContain('### Acme Bot · ');
    expect(md).toContain('- pricing.pdf (Sales)');
    // The stored English prose is not what the reader gets; the code is.
    expect(md).not.toContain('The agent you asked');
    expect(md).toContain('### Your agent · ');
  });

  test('switches language with the UI', async () => {
    await changeLanguage('zh');
    expect(exportToMarkdown(data)).toContain('### 我 · ');
    await changeLanguage('en');
  });

  test('says so when the thread was cut short', () => {
    expect(exportToMarkdown({ ...data, truncated: true })).toContain(
      '> Only the first 3 messages are included.',
    );
  });
});

describe('exportFileName', () => {
  test('strips characters a file system refuses', () => {
    expect(exportFileName(data, 'md')).toBe('Acme Q3 pricing.md');
  });

  test('falls back to the untitled label, then to a fixed name', () => {
    const untitled = { ...data, conversation: { ...data.conversation, name: null } };
    expect(exportFileName(untitled, 'json')).toBe('Chat 01ABCD.json');
    const blank = { ...data, conversation: { ...data.conversation, name: '///' } };
    expect(exportFileName(blank, 'md')).toBe('conversation.md');
  });
});
