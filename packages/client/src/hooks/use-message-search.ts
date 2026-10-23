import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export interface MessageHit {
  message_id: string;
  conversation_id: string;
  conversation_name: string | null;
  sender_type: string;
  content: string;
  created_at: string;
}

const DEBOUNCE_MS = 300;

// Server-side search over message text, debounced so typing a word is one
// request rather than one per keystroke. A reply that arrives after the query
// has moved on is dropped, so a slow early request cannot overwrite a newer one.
export function useMessageSearch(query: string): { hits: MessageHit[]; searching: boolean } {
  const [hits, setHits] = useState<MessageHit[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setSearching(false);
      return;
    }
    let current = true;
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .get<{ results: MessageHit[] }>(`/search/messages?q=${encodeURIComponent(q)}`)
        .then((data) => current && setHits(data.results))
        .catch(() => current && setHits([]))
        .finally(() => current && setSearching(false));
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);

  return { hits, searching };
}
