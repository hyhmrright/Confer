import { type RefObject, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useChatStore } from '../stores/chat.js';
import { Avatar } from './Avatar.js';
import { CitationCapsule } from './CitationCapsule.js';
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
  const streamContent = useChatStore((s) => s.streamContent);
  const streamCitations = useChatStore((s) => s.streamCitations);
  const agentStatus = useChatStore((s) => s.agentStatus);

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

  if (!streamContent) {
    return (
      <div className="flex gap-3 items-center animate-fade-in">
        <Avatar type="agent" />
        <div className="bg-dark-card border border-dark-border rounded-2xl rounded-tl-sm px-4 py-3">
          <TypingIndicator label={agentStatus ?? undefined} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 animate-fade-in">
      <Avatar type="agent" />
      <div className="max-w-[78%]">
        <div className="agent-bubble bg-dark-card border border-dark-border rounded-2xl rounded-tl-sm px-4 py-3">
          <div className="markdown-content text-sm leading-relaxed text-ink-primary">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamContent}</ReactMarkdown>
          </div>
          <span className="inline-block w-[3px] h-4 bg-primary-400 animate-cursor-blink rounded-xs ml-0.5 align-text-bottom" />
        </div>
        {streamCitations.length > 0 && <CitationCapsule citations={streamCitations} />}
      </div>
    </div>
  );
}
