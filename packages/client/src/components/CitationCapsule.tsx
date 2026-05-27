import { useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, ExternalLink } from './Icons.js';

interface Citation {
  source: string;
  url?: string;
  page?: number;
  passage?: string;
  trust_level?: string;
}

const trustBadge: Record<string, { label: string; color: string }> = {
  authoritative: { label: '权威来源', color: 'bg-green-900/40 text-green-400 border-green-800/40' },
  verified:      { label: '已验证',   color: 'bg-blue-900/40 text-blue-400 border-blue-800/40' },
  unverified:    { label: '未验证',   color: 'bg-yellow-900/40 text-yellow-400 border-yellow-800/40' },
};

export function CitationCapsule({ citations }: { citations: Citation[] }) {
  const [expanded, setExpanded] = useState(false);

  if (citations.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[11px] text-ink-muted hover:text-ink-secondary transition-colors font-mono"
      >
        <BookOpen className="w-3.5 h-3.5" />
        <span>{citations.length} 个引用来源</span>
        {expanded
          ? <ChevronDown className="w-3 h-3" />
          : <ChevronRight className="w-3 h-3" />}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5 animate-fade-in">
          {citations.map((cite, i) => {
            const badge = cite.trust_level ? trustBadge[cite.trust_level] : null;
            return (
              <div key={i} className="rounded-lg border border-dark-border bg-dark-card px-3 py-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-ink-secondary truncate">{cite.source}</span>
                      {cite.page != null && (
                        <span className="text-[10px] text-ink-muted font-mono shrink-0">p.{cite.page}</span>
                      )}
                      {badge && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 border ${badge.color}`}>
                          {badge.label}
                        </span>
                      )}
                    </div>
                    {cite.passage && (
                      <p className="text-[11px] text-ink-muted mt-1 line-clamp-2 leading-relaxed italic">
                        {cite.passage}
                      </p>
                    )}
                  </div>
                  {cite.url && /^https?:\/\//.test(cite.url) && (
                    <a
                      href={cite.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-400 hover:text-primary-300 shrink-0 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
