import { Bot, User } from './Icons.js';

// The round sender badge beside every bubble. Lives here rather than inside
// MessageBubble because the streaming reply needs the same agent badge, and
// three copies of the markup had already drifted apart once.
//
// `type` is the message's `sender_type`: anything that is not the owner reads
// as the agent side, which is what 'system' rows (permission cards) want too.
export function Avatar({ type }: { type: string }) {
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
