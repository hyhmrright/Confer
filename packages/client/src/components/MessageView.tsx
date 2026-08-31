import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFileAttachment } from '../hooks/useFileAttachment.js';
import { DISABLED, DISABLED_FILLED, FOCUS_RING } from '../lib/styles.js';
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
      <div className="h-[52px] shrink-0 flex items-center gap-3 px-6 border-b border-dark-border bg-dark-panel/40">
        <h1 className="font-display text-base text-ink-primary truncate min-w-0">
          {conversationName ?? t('message.title')}
        </h1>
        {streaming && (
          <div className="ms-auto shrink-0 flex items-center gap-1.5 eyebrow text-primary-400">
            <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" />
            {agentStatus ?? t('message.thinking')}
          </div>
        )}
      </div>

      {/*
        The measure is capped and centred. Entries run the full width of their
        column now that the bubbles are gone, and on a 1440px window that put a
        140-character line in front of the reader — unreadable for prose, while
        the tables that need the width still get 860px.
      */}
      {/* `pb-28` rather than a symmetric `py-6`: the errand stack floats over the
          bottom-right of this region at `bottom-24`, and without room past it
          the last entry could never be scrolled out from under it. */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-6 pt-6 pb-28">
        <div className="mx-auto w-full max-w-[860px] space-y-6">
          {messagesLoading ? (
            <div className="flex items-center justify-center py-20">
              <LoadingDots size="md" />
            </div>
          ) : messages.length === 0 && !streaming ? (
            <div className="flex flex-col items-center justify-center py-24 gap-2 text-center">
              <Bot className="w-7 h-7 text-ink-muted opacity-40" />
              <p className="font-display text-lg text-ink-secondary">{t('message.start')}</p>
            </div>
          ) : null}

          {hasOlderMessages && (
            <button
              type="button"
              onClick={loadOlderMessages}
              disabled={loadingOlder}
              className={`w-full py-2 eyebrow text-ink-muted hover:text-ink-secondary hover:bg-dark-hover rounded-lg ${DISABLED} transition-colors ${FOCUS_RING}`}
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
      </div>

      {/* Input */}
      <div className="px-6 pb-5 pt-1 shrink-0 mx-auto w-full max-w-[908px]">
        {/* The composer's focus indicator lives here rather than on the textarea:
            the bordered wrapper is what reads as the control, and the textarea
            inside it keeps `outline-hidden` so the two don't both draw.

            A border change, not a ring. The composer takes focus programmatically
            whenever a reply finishes, and a textarea always matches
            `:focus-visible` while focused, so the old 2px seal ring was in
            practice permanently lit around the widest element on screen — the
            loudest thing in the window, signalling something that is almost
            always true. primary-500 as a border measures 4.57:1 against the page
            and 4.39:1 against the field, both well past the 3:1 WCAG 2.4.11 asks
            of a focus indicator, so the quiet version is the compliant one too. */}
        <div className="rounded-xl border border-dark-border bg-dark-input transition-colors focus-within:border-primary-500">
          {/* Attached file preview */}
          {attachedFile && (
            <div className="flex items-center gap-2 px-3 pt-3 pb-0">
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-primary-600/10 border border-primary-600/20 text-xs text-primary-300 min-w-0">
                <Paperclip className="w-3 h-3 shrink-0" />
                <span className="truncate">{attachedFile.name}</span>
                <button
                  type="button"
                  onClick={clearAttachment}
                  className="shrink-0 hover:text-red-400 transition-colors ms-1"
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
              className={`p-2 text-ink-muted hover:text-primary-400 hover:bg-primary-600/10 rounded-lg ${DISABLED} transition-colors shrink-0`}
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
              className={`p-2 rounded-lg bg-primary-600 text-white hover:bg-primary-500
                ${DISABLED_FILLED} disabled:cursor-not-allowed transition-all shrink-0`}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
