import i18n, { dateLocale } from '../i18n/index.js';
import { agentFailureText } from './agent-failure-text.js';

// The shape of `GET /conversations/{id}/export`: facts, which this file words.
export interface ConversationExport {
  conversation: { id: string; name: string | null; created_at: string };
  messages: Array<{
    id: string;
    sender_type: string;
    sender_did: string | null;
    sender_name: string | null;
    content_type: string;
    content: string | null;
    content_json?: unknown;
    citations_json: unknown;
    created_at: string;
  }>;
  truncated: boolean;
}

type ExportedMessage = ConversationExport['messages'][number];

function title(data: ConversationExport): string {
  return (
    data.conversation.name ??
    i18n.t('conversations.untitled', { id: data.conversation.id.slice(0, 6) })
  );
}

function speaker(m: ExportedMessage): string {
  if (m.sender_type === 'user') return i18n.t('export.you');
  if (m.sender_type === 'own_agent') return i18n.t('export.yourAgent');
  return m.sender_name ?? m.sender_did ?? i18n.t('permission.unknownPeer');
}

function body(m: ExportedMessage): string {
  // A failure notice stores a machine code; its stored prose is English only.
  if (m.content_type === 'system_notice') {
    const code = (m.content_json as { error?: unknown } | null)?.error;
    return `_${agentFailureText(typeof code === 'string' ? code : '')}_`;
  }
  return m.content ?? '';
}

function sources(citations: unknown): string[] {
  if (!Array.isArray(citations)) return [];
  return citations.map((c: { doc_name?: string; kb_name?: string }) =>
    c.kb_name ? `${c.doc_name ?? '?'} (${c.kb_name})` : (c.doc_name ?? '?'),
  );
}

/** A readable transcript, in the reader's language. */
export function exportToMarkdown(data: ConversationExport): string {
  const when = (iso: string) => new Date(iso).toLocaleString(dateLocale());
  const lines = [`# ${title(data)}`, ''];
  if (data.truncated) {
    lines.push(`> ${i18n.t('export.truncated', { count: data.messages.length })}`, '');
  }
  for (const m of data.messages) {
    lines.push(`### ${speaker(m)} · ${when(m.created_at)}`, '', body(m), '');
    const cited = sources(m.citations_json);
    if (cited.length > 0) {
      lines.push(`**${i18n.t('export.sources')}**`, ...cited.map((s) => `- ${s}`), '');
    }
  }
  return lines.join('\n');
}

/** A file name the OS will accept: the title with path and reserved characters removed. */
export function exportFileName(data: ConversationExport, extension: 'md' | 'json'): string {
  const safe = title(data)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what a file name must not carry
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${safe || 'conversation'}.${extension}`;
}

/** Hand the reader a file, without a round trip to the server. */
export function downloadText(fileName: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  // Revoked on the next tick: some engines start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
