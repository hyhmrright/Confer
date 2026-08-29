import type { ReactNode, SVGProps } from 'react';

/*
  The "nothing here yet" panel, shared by the four places that had grown their
  own. They had drifted into three different type scales, and two of them set
  the hint at `text-[10px] opacity-60` — which takes ink-muted from 5.3:1 down
  to roughly 2.5:1 and undoes the contrast the token was chosen for. An empty
  screen is the one place a first-time user reads every word, so it is the last
  place to render text at 10px and 60% opacity.

  `hint` is a full sentence saying what the thing is for. It is not a caption
  pointing at a button — the button is already on screen.
*/
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon?: (props: SVGProps<SVGSVGElement>) => ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {Icon && <Icon className="w-7 h-7 text-ink-muted opacity-40 mb-1" />}
      <p className="text-sm font-medium text-ink-secondary">{title}</p>
      {hint && <p className="max-w-[34ch] text-xs leading-relaxed text-ink-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
