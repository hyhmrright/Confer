import { type RefObject, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuthStore } from '../stores/auth.js';
import { useChatStore } from '../stores/chat.js';
import { CitationCapsule } from './CitationCapsule.js';
import { MessageEntry } from './MessageEntry.js';
import { TypingIndicator } from './TypingIndicator.js';

// The in-flight agent reply, split out of MessageView so that `streamContent`
// — which the gateway updates once per LLM token — is subscribed to by this
// leaf alone. While it lived in MessageView, every token re-rendered the whole
// message list, and since react-markdown parses in its render body with no
// memo, that meant re-parsing every message on screen tens of times a second,
// at a cost that grew with the length of the conversation.
export function StreamingMessage({
  scrollAnchor,
}: {
  scrollAnchor: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const streamContent = useChatStore((s) => s.streamContent);
  const streamCitations = useChatStore((s) => s.streamCitations);
  const agentStatus = useChatStore((s) => s.agentStatus);
  const ownerName = useAuthStore((s) => s.user?.display_name ?? s.user?.username);

  // Following the stream has to happen here too, for the same reason: it is
  // driven by streamContent, and MessageView no longer sees it.
  // `streamContent` is the trigger, not a value the body reads — a ref is
  // stable, so depending on `scrollAnchor` alone would run this once at mount
  // and then never follow the stream.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll trigger
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      scrollAnchor.current?.scrollIntoView({ behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [streamContent, scrollAnchor]);

  // No timestamp: the turn has not been sent yet, and stamping "now" on every
  // token would make the attribution line flicker.
  const attribution = {
    senderType: 'own_agent',
    name: t('message.roleOwnAgent'),
    principal: ownerName ? t('message.onBehalfOf', { name: ownerName }) : undefined,
  };

  if (!streamContent) {
    return (
      <MessageEntry {...attribution}>
        <TypingIndicator label={agentStatus ?? undefined} />
      </MessageEntry>
    );
  }

  return (
    <MessageEntry {...attribution}>
      <div className="markdown-content text-sm leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamContent}</ReactMarkdown>
        <span className="inline-block w-[3px] h-4 bg-primary-400 animate-cursor-blink rounded-xs ms-0.5 align-text-bottom" />
      </div>
      {streamCitations.length > 0 && <CitationCapsule citations={streamCitations} />}
    </MessageEntry>
  );
}
