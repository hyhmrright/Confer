// Three bouncing dots, the inline loading indicator shared across pages.
// The caller owns the surrounding layout (centering, padding) — this renders
// only the dots themselves.
export function LoadingDots({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const dotSize = size === 'md' ? 'w-2 h-2' : 'w-1.5 h-1.5';

  return (
    <div className="flex gap-1.5">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className={`${dotSize} rounded-full bg-dark-border animate-bounce`}
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}
