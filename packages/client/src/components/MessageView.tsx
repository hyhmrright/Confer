import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useFileAttachment } from '../hooks/useFileAttachment.js';
import { useChatStore } from '../stores/chat.js';
import { CitationCapsule } from './CitationCapsule.js';
import { Bot, Paperclip, Send, X } from './Icons.js';
import { MessageBubble } from './MessageBubble.js';
import { TypingIndicator } from './TypingIndicator.js';

export function MessageView() {
  const {
    conversations,
    activeConversationId,
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
  const { attachedFile, fileInputRef, handleFileChange, openFilePicker, clearAttachment } =
    useFileAttachment();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRaf = useRef(0);

  const activeConversation = conversations.find((c) => c.id === activeConversationId);

  useEffect(() => {
    cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(scrollRaf.current);
  }, [messages, streamContent]);

  useEffect(() => {
    if (!streaming && textareaRef.current) textareaRef.current.focus();
  }, [streaming]);

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && !attachedFile) || sending) return;

    let fullText = text;
    if (attachedFile) {
      fullText = `${text ? text + '\n\n' : ''}[文件: ${attachedFile.name}]\n\`\`\`\n${attachedFile.content}\n\`\`\``;
    }

    setInput('');
    clearAttachment();
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

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  const canSend = (input.trim().length > 0 || attachedFile !== null) && !sending && !streaming;

  return (
    <div className="flex-1 flex flex-col bg-dark-base min-w-0 overflow-hidden">
      {/* Chat header */}
      <div className="h-[52px] shrink-0 flex items-center px-5 border-b border-dark-border bg-dark-panel/40">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-primary-600/15 border border-primary-600/25 flex items-center justify-center">
            <Bot className="w-3.5 h-3.5 text-primary-400" />
          </div>
          <span className="text-sm font-medium text-ink-primary truncate">
            {activeConversation?.name ?? '对话'}
          </span>
        </div>
        {streaming && (
          <div className="ml-auto flex items-center gap-1.5 text-xs text-primary-400 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" />
            {agentStatus ?? '思考中'}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-5 space-y-5">
        {messagesLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex gap-1.5">
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="w-2 h-2 rounded-full bg-dark-border animate-bounce"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </div>
          </div>
        ) : messages.length === 0 && !streaming ? (
          <div className="flex flex-col items-center justify-center h-full text-ink-muted gap-2">
            <Bot className="w-8 h-8 opacity-30" />
            <p className="text-sm text-ink-muted">开始对话</p>
          </div>
        ) : null}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Streaming response */}
        {streaming && streamContent && (
          <div className="flex gap-3 animate-fade-in">
            <div className="w-8 h-8 rounded-full bg-dark-card border border-dark-border flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-ink-secondary" />
            </div>
            <div className="max-w-[78%]">
              <div className="agent-bubble bg-dark-card border border-dark-border rounded-2xl rounded-tl-sm px-4 py-3">
                <div className="markdown-content text-sm leading-relaxed text-ink-primary">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamContent}</ReactMarkdown>
                </div>
                <span className="inline-block w-[3px] h-4 bg-primary-400 animate-cursor-blink rounded-sm ml-0.5 align-text-bottom" />
              </div>
              {streamCitations.length > 0 && <CitationCapsule citations={streamCitations} />}
            </div>
          </div>
        )}

        {/* Typing / status indicator */}
        {streaming && !streamContent && (
          <div className="flex gap-3 items-center animate-fade-in">
            <div className="w-8 h-8 rounded-full bg-dark-card border border-dark-border flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-ink-secondary" />
            </div>
            <div className="bg-dark-card border border-dark-border rounded-2xl rounded-tl-sm px-4 py-3">
              <TypingIndicator label={agentStatus ?? undefined} />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 pb-4 pt-2 shrink-0">
        <div className="rounded-xl border border-dark-border bg-dark-input transition-colors focus-within:border-primary-600/50">
          {/* Attached file preview */}
          {attachedFile && (
            <div className="flex items-center gap-2 px-3 pt-3 pb-0">
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-primary-600/10 border border-primary-600/20 text-xs text-primary-300 min-w-0">
                <Paperclip className="w-3 h-3 shrink-0" />
                <span className="truncate">{attachedFile.name}</span>
                <button
                  onClick={clearAttachment}
                  className="shrink-0 hover:text-red-400 transition-colors ml-1"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          <div className="flex items-end gap-1 px-2 py-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.csv,.json,.yaml,.yml,.toml,.xml,.html,.css,.js,.ts,.py,.go,.rs,.java,.c,.cpp,.sh"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              onClick={openFilePicker}
              disabled={sending || streaming}
              className="p-2 text-ink-muted hover:text-primary-400 hover:bg-primary-600/10 rounded-lg disabled:opacity-30 transition-colors shrink-0"
              title="上传文件"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="输入消息… (Enter 发送，Shift+Enter 换行)"
              rows={1}
              className="flex-1 bg-transparent text-ink-primary text-sm leading-relaxed resize-none
                focus:outline-none placeholder:text-ink-muted py-1.5 px-1 max-h-40 scrollbar-thin"
              disabled={sending || streaming}
            />

            <button
              onClick={handleSend}
              disabled={!canSend}
              className="p-2 rounded-lg bg-primary-600 text-white hover:bg-primary-500
                disabled:opacity-25 disabled:cursor-not-allowed transition-all shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
        <p className="text-center text-[10px] text-ink-muted mt-1.5 font-mono">
          Enter 发送 · Shift+Enter 换行
        </p>
      </div>
    </div>
  );
}
