import { and, asc, count, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { conversations, messages, permissions } from '../db/schema.js';
import { isSenderAuthorized } from '../lib/a2a-admission.js';
import { asA2AQuestionScope } from './inbound-permissions.js';
import {
  type A2AMessage,
  type A2ATask,
  applyHistoryLength,
  buildTask,
  type TaskState,
  textMessage,
} from './rest-model.js';

/**
 * A2A Tasks, read out of the rows Confer already writes.
 *
 * A task IS one inbound question: its id is that message's id, its context is
 * the conversation it was filed in, and its state is whatever has happened to it
 * since. Nothing is stored twice — a `tasks` table shadowing `messages` would be
 * a second source of truth for the same fact, and would drift the first time a
 * code path wrote one without the other.
 */

type MessageRow = typeof messages.$inferSelect;

// English, like every other string this binding puts on the wire: the peer is a
// different instance and does not share this owner's locale. Anything a client
// must act on travels as a task state or an error `reason`, never as prose.
const HELD_NOTICE =
  "This agent's owner has been asked to approve the question before it is answered.";
const DENIED_NOTICE = "This agent's owner declined to answer the question.";

/** Rows a peer may be shown: not moderator-hidden, not deleted. */
function isVisible(row: MessageRow): boolean {
  return row.moderation_status === 'visible' && row.deleted_at === null;
}

export interface LoadedTask {
  task: A2ATask;
  state: TaskState;
}

/**
 * The task `taskId` names, as the caller is allowed to see it.
 *
 * A task belonging to someone else reads as absent rather than forbidden: §3.3.2
 * requires that a server not reveal the existence of resources the client cannot
 * access, and to an honest client the two are indistinguishable anyway.
 */
export async function loadTask(
  taskId: string,
  callerDid: string,
  historyLength?: number,
): Promise<LoadedTask | undefined> {
  const [row] = await getDb().select().from(messages).where(eq(messages.id, taskId)).limit(1);
  if (!row || !isVisible(row) || row.sender_type !== 'peer_agent') return undefined;
  if (!row.sender_did || !isSenderAuthorized(callerDid, row.sender_did)) return undefined;

  const [described] = await describeTasks([row], historyLength);
  return described;
}

/**
 * Task views for a batch of inbound message rows.
 *
 * Batched rather than per-row because `ListTasks` returns up to 100 of them, and
 * the obvious shape — one `describeTask` per row — costs three queries each.
 */
export async function describeTasks(
  inbound: MessageRow[],
  historyLength?: number,
): Promise<LoadedTask[]> {
  if (inbound.length === 0) return [];
  const db = getDb();

  const replies = await db
    .select()
    .from(messages)
    .where(
      and(
        inArray(
          messages.in_reply_to,
          inbound.map((row) => row.id),
        ),
        isNull(messages.deleted_at),
        eq(messages.moderation_status, 'visible'),
      ),
    )
    // Oldest first, so the map keeps the NEWEST of any duplicates rather than
    // whichever row the planner happened to return first. Nothing should write
    // two replies to one question, but a task's reported state must not depend
    // on that holding.
    .orderBy(asc(messages.id));
  const replyFor = new Map(replies.map((reply) => [reply.in_reply_to ?? '', reply]));

  // Only a question with no reply can still be sitting at an approval gate, so
  // the permission lookup is skipped entirely in the common case.
  const unanswered = inbound.filter((row) => !replyFor.has(row.id));
  const gate = await approvalGates(unanswered);

  return inbound.map((row) =>
    describeOne(row, replyFor.get(row.id), gate.get(row.id), historyLength),
  );
}

/**
 * The owner-approval decision standing between each question and its answer.
 *
 * Read through `(user_id, peer_id)` — the indexed pair — and matched on the
 * inbound message id in application code, because that id lives inside the
 * permission's scope JSON and reaching into it would mean raw SQL.
 *
 * Two bounds keep that scan from growing with history, which matters because the
 * peer calling `ListTasks` is the same party that decides how many questions
 * ever got held. Only `pending` and `denied` change a task's state at all, and a
 * permission is always written AFTER the message it is about — both are ULIDs
 * from the same monotonic generator, so the oldest id in the batch is a sound
 * floor and never hides a row that could have matched.
 */
async function approvalGates(unanswered: MessageRow[]): Promise<Map<string, 'pending' | 'denied'>> {
  const gates = new Map<string, 'pending' | 'denied'>();
  if (unanswered.length === 0) return gates;
  const db = getDb();

  const conversationIds = [...new Set(unanswered.map((row) => row.conversation_id))];
  const owners = await db
    .select({ id: conversations.id, created_by: conversations.created_by })
    .from(conversations)
    .where(inArray(conversations.id, conversationIds));
  const ownerIds = [...new Set(owners.map((row) => row.created_by))];
  const peerIds = [...new Set(unanswered.map((row) => row.sender_id))];
  if (ownerIds.length === 0) return gates;

  const oldest = unanswered.map((row) => row.id).sort()[0] ?? '';

  const rows = await db
    .select({ decision: permissions.decision, scope: permissions.scope_json })
    .from(permissions)
    .where(
      and(
        inArray(permissions.user_id, ownerIds),
        inArray(permissions.peer_id, peerIds),
        eq(permissions.action, 'ask'),
        inArray(permissions.decision, ['pending', 'denied']),
        gte(permissions.id, oldest),
      ),
    );

  for (const row of rows) {
    const scope = asA2AQuestionScope(row.scope);
    if (!scope) continue;
    if (row.decision === 'pending' || row.decision === 'denied') {
      gates.set(scope.inbound_message_id, row.decision);
    }
  }
  return gates;
}

function describeOne(
  inbound: MessageRow,
  reply: MessageRow | undefined,
  gate: 'pending' | 'denied' | undefined,
  historyLength: number | undefined,
): LoadedTask {
  const ids = { contextId: inbound.conversation_id, taskId: inbound.id };
  const history: A2AMessage[] = [textMessage(inbound.id, 'ROLE_USER', inbound.content ?? '', ids)];

  let state: TaskState = 'TASK_STATE_WORKING';
  let statusMessage: A2AMessage | undefined;
  let timestamp = inbound.created_at;

  if (reply) {
    const answer = textMessage(reply.id, 'ROLE_AGENT', reply.content ?? '', ids);
    history.push(answer);
    statusMessage = answer;
    timestamp = reply.created_at;
    // A turn that could not run writes its reason as a system notice rather than
    // an answer. Reporting that as COMPLETED would hand the client a failure
    // notice dressed up as the agent's reply.
    state = reply.content_type === 'system_notice' ? 'TASK_STATE_FAILED' : 'TASK_STATE_COMPLETED';
  } else if (gate === 'pending') {
    // Interrupted, not terminal: the owner has been asked and may still approve.
    // `AUTH_REQUIRED` is the state the spec reserves for "somebody has to
    // authorize this before it can proceed".
    state = 'TASK_STATE_AUTH_REQUIRED';
    statusMessage = textMessage(`${inbound.id}-status`, 'ROLE_AGENT', HELD_NOTICE, ids);
  } else if (gate === 'denied') {
    state = 'TASK_STATE_REJECTED';
    statusMessage = textMessage(`${inbound.id}-status`, 'ROLE_AGENT', DENIED_NOTICE, ids);
  }

  return {
    state,
    task: buildTask({
      taskId: inbound.id,
      contextId: inbound.conversation_id,
      state,
      timestamp,
      statusMessage,
      history: applyHistoryLength(history, historyLength),
    }),
  };
}

/**
 * Whether the answer to `taskId` has landed yet.
 *
 * The blocking `message:send` wait polls this rather than rebuilding the whole
 * task: a task in `WORKING` can only leave that state by acquiring a reply (a
 * held one is already interrupted and returned before any wait begins), and
 * `loadTask` costs three queries — twice a second for up to a minute.
 */
export async function hasReply(taskId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.in_reply_to, taskId), isNull(messages.deleted_at)))
    .limit(1);
  return row !== undefined;
}

