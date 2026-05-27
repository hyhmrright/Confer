import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { z } from 'zod';
import { Bot, User } from './Icons.js';
import { CitationCapsule } from './CitationCapsule.js';
import { PermissionCard } from './PermissionCard.js';

const permissionRequestSchema = z.object({
  id: z.string(),
  level: z.string(),
  action: z.string(),
  scope: z.record(z.unknown()),
  description: z.string(),
  requested_at: z.string(),
});

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

function Avatar({ type }: { type: string }) {
  if (type === 'user') {
    return (
      <div className="w-8 h-8 rounded-full bg-primary-600/20 border border-primary-600/30 flex items-center justify-center shrink-0">
        <User className="w-4 h-4 text-primary-400" />
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-dark-card border border-dark-border flex items-center justify-center shrink-0">
      <Bot className="w-4 h-4 text-ink-secondary" />
    </div>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.sender_type === 'user';

  if (message.content_type === 'permission_request') {
    const parsed = permissionRequestSchema.safeParse(message.content_json);
    if (parsed.success) {
      return (
        <div className="flex justify-start gap-3 animate-fade-in">
          <Avatar type="system" />
          <div className="max-w-[78%]">
            <PermissionCard request={parsed.data} />
            <p className="text-[10px] text-ink-muted mt-1 ml-1 font-mono">{formatTime(message.created_at)}</p>
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
              ? 'user-bubble bg-gradient-to-br from-primary-600 to-primary-700 text-white rounded-tr-sm shadow-lg shadow-primary-900/30'
              : 'agent-bubble bg-dark-card border border-dark-border text-ink-primary rounded-tl-sm'
          }`}
        >
          <div className="markdown-content text-sm leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content ?? ''}
            </ReactMarkdown>
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
}
