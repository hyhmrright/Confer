import { usePermissionsStore } from '../stores/permissions.js';
import { PermissionCard } from './PermissionCard.js';

// Surfaces pending permission requests (e.g. inbound A2A connection requests,
// which the backend holds in `/permissions/pending`) as an actionable stack.
// Without this the requests are fetched but never rendered, leaving the consent
// gate unreachable from the UI. Decisions remove the card via the store.
export function PermissionInbox() {
  const { pending, removeRequest } = usePermissionsStore();

  if (pending.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-40 w-80 space-y-2">
      {pending.map((req) => (
        <PermissionCard key={req.id} request={req} onDecided={() => removeRequest(req.id)} />
      ))}
    </div>
  );
}
