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
  authoritative: { label: '权威来源', color: 'bg-green-100 text-green-700' },
  verified: { label: '已验证', color: 'bg-blue-100 text-blue-700' },
  unverified: { label: '未验证', color: 'bg-yellow-100 text-yellow-700' },
};

export function CitationCapsule({ citations }: { citations: Citation[] }) {
  const [expanded, setExpanded] = useState(false);

  if (citations.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
      >
        <BookOpen className="w-3.5 h-3.5" />
        <span>{citations.length} 个引用来源</span>
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {expanded && (
        <div className="mt-1.5 space-y-1.5 animate-fade-in">
          {citations.map((cite, i) => {
            const badge = cite.trust_level ? trustBadge[cite.trust_level] : null;
            return (
              <div key={i} className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-700 truncate">{cite.source}</span>
                      {cite.page != null && (
                        <span className="text-xs text-gray-400 shrink-0">p.{cite.page}</span>
                      )}
                      {badge && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${badge.color}`}>
                          {badge.label}
                        </span>
                      )}
                    </div>
                    {cite.passage && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{cite.passage}</p>
                    )}
                  </div>
                  {cite.url && /^https?:\/\//.test(cite.url) && (
                    <a
                      href={cite.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-500 hover:text-primary-700 shrink-0"
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
