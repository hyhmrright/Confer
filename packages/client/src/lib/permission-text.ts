import type { PermissionRequestEvent } from '@confer/shared';
import type { TFunction } from 'i18next';

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

  return t('permission.descGeneric', { who, action: request.action });
}
