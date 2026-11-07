// Backup control is process-local and signal-only; no HTTP caller can enable it.
// A lease prevents a killed backup process from leaving the instance unavailable.
import { randomUUID } from 'node:crypto';
import { pendingDetachedCount } from './background.js';

const LEASE_MS = 15 * 60_000;
const instanceId = randomUUID();
let until = 0;
let generation = 0;
let active = 0;
let frozen = false;
export function setMaintenance(enabled: boolean): void {
  if (enabled && !isMaintaining()) {
    generation++;
    frozen = false;
  }
  until = enabled ? Date.now() + LEASE_MS : 0;
}
export function isMaintaining(): boolean {
  return Date.now() < until;
}
export function maintenanceStatus() {
  if (isMaintaining() && active === 0 && pendingDetachedCount() === 0) frozen = true;
  return {
    backup_control: 1,
    instance_id: instanceId,
    generation,
    maintenance: isMaintaining(),
    ready: isMaintaining() && frozen,
    lease_until: until,
  };
}

/** A response is in flight until its BODY ends, including SSE and cancellation. */
export async function maintenanceRequest(
  request: Request,
  handle: () => Response | Promise<Response>,
  allowDuringDrain = false,
): Promise<Response> {
  if (new URL(request.url).pathname === '/health' && request.method === 'GET') return handle();
  if (isMaintaining() && (frozen || !allowDuringDrain))
    return Response.json(
      { error: { code: 'maintenance', message: 'Backup in progress; retry shortly' } },
      { status: 503, headers: { 'retry-after': '30' } },
    );
  active++;
  let finished = false;
  const finish = () => {
    if (!finished) {
      finished = true;
      active--;
    }
  };
  try {
    const response = await handle();
    if (!response.body) {
      finish();
      return response;
    }
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const value = await reader.read();
          if (value.done) {
            finish();
            controller.close();
          } else controller.enqueue(value.value);
        } catch (error) {
          finish();
          controller.error(error);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          finish();
        }
      },
    });
    return new Response(body, response);
  } catch (error) {
    finish();
    throw error;
  }
}
