import type { ReactNode, SVGProps } from 'react';
import { useNavigate } from 'react-router';
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

      <div className="flex-1 flex overflow-hidden">
        <nav className="w-52 bg-dark-panel border-r border-dark-border p-2 space-y-0.5 shrink-0">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              onClick={() => onTabChange(id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                activeTab === id
                  ? 'bg-primary-600/15 text-primary-400 font-medium'
                  : 'text-ink-secondary hover:bg-dark-hover hover:text-ink-primary'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-8 bg-dark-base">
          <div className={contentClassName}>
            <h2 className="text-base font-semibold text-ink-primary mb-6">
              {tabs.find((item) => item.id === activeTab)?.label}
            </h2>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
