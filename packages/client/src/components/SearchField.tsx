import { FOCUS_RING } from '../lib/styles.js';
import { Search } from './Icons.js';

// The filter box under a sidebar panel's header.
export function SearchField({
  name,
  value,
  onChange,
  placeholder,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="px-3 py-2 border-b border-dark-border shrink-0">
      <div className="relative">
        <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted pointer-events-none" />
        <input
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full ps-8 pe-3 py-1.5 bg-dark-input border border-dark-border text-ink-secondary
            text-xs rounded-md placeholder:text-ink-muted ${FOCUS_RING} transition-colors`}
        />
      </div>
    </div>
  );
}
