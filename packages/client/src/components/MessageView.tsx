import { useRef, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useChatStore } from '../stores/chat.js';
import { Send, Bot, Paperclip, X } from './Icons.js';
import { MessageBubble } from './MessageBubble.js';
import { CitationCapsule } from './CitationCapsule.js';
import { TypingIndicator } from './TypingIndicator.js';

const MAX_FILE_CHARS = 40_000;

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file, 'utf-8');
  });
}

export function MessageView() {
  const {
    messages,
    messagesLoading,
    sendMessage,
    streaming,
    streamContent,
    streamCitations,
    agentStatus,
  } = useChatStore();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRaf = useRef(0);

  useEffect(() => {
    cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(scrollRaf.current);
  }, [messages, streamContent]);

  useEffect(() => {
    if (!streaming && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [streaming]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      let content = await readFileAsText(file);
      if (content.length > MAX_FILE_CHARS) {
        content = content.slice(0, MAX_FILE_CHARS) + '\n\n[内容已截断]';
      }
      setAttachedFile({ name: file.name, content });
    } catch {
      alert('无法读取该文件，请选择文本文件。');
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text && !attachedFile || sending) return;

    let fullText = text;
    if (attachedFile) {
      fullText = `${text ? text + '\n\n' : ''}[文件: ${attachedFile.name}]\n\`\`\`\n${attachedFile.content}\n\`\`\``;
    }

    setInput('');
    setAttachedFile(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setSending(true);
    try {
      await sendMessage(fullText);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = (input.trim().length > 0 || attachedFile !== null) && !sending && !streaming;

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-50 min-w-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {messagesLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex gap-1.5">
              <span className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        ) : messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full text-gray-300">
            <p className="text-lg font-medium">开始对话</p>
            <p className="text-sm mt-1">输入消息与 Agent 交流</p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Streaming response */}
        {streaming && streamContent && (
          <div className="flex gap-2 animate-fade-in">
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-gray-600" />
            </div>
            <div className="max-w-[75%]">
              <div className="agent-bubble bg-white border border-gray-200 rounded-2xl rounded-tl-md px-4 py-2.5 shadow-sm">
                <div className="markdown-content text-sm leading-relaxed text-gray-800">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamContent}</ReactMarkdown>
                </div>
                <span className="inline-block w-1.5 h-4 bg-primary-500 animate-pulse rounded-sm ml-0.5 align-text-bottom" />
              </div>
              {streamCitations.length > 0 && (
                <CitationCapsule citations={streamCitations} />
              )}
            </div>
          </div>
        )}

        {/* Agent status / typing indicator */}
        {streaming && !streamContent && (
          <div className="flex gap-2 items-center">
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-gray-600" />
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-md px-4 py-3 shadow-sm">
              <TypingIndicator label={agentStatus ?? undefined} />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Agent status bar */}
      {agentStatus && streamContent && (
        <div className="px-4 py-1.5 bg-primary-50 border-t border-primary-100 text-xs text-primary-600 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse" />
          {agentStatus}
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-gray-200 bg-white">
        {/* Attached file preview */}
        {attachedFile && (
          <div className="mb-2 flex items-center gap-2 px-3 py-1.5 bg-primary-50 border border-primary-200 rounded-lg text-sm text-primary-700">
            <Paperclip className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 truncate">{attachedFile.name}</span>
            <button onClick={() => setAttachedFile(null)} className="shrink-0 hover:text-red-500 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.csv,.json,.yaml,.yml,.toml,.xml,.html,.css,.js,.ts,.py,.go,.rs,.java,.c,.cpp,.sh"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || streaming}
            className="p-2.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-xl disabled:opacity-30 transition-colors shrink-0"
            title="上传文件"
          >
            <Paperclip className="w-[18px] h-[18px]" />
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
            rows={1}
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm leading-relaxed max-h-40"
            disabled={sending || streaming}
          />
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="p-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            <Send className="w-[18px] h-[18px]" />
          </button>
        </div>
      </div>
    </div>
  );
}
