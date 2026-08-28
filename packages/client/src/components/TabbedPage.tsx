import type { ReactNode, SVGProps } from 'react';
import { useNavigate } from 'react-router';
import { FOCUS_RING } from '../lib/styles.js';
import { ArrowLeft } from './Icons.js';

export interface PageTab<Id extends string> {
  id: Id;
  label: string;
  icon: (props: SVGProps<SVGSVGElement>) => ReactNode;
}

interface TabbedPageProps<Id extends string> {
  title: string;
  tabs: PageTab<Id>[];
  activeTab: Id;
  onTabChange: (id: Id) => void;
  /** Extra classes on the content column — e.g. a width cap for narrow forms. */
  contentClassName?: string;
  children: ReactNode;
}

// The full-screen shell shared by the settings and admin pages: a back header,
// a left tab rail, and a scrolling content column headed by the active tab's
// label. Both pages had this markup byte-identical, so a spacing or theme tweak
// silently applied to one and not the other.
export function TabbedPage<Id extends string>({
  title,
  tabs,
  activeTab,
  onTabChange,
  contentClassName,
  children,
}: TabbedPageProps<Id>) {
  const navigate = useNavigate();

  return (
    <div className="h-screen flex flex-col bg-dark-base">
      <header className="h-13 bg-dark-nav border-b border-dark-border flex items-center px-4 shrink-0">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="p-1.5 -ml-1 text-ink-muted hover:text-ink-secondary hover:bg-dark-hover rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="font-semibold text-sm text-ink-primary ml-2">{title}</h1>
      </header>

      {/* The rail is a column beside the content on a wide screen and a
          horizontally scrolling strip above it on a narrow one, where 208px of
          fixed rail would leave the forms about 100px to live in. */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        <nav
          className="flex md:flex-col gap-0.5 shrink-0 bg-dark-panel border-b md:border-b-0 md:border-r border-dark-border
            p-2 md:w-52 overflow-x-auto md:overflow-x-visible scrollbar-thin"
        >
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              onClick={() => onTabChange(id)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors shrink-0 md:w-full ${
                activeTab === id
                  ? 'bg-primary-600/15 text-primary-400 font-medium'
                  : 'text-ink-secondary hover:bg-dark-hover hover:text-ink-primary'
              } ${FOCUS_RING}`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        {/* `mx-auto`: `contentClassName` is a width cap, and without centring it
            the forms sat hard against the left edge of a 1200px column with the
            rest of the page empty. */}
        <div className="flex-1 min-w-0 overflow-y-auto scrollbar-thin p-4 md:p-8 bg-dark-base">
          <div className={`mx-auto w-full ${contentClassName ?? ''}`}>
            <h2 className="font-display text-xl text-ink-primary mb-6">
              {tabs.find((item) => item.id === activeTab)?.label}
            </h2>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
