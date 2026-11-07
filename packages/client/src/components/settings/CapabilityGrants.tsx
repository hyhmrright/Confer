import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api.js';
import { INPUT_FIELD_CLS } from '../../lib/styles.js';

interface Grant {
  id: string;
  name: string;
  signer_did: string;
  expires_at: string;
  revoked_at: string | null;
}
interface Contact {
  peer: { id: string; did: string; name: string };
}
interface Base {
  id: string;
  name: string;
  shared_with_peers: boolean;
}
export function CapabilityGrants() {
  const { t } = useTranslation();
  const [grants, setGrants] = useState<Grant[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [bases, setBases] = useState<Base[]>([]);
  const [peer, setPeer] = useState('');
  const [signer, setSigner] = useState('');
  const [name, setName] = useState('');
  const [hours, setHours] = useState(24);
  const [selected, setSelected] = useState<string[]>([]);
  const [token, setToken] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const [g, c, k] = await Promise.all([
      api.get<{ grants: Grant[] }>('/capabilities'),
      api.get<{ contacts: Contact[] }>('/contacts?limit=100'),
      api.get<{ knowledge_bases: Base[] }>('/knowledge-bases'),
    ]);
    setGrants(g.grants);
    setContacts(c.contacts);
    setBases(k.knowledge_bases.filter((b) => b.shared_with_peers));
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: fetch once on mount
  useEffect(() => {
    void load().catch(() => setError(true));
  }, []);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(false);
    setToken('');
    try {
      const data = await api.post<{ token: string }>('/capabilities', {
        name,
        peer_id: peer,
        signer_did: signer,
        kb_ids: selected,
        expires_in_hours: hours,
      });
      setToken(data.token);
      await load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{t('features.grants')}</h3>
      <p className="text-xs text-ink-secondary">{t('features.grantHint')}</p>
      <form onSubmit={create} className="space-y-2">
        <label className="block text-xs">
          {t('features.name')}
          <input
            required
            maxLength={64}
            className={INPUT_FIELD_CLS}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block text-xs">
          {t('nav.contacts')}
          <select
            required
            className={INPUT_FIELD_CLS}
            value={peer}
            onChange={(e) => {
              setPeer(e.target.value);
              setSigner(contacts.find((c) => c.peer.id === e.target.value)?.peer.did ?? '');
            }}
          >
            <option value="">—</option>
            {contacts.map((c) => (
              <option key={c.peer.id} value={c.peer.id}>
                {c.peer.name || c.peer.did}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          {t('features.signer')}
          <input
            required
            className={INPUT_FIELD_CLS}
            value={signer}
            onChange={(e) => setSigner(e.target.value)}
          />
        </label>
        <label className="block text-xs">
          {t('features.hours')}
          <input
            type="number"
            min={1}
            max={720}
            required
            className={INPUT_FIELD_CLS}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          />
        </label>
        <fieldset className="text-xs space-y-2">
          <legend>{t('nav.knowledge')}</legend>
          {bases.map((kb) => (
            <label key={kb.id} className="flex gap-2">
              <input
                type="checkbox"
                checked={selected.includes(kb.id)}
                onChange={(e) =>
                  setSelected((s) =>
                    e.target.checked ? [...s, kb.id] : s.filter((id) => id !== kb.id),
                  )
                }
              />
              {kb.name}
            </label>
          ))}
        </fieldset>
        <button
          type="submit"
          disabled={busy || !selected.length}
          className="px-3 py-2 rounded-lg border border-dark-border disabled:opacity-40"
        >
          {t('common.create')}
        </button>
      </form>
      {token && (
        <div className="text-xs space-y-2">
          <p>{t('features.tokenOnce')}</p>
          <code className="block break-all select-all">{token}</code>
          <button type="button" onClick={() => setToken('')}>
            {t('common.close')}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {t('features.failed')}
        </p>
      )}
      {grants.map((g) => (
        <div key={g.id} className="text-xs border border-dark-border rounded-lg p-3 space-y-1">
          <p>{g.name}</p>
          <p className="break-all text-ink-muted">{g.signer_did}</p>
          <p>{new Date(g.expires_at).toLocaleString()}</p>
          <button
            type="button"
            disabled={busy || !!g.revoked_at}
            onClick={async () => {
              setBusy(true);
              try {
                await api.delete(`/capabilities/${g.id}`);
                await load();
              } catch {
                setError(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {g.revoked_at ? t('features.revoked') : t('features.revoke')}
          </button>
        </div>
      ))}
    </section>
  );
}
