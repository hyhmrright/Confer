import type { PermissionRequestEvent } from '@confer/shared';
import type { TFunction } from 'i18next';
import type { TranslationKey } from '../i18n/index.js';

// The actions `classifyPermissionLevel` in @confer/agent-runtime names by hand,
// plus `send_message`. Without these the generic branch below put the raw
// identifier into the sentence — so the L3 requests, the ones with money and
// signatures behind them, read as "X is requesting: sign_contract" on the single
// screen where the owner has to understand what they are agreeing to.
//
// Deliberately not exhaustive: `action` is an open string and the generic branch
// still has to carry whatever a newer gateway invents.
const ACTION_LABEL: Record<string, TranslationKey> = {
  read_own: 'permission.actionReadOwn',
  cite_own_docs: 'permission.actionCiteOwnDocs',
  query: 'permission.actionQuery',
  accept_invite: 'permission.actionAcceptInvite',
  payment: 'permission.actionPayment',
  sign_contract: 'permission.actionSignContract',
  delete: 'permission.actionDelete',
  transfer: 'permission.actionTransfer',
  send_message: 'permission.actionSendMessage',
};

// Render the sentence shown on a permission card, in the reader's language.
//
// This used to be built server-side and shipped as a `description` string, which
// meant an en/ja user was asked to approve a peer connection in Chinese — on the
// one screen where misreading the request has real consequences. The gateway now
// sends only structured facts and the wording lives here.
//
// `action` is an open string: a gateway newer than this client can invent one,
// and the generic branch still produces something the owner can act on rather
// than an empty card.
export function describePermission(
  request: Pick<PermissionRequestEvent, 'action' | 'scope' | 'peer_name' | 'peer_did'>,
  t: TFunction,
): string {
  const who = request.peer_name ?? request.peer_did ?? t('permission.unknownPeer');

  // `scope` is a JSONB blob whose shape varies by action, so read each field
  // defensively — a non-string would otherwise interpolate as "[object Object]"
  // into the sentence the owner is deciding on.
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;
  const first = text(request.scope.first_message);
  const content = text(request.scope.content);

  if (request.action === 'connect') {
    return first
      ? t('permission.descConnectWith', { who, message: first })
      : t('permission.descConnect', { who });
  }

  if (request.action === 'ask') {
    return content
      ? t('permission.descAskWith', { who, question: content })
      : t('permission.descAsk', { who });
  }

  const label = ACTION_LABEL[request.action];
  if (label) return t('permission.descAction', { who, what: t(label) });

  return t('permission.descGeneric', { who, action: request.action });
}
