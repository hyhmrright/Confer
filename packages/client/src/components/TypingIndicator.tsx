export function TypingIndicator({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 animate-fade-in">
      <div className="flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-dot-bounce" style={{ animationDelay: '0s' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-dot-bounce" style={{ animationDelay: '0.16s' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-dot-bounce" style={{ animationDelay: '0.32s' }} />
      </div>
      {label && <span className="text-xs text-gray-400">{label}</span>}
    </div>
  );
}
