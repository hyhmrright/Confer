import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFileAttachment } from '../hooks/useFileAttachment.js';
import { FOCUS_RING } from '../lib/styles.js';
import { useChatStore } from '../stores/chat.js';
import { Bot, Paperclip, Send, X } from './Icons.js';
import { LoadingDots } from './LoadingDots.js';
import { MessageBubble } from './MessageBubble.js';
import { StreamingMessage } from './StreamingMessage.js';

export function MessageView() {
  const { t } = useTranslation();
  // Per-field selectors. `useChatStore()` returns the whole state object, whose
  // identity changes on every set — including the per-token stream updates,
  // which would re-render this entire list. Note what is *absent*: streamContent
  // and streamCitations are subscribed to by StreamingMessage alone.
  const messages = useChatStore((s) => s.messages);
  const messagesLoading = useChatStore((s) => s.messagesLoading);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const streaming = useChatStore((s) => s.streaming);
  const agentStatus = useChatStore((s) => s.agentStatus);
  const hasOlderMessages = useChatStore((s) => s.hasOlderMessages);
  const loadingOlder = useChatStore((s) => s.loadingOlder);
  const loadOlderMessages = useChatStore((s) => s.loadOlderMessages);
  // Selecting the name itself, rather than the conversations array, keeps this
  // to a string comparison — the header does not re-render when an unrelated
  // conversation's unread count changes.
  const conversationName = useChatStore(
    (s) => s.conversations.find((c) => c.id === s.activeConversationId)?.name,
  );
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const { attachedFile, fileInputRef, handleFileChange, openFilePicker, clearAttachment } =
    useFileAttachment();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRaf = useRef(0);

  // Keyed on the *last* message rather than the array: loading older history
  // prepends, and depending on `messages` would yank the reader to the bottom
  // the moment they asked to see further back. Scrolling to follow the stream
  // lives in StreamingMessage, the only subscriber left to it.
  const lastMessageId = messages[messages.length - 1]?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll trigger
  useEffect(() => {
    cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(scrollRaf.current);
  }, [lastMessageId]);

  useEffect(() => {
    if (!streaming && textareaRef.current) textareaRef.current.focus();
  }, [streaming]);

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && !attachedFile) || sending) return;

    let fullText = text;
    if (attachedFile) {
      fullText = `${text ? `${text}\n\n` : ''}[文件: ${attachedFile.name}]\n\`\`\`\n${attachedFile.content}\n\`\`\``;
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
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
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
            {conversationName ?? t('message.title')}
          </span>
        </div>
        {streaming && (
          <div className="ml-auto flex items-center gap-1.5 text-xs text-primary-400 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" />
            {agentStatus ?? t('message.thinking')}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-5 space-y-5">
        {messagesLoading ? (
          <div className="flex items-center justify-center h-full">
            <LoadingDots size="md" />
          </div>
        ) : messages.length === 0 && !streaming ? (
          <div className="flex flex-col items-center justify-center h-full text-ink-muted gap-2">
            <Bot className="w-8 h-8 opacity-30" />
            <p className="text-sm text-ink-muted">{t('message.start')}</p>
          </div>
        ) : null}

        {hasOlderMessages && (
          <button
            type="button"
            onClick={loadOlderMessages}
            disabled={loadingOlder}
            className={`w-full py-2 text-xs text-ink-secondary hover:text-ink-primary hover:bg-dark-hover rounded-lg disabled:opacity-40 transition-colors ${FOCUS_RING}`}
          >
            {loadingOlder ? t('common.loading') : t('message.loadOlder')}
          </button>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* The in-flight reply, and the typing indicator that precedes its first
            token. Both live behind this one boundary so the per-token state
            never reaches the list above. */}
        {streaming && <StreamingMessage scrollAnchor={bottomRef} />}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 pb-4 pt-2 shrink-0">
        {/* The composer's focus indicator lives here rather than on the textarea:
            the bordered wrapper is what reads as the control, and the textarea
            inside it keeps `outline-hidden` so the two don't both draw. */}
        <div className="rounded-xl border border-dark-border bg-dark-input transition-colors focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-transparent">
          {/* Attached file preview */}
          {attachedFile && (
            <div className="flex items-center gap-2 px-3 pt-3 pb-0">
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-primary-600/10 border border-primary-600/20 text-xs text-primary-300 min-w-0">
                <Paperclip className="w-3 h-3 shrink-0" />
                <span className="truncate">{attachedFile.name}</span>
                <button
                  type="button"
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
              type="button"
              onClick={openFilePicker}
              disabled={sending || streaming}
              className="p-2 text-ink-muted hover:text-primary-400 hover:bg-primary-600/10 rounded-lg disabled:opacity-30 transition-colors shrink-0"
              title={t('message.uploadFile')}
            >
              <Paperclip className="w-4 h-4" />
            </button>

            <textarea
              ref={textareaRef}
              name="message-input"
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder={t('message.composerPlaceholder')}
              rows={1}
              className="flex-1 bg-transparent text-ink-primary text-sm leading-relaxed resize-none
                focus:outline-hidden placeholder:text-ink-muted py-1.5 px-1 max-h-40 scrollbar-thin"
              disabled={sending || streaming}
            />

            <button
              type="button"
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
          {t('message.sendHint')}
        </p>
      </div>
    </div>
  );
}
