import { permissionRequestEventSchema, systemNoticeSchema } from '@confer/shared';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { dateLocale } from '../i18n/index.js';
import { agentFailureText } from '../lib/agent-failure-text.js';
import { useAuthStore } from '../stores/auth.js';
import type { Message } from '../stores/chat.js';
import { useContactsStore } from '../stores/contacts.js';
import { CitationCapsule } from './CitationCapsule.js';
import { MessageEntry } from './MessageEntry.js';
import { PermissionCard } from './PermissionCard.js';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
}

// Memoized because a long thread re-renders whenever anything in the chat store
// changes, and this component re-parses its whole markdown body on every render
// (react-markdown does the parse inline, with no cache). Messages are only ever
// appended to, never mutated in place, so prop identity is genuinely stable and
// this skips real work rather than trading one comparison for another.
export const MessageBubble = memo(function MessageBubble({ message }: { message: Message }) {
  // formatTime() below reads the active locale; without this subscription memo
  // would freeze every visible timestamp in the previous language after a switch.
  const { t } = useTranslation();
  const isPeer = message.sender_type === 'peer_agent';
  const ownerName = useAuthStore((s) => s.user?.display_name ?? s.user?.username);
  // Peer turns carry only the peer's row id. The contact list already holds that
  // row's name and DID, so attribution resolves client-side — no new API surface.
  //
  // The `isPeer` guard belongs inside the selector, not outside it: every turn in
  // the thread subscribes to this store, and with the guard here a non-peer turn
  // selects `undefined` every time, so loading contacts re-renders only the peer
  // turns instead of re-parsing the markdown of the whole conversation. For a
  // peer turn, `.find` hands back the same object identity until that contact is
  // refetched, so the subscription is stable there too.
  const peer = useContactsStore((s) =>
    isPeer ? s.contacts.find((c) => c.peer.id === message.sender_id)?.peer : undefined,
  );

  const time = formatTime(message.created_at);

  if (message.content_type === 'permission_request') {
    const parsed = permissionRequestEventSchema.safeParse(message.content_json);
    if (parsed.success) {
      return (
        <MessageEntry senderType="system" name={t('message.roleSystem')} time={time}>
          <PermissionCard request={parsed.data} />
        </MessageEntry>
      );
    }
  }

  // A turn the agent could not run at all. Without this the thread showed the
  // peer's question and then nothing — the owner had no way to learn that their
  // own model configuration was the reason, and the peer's `pending` was the
  // only symptom anywhere. The gateway sends the code; the sentence is chosen
  // here, since the gateway has no idea what language this reader speaks.
  if (message.content_type === 'system_notice') {
    const parsed = systemNoticeSchema.safeParse(message.content_json);
    if (parsed.success) {
      return (
        <MessageEntry senderType="system" name={t('message.roleSystem')} time={time}>
          <p className="text-sm leading-relaxed">
            {t('message.a2aTurnFailed')} {agentFailureText(parsed.data.error)}
          </p>
        </MessageEntry>
      );
    }
  }

  // Who this party is, and who it speaks for — the whole premise of the product,
  // which the previous UI showed nowhere. The own agent's principal is the
  // owner's name, as prose. A peer's is its DID: the address its signature was
  // actually verified against, so it belongs in the mono slot instead.
  let attribution: { name: string; principal?: string; address?: string };
  if (isPeer) {
    attribution = { name: peer?.name ?? t('message.rolePeerAgent'), address: peer?.did };
  } else if (message.sender_type === 'user') {
    attribution = { name: t('message.roleYou') };
  } else {
    attribution = {
      name: t('message.roleOwnAgent'),
      principal: ownerName ? t('message.onBehalfOf', { name: ownerName }) : undefined,
    };
  }

  return (
    <MessageEntry senderType={message.sender_type} {...attribution} time={time}>
      <div className="markdown-content text-sm leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content ?? ''}</ReactMarkdown>
      </div>
      {message.citations && message.citations.length > 0 && (
        <CitationCapsule citations={message.citations} />
      )}
    </MessageEntry>
  );
});
