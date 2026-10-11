import { newId } from '@confer/shared';
import { and, count, eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { a2aPushConfigs } from '../db/schema.js';
import { runDetached } from '../lib/background.js';
import { openSecret, sealSecret } from '../lib/sealed.js';
import { refusePeerUrl } from './outbound.js';
import { loadTask } from './rest-task.js';

/**
 * A2A push notifications (§4.3): a peer leaves a webhook on a task, and the
 * agent POSTs the task to it whenever its state changes — so a client that
 * asked a question and went away learns the answer without polling.
 *
 * The webhook is the peer's address, which makes calling it the same risk as
 * calling a peer's A2A endpoint: it must be https and resolve to a public
 * address (`refusePeerUrl`, which also guards outbound A2A), redirects are not
 * followed, and nothing it answers is read beyond the status.
 */

/** A handful per task is every legitimate use; a ceiling keeps one peer from fanning out. */
const MAX_CONFIGS_PER_TASK = 5;
const DELIVERY_TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [1_000, 4_000];

type ConfigRow = typeof a2aPushConfigs.$inferSelect;

export interface PushConfigInput {
  url: string;
  token?: string;
  authentication?: { scheme: string; credentials?: string };
}

/**
 * The wire shape (§4.3, `TaskPushNotificationConfig`). Neither the token nor the
 * credentials are echoed: both are what the receiver checks to know a push
 * came from us, and the peer that chose them already has them.
 */
export interface PushConfigView {
  id: string;
  taskId: string;
  url: string;
  authentication?: { scheme: string };
}

function toView(row: ConfigRow): PushConfigView {
  return {
    id: row.id,
    taskId: row.task_id,
    url: row.url,
    ...(row.auth_scheme ? { authentication: { scheme: row.auth_scheme } } : {}),
  };
}

export type PushResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'not_found' | 'invalid'; message: string };

/**
 * Register a webhook on a task the caller can see. The task must be theirs —
 * `loadTask` answers only for the peer that asked — so nobody can watch, or
 * learn of, another peer's task.
 */
export async function createPushConfig(
  taskId: string,
  callerDid: string,
  input: PushConfigInput,
  // Set when the URL was checked a moment ago, before the task even existed:
  // a second DNS answer that differed would fail a request whose question is
  // already being answered. Delivery checks it again regardless.
  opts: { urlVetted?: boolean } = {},
): Promise<PushResult<PushConfigView>> {
  if (!(await loadTask(taskId, callerDid))) {
    return { ok: false, reason: 'not_found', message: 'No such task.' };
  }
  const refused = opts.urlVetted ? null : await refusePeerUrl(input.url, { allowQuery: true });
  if (refused) return { ok: false, reason: 'invalid', message: refused };

  const db = getDb();
  const [held] = await db
    .select({ n: count() })
    .from(a2aPushConfigs)
    .where(and(eq(a2aPushConfigs.task_id, taskId), eq(a2aPushConfigs.caller_did, callerDid)));
  if ((held?.n ?? 0) >= MAX_CONFIGS_PER_TASK) {
    return {
      ok: false,
      reason: 'invalid',
      message: `At most ${MAX_CONFIGS_PER_TASK} configs per task.`,
    };
  }

  const [row] = await db
    .insert(a2aPushConfigs)
    .values({
      id: newId(),
      task_id: taskId,
      caller_did: callerDid,
      url: input.url,
      token_json: input.token ? await sealSecret(input.token) : null,
      auth_scheme: input.authentication?.scheme ?? null,
      auth_credentials_json: input.authentication?.credentials
        ? await sealSecret(input.authentication.credentials)
        : null,
    })
    .returning();
  if (!row) return { ok: false, reason: 'invalid', message: 'The config could not be stored.' };

  // The task may already be past the state the peer is waiting for — a held
  // question, or one answered between its send and this call. Tell them now.
  queueTaskPush(taskId);
  return { ok: true, value: toView(row) };
}

const scoped = (taskId: string, callerDid: string) =>
  and(eq(a2aPushConfigs.task_id, taskId), eq(a2aPushConfigs.caller_did, callerDid));