export interface TaskPage {
  tasks: A2ATask[];
  nextPageToken: string;
  pageSize: number;
  totalSize: number;
}

export interface ListTasksOptions {
  callerDid: string;
  contextId?: string;
  state?: TaskState;
  pageSize: number;
  pageToken?: string;
  historyLength?: number;
}

/**
 * The caller's own tasks, newest first.
 *
 * Scoped by the signer DID exactly: this lists what the caller created through
 * this binding, which is what it stored under its own DID. Ordering and the page
 * cursor are the message id — `newId` is monotonic, so an id IS insertion order,
 * whereas `created_at` is the transaction timestamp and loses its microseconds
 * on the way back into a JS Date.
 *
 * `state` is a post-filter, because a task's state is derived from other rows
 * rather than stored, and so cannot be a SQL predicate. `totalSize` therefore
 * counts the tasks in scope *before* that filter, and a filtered page may come
 * back shorter than `pageSize` while `nextPageToken` still points at more.
 */
export async function listTasks(options: ListTasksOptions): Promise<TaskPage> {
  const db = getDb();
  const { callerDid, contextId, pageSize, pageToken, historyLength, state } = options;

  const scope = and(
    eq(messages.sender_did, callerDid),
    eq(messages.sender_type, 'peer_agent'),
    eq(messages.moderation_status, 'visible'),
    isNull(messages.deleted_at),
    contextId ? eq(messages.conversation_id, contextId) : undefined,
  );

  const rows = await db
    .select()
    .from(messages)
    .where(and(scope, pageToken ? lt(messages.id, pageToken) : undefined))
    // One row beyond the page is what tells us another page exists, without a
    // second query that could disagree with this one.
    .orderBy(desc(messages.id))
    .limit(pageSize + 1);

  const totals = await db.select({ total: count() }).from(messages).where(scope);

  const page = rows.slice(0, pageSize);
  const described = await describeTasks(page, historyLength);
  const kept = state ? described.filter((task) => task.state === state) : described;

  return {
    tasks: kept.map((task) => task.task),
    // The cursor is the last row actually READ, not the last one kept: a
    // post-filter must still advance paging past everything it discarded.
    nextPageToken: rows.length > pageSize ? (page.at(-1)?.id ?? '') : '',
    pageSize,
    totalSize: totals[0]?.total ?? 0,
  };
}
