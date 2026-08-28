/*
  A turn is a correspondence entry, not a chat bubble.

  Bubbles can express two things — me and not-me — and this product has four
  parties that speak: the owner, the owner's own agent, a peer's agent, and the
  system. The one fact the interface exists to convey is *who said this, under
  whose authority*, and a lozenge has nowhere to put it. So each turn gets a
  coloured rule in the gutter (the party) and an attribution line (the party's
  name, its principal, the time), and the body then runs the full measure.

  The full measure is not cosmetic either: an agent's answer here is mostly
  comparison tables, and the old 78%-wide bubble squeezed them into half the
  window while the chrome around them sat empty.

  Shared by the settled turn and the in-flight one. Both used to build this
  markup themselves, and the sender badge they shared carried a note recording
  that three hand-maintained copies had already drifted apart once.
*/

// `agent` is the legacy spelling of `own_agent`; rows written before the sender
// type was split still carry it, so both map to the same treatment.
const ROLE = {
  user: { rule: 'border-primary-600', name: 'text-primary-400' },
  own_agent: { rule: 'border-dark-active', name: 'text-ink-secondary' },
  agent: { rule: 'border-dark-active', name: 'text-ink-secondary' },
  peer_agent: { rule: 'border-peer-600', name: 'text-peer-400' },
  system: { rule: 'border-dark-border', name: 'text-ink-muted' },
} as const satisfies Record<string, { rule: string; name: string }>;

/** The owner's own words get a card so they scan as "what I said". At the
 *  `dark-card/50` this started as, the tint resolved to within a couple of
 *  points of the page ground and the distinction was invisible. */
const OWN_SURFACE = 'bg-dark-card rounded-r-lg py-3 pr-4';

export function MessageEntry({
  senderType,
  name,
  principal,
  address,
  time,
  children,
}: {
  senderType: string;
  name: string;
  /** Who this party speaks for, as prose — "on behalf of Ada". */
  principal?: string;
  /** The party's machine identifier — a DID. Set in mono; prose is not. */
  address?: string;
  /** Omitted while a reply is still streaming: there is no send time yet. */
  time?: string;
  children: React.ReactNode;
}) {
  const role = ROLE[senderType as keyof typeof ROLE] ?? ROLE.system;
  return (
    <article
      className={`border-l-2 pl-4 animate-fade-in ${role.rule} ${
        senderType === 'user' ? OWN_SURFACE : ''
      }`}
    >
      <header className="flex items-baseline gap-2 mb-1.5">
        <span className={`eyebrow shrink-0 ${role.name}`}>{name}</span>
        {principal && <span className="text-[11px] text-ink-muted truncate">{principal}</span>}
        {address && (
          <span
            className="text-[11px] text-ink-muted/80 font-mono truncate min-w-0"
            title={address}
          >
            {address}
          </span>
        )}
        {time && <time className="eyebrow text-ink-muted ml-auto shrink-0 tabular">{time}</time>}
      </header>
      {children}
    </article>
  );
}