export async function listPushConfigs(
  taskId: string,
  callerDid: string,
): Promise<PushConfigView[]> {
  const rows = await getDb()
    .select()
    .from(a2aPushConfigs)
    .where(scoped(taskId, callerDid))
    .orderBy(a2aPushConfigs.id);
  return rows.map(toView);
}

export async function getPushConfig(
  taskId: string,
  configId: string,
  callerDid: string,
): Promise<PushConfigView | undefined> {
  const [row] = await getDb()
    .select()
    .from(a2aPushConfigs)
    .where(and(scoped(taskId, callerDid), eq(a2aPushConfigs.id, configId)))
    .limit(1);
  return row ? toView(row) : undefined;
}

/** Idempotent (§3.1.10): deleting what is not there is not an error. */
export async function deletePushConfig(
  taskId: string,
  configId: string,
  callerDid: string,
): Promise<void> {
  await getDb()
    .delete(a2aPushConfigs)
    .where(and(scoped(taskId, callerDid), eq(a2aPushConfigs.id, configId)));
}

/**
 * Tell every webhook on this task where it stands, if that has changed since
 * they were last told. Called wherever a task's state can move — an answer, a
 * failure notice, a hold, the owner's decision — and detached, so the turn that
 * moved it never waits on a peer's server.
 */
export function queueTaskPush(taskId: string): void {
  runDetached(deliverTaskPush(taskId), (e) => console.error('A2A push delivery failed:', e));
}

export async function deliverTaskPush(taskId: string): Promise<void> {
  const configs = await getDb()
    .select({ id: a2aPushConfigs.id })
    .from(a2aPushConfigs)
    .where(eq(a2aPushConfigs.task_id, taskId));
  await Promise.all(configs.map(({ id }) => serialized(id)));
}

// One delivery at a time per config. Two triggers can fire together — a config
// registered just as the answer lands — and run in parallel, the one holding
// the older state could arrive last and record it, leaving the receiver on a
// WORKING task that will never be pushed again. In turn, each delivery reads
// the config and the task afresh, so a later one always sends the newest state.
// Process-local, like the rest of the gateway's coordination.
const inFlight = new Map<string, Promise<void>>();

function serialized(configId: string): Promise<void> {
  const next = (inFlight.get(configId) ?? Promise.resolve()).then(() => deliverOne(configId));
  const settled = next.catch(() => {});
  inFlight.set(configId, settled);
  void settled.then(() => {
    if (inFlight.get(configId) === settled) inFlight.delete(configId);
  });
  return next;
}

async function deliverOne(configId: string): Promise<void> {
  const [config] = await getDb()
    .select()
    .from(a2aPushConfigs)
    .where(eq(a2aPushConfigs.id, configId))
    .limit(1);
  if (!config) return;
  // Read as the peer that registered it: what they are shown is what they
  // could have fetched themselves with `GET /tasks/{id}`.
  const loaded = await loadTask(config.task_id, config.caller_did);
  if (!loaded || loaded.state === config.last_state) return;

  // Checked again at delivery, not only at registration: a name that
  // resolved publicly then may not now.
  if (await refusePeerUrl(config.url, { allowQuery: true })) return;

  const headers: Record<string, string> = { 'content-type': 'application/a2a+json' };
  if (config.auth_scheme && config.auth_credentials_json) {
    headers.authorization = `${config.auth_scheme} ${await openSecret(config.auth_credentials_json)}`;
  }
  // 1.0.0's example carried the token here; later revisions dropped the header
  // without naming a replacement, so it stays for receivers that check it.
  if (config.token_json) headers['x-a2a-notification-token'] = await openSecret(config.token_json);
  const body = JSON.stringify({ task: loaded.task });

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(config.url, {
        method: 'POST',
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
      // Nothing of the receiver's reply is read but its status.
      await res.body?.cancel();
      if (res.ok) {
        await getDb()
          .update(a2aPushConfigs)
          .set({ last_state: loaded.state })
          .where(eq(a2aPushConfigs.id, config.id));
        return;
      }
      // A 4xx will not improve by asking again.
      if (res.status < 500) return;
    } catch {
      // Network failure: retry below. The error describes the receiver's side.
    }
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) await Bun.sleep(delay);
  }
}
