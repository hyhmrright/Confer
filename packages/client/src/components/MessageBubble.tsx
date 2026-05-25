import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, User } from './Icons.js';
import CitationCapsule from './CitationCapsule.js';
import PermissionCard from './PermissionCard.js';

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
      <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
        <User className="w-4 h-4 text-primary-600" />
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
      <Bot className="w-4 h-4 text-gray-600" />
    </div>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export default function MessageBubble({ message }: { message: Message }) {
  const isUser = message.sender_type === 'user';

  if (message.content_type === 'permission_request') {
    const req = message.content_json as {
      id: string;
      level: string;
      action: string;
      scope: Record<string, unknown>;
      description: string;
      requested_at: string;
    };
    if (req) {
      return (
        <div className="flex justify-start gap-2 animate-fade-in">
          <Avatar type="system" />
          <div className="max-w-[75%]">
            <PermissionCard request={req} />
            <div className="text-[10px] text-gray-300 mt-1 ml-1">{formatTime(message.created_at)}</div>
          </div>
        </div>
      );
    }
  }

  return (
    <div className={`flex gap-2 animate-fade-in ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <Avatar type={message.sender_type} />
      <div className={`max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 ${
            isUser
              ? 'user-bubble bg-primary-600 text-white rounded-tr-md'
              : 'agent-bubble bg-white border border-gray-200 text-gray-800 rounded-tl-md shadow-sm'
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
        <div className={`text-[10px] text-gray-300 mt-1 ${isUser ? 'text-right mr-1' : 'ml-1'}`}>
          {formatTime(message.created_at)}
        </div>
      </div>
    </div>
  );
}
