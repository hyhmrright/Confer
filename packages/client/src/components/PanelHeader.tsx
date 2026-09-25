import { FOCUS_RING } from '../lib/styles.js';
import { Plus } from './Icons.js';

// The title row every sidebar panel opens with: an eyebrow label and one
// "add something" action on the right.
export function PanelHeader({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="px-4 py-3 flex items-center justify-between border-b border-dark-border shrink-0">
      <span className="eyebrow text-ink-muted">{title}</span>
      <button
        type="button"
        onClick={onAction}
        className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md
          bg-primary-600/15 text-primary-400 border border-primary-600/20
          hover:bg-primary-600/25 hover:border-primary-600/35 transition-all ${FOCUS_RING}`}
      >
        <Plus className="w-3 h-3" />
        {actionLabel}
      </button>
    </div>
  );
}
