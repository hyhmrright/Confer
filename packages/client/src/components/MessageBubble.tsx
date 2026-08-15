import { permissionRequestEventSchema } from '@confer/shared';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { dateLocale } from '../i18n/index.js';
import { Avatar } from './Avatar.js';
import { CitationCapsule } from './CitationCapsule.js';
import { PermissionCard } from './PermissionCard.js';

interface Citation {
  source: string;
  url?: string;
  page?: number;
  passage?: string;
  trust_level?: string;
}

interface Message {
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
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
}

// Memoized because a long thread re-renders whenever anything in the chat store
// changes, and this component re-parses its whole markdown body on every render
// (react-markdown does the parse inline, with no cache). Messages are only ever
// appended to, never mutated in place, so prop identity is genuinely stable and
// this skips real work rather than trading one comparison for another.
export const MessageBubble = memo(function MessageBubble({ message }: { message: Message }) {
  // No strings of its own, but formatTime() below reads the active locale.
  // Without this subscription memo would freeze every visible timestamp in the
  // previous language after a switch.
  useTranslation();
  const isUser = message.sender_type === 'user';

  if (message.content_type === 'permission_request') {
    const parsed = permissionRequestEventSchema.safeParse(message.content_json);
    if (parsed.success) {
      return (
        <div className="flex justify-start gap-3 animate-fade-in">
          <Avatar type="system" />
          <div className="max-w-[78%]">
            <PermissionCard request={parsed.data} />
            <p className="text-[10px] text-ink-muted mt-1 ml-1 font-mono">
              {formatTime(message.created_at)}
            </p>
          </div>
        </div>
      );
    }
  }

  return (
    <div className={`flex gap-3 animate-fade-in ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <Avatar type={message.sender_type} />
      <div className={`max-w-[78%] flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-2xl px-4 py-3 ${
            isUser
              ? 'user-bubble bg-linear-to-br from-primary-600 to-primary-700 text-white rounded-tr-sm shadow-lg shadow-primary-900/30'
              : 'agent-bubble bg-dark-card border border-dark-border text-ink-primary rounded-tl-sm'
          }`}
        >
          <div className="markdown-content text-sm leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content ?? ''}</ReactMarkdown>
          </div>
        </div>

        {!isUser && message.citations && message.citations.length > 0 && (
          <CitationCapsule citations={message.citations} />
        )}

        <p className={`text-[10px] text-ink-muted mt-1 font-mono ${isUser ? 'mr-1' : 'ml-1'}`}>
          {formatTime(message.created_at)}
        </p>
      </div>
    </div>
  );
});
