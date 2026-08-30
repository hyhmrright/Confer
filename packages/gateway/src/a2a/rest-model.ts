import type { Result } from '@confer/shared';

/**
 * The Linux Foundation A2A data model, and the translation to Confer's own.
 *
 * Field names and enum spellings come from `specification/a2a.proto` at v1.0.1,
 * serialized with the proto3 JSON mapping — hence camelCase fields (§5.5) and
 * SCREAMING_SNAKE_CASE enum values. This module is pure: no database, no HTTP,
 * no clock beyond what the caller passes in, so the mapping can be tested
 * without a stack behind it.
 */

/**
 * Every state the spec defines (§4.1.3), including the ones this agent never
 * enters. `ListTasks` filters by state, and a client is entitled to ask about a
 * state we happen not to produce — narrowing the type to what we emit would turn
 * that into a validation error instead of an empty page.
 */
export const TASK_STATES = [
  'TASK_STATE_SUBMITTED',
  'TASK_STATE_WORKING',
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_INPUT_REQUIRED',
  'TASK_STATE_REJECTED',
  'TASK_STATE_AUTH_REQUIRED',
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export function isTaskState(value: string): value is TaskState {
  return (TASK_STATES as readonly string[]).includes(value);
}

/** States a task can never leave (§4.1.3). */
const TERMINAL_STATES: ReadonlySet<TaskState> = new Set([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_REJECTED',
]);

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.has(state);
}

export interface A2APart {
  text?: string;
  raw?: string;
  url?: string;
  data?: unknown;
  mediaType?: string;
  filename?: string;
}

export interface A2AMessage {
  messageId: string;
  contextId?: string;
  taskId?: string;
  role: 'ROLE_USER' | 'ROLE_AGENT';
  parts: A2APart[];
}

export interface A2ATask {
  id: string;
  contextId: string;
  status: {
    state: TaskState;
    message?: A2AMessage;
    timestamp: string;
  };
  history?: A2AMessage[];
}

/** ISO 8601, UTC, millisecond precision — the only accepted timestamp form (§5.6.1). */
export function isoTimestamp(at: Date): string {
  return at.toISOString();
}

export function textMessage(
  messageId: string,
  role: A2AMessage['role'],
  text: string,
  ids: { contextId?: string; taskId?: string } = {},
): A2AMessage {
  return {
    messageId,
    ...(ids.contextId ? { contextId: ids.contextId } : {}),
    ...(ids.taskId ? { taskId: ids.taskId } : {}),
    role,
    parts: [{ text }],
  };
}

/**
 * The text a request's parts carry, or the media type that made it unreadable.
 *
 * Only text is accepted, which is what `defaultInputModes` advertises. A part
 * naming a text subtype we did not list (`text/markdown`, say) is still text and
 * is read as such — the alternative is refusing content we would have handled
 * correctly. Everything else — a file, a URL, a structured blob — is refused by
 * name rather than silently dropped, because dropping one part of a multi-part
 * message answers a question the client did not ask.
 */
export function textFromParts(parts: A2APart[]): Result<string, string> {
  if (parts.length === 0) {
    return { ok: false, error: 'message.parts must contain at least one part' };
  }

  const chunks: string[] = [];
  for (const part of parts) {
    if (typeof part.text !== 'string') {
      return { ok: false, error: unsupportedPartDescription(part) };
    }
    if (part.mediaType && !part.mediaType.startsWith('text/')) {
      return {
        ok: false,
        error: `unsupported media type "${part.mediaType}"; only text is accepted`,
      };
    }
    chunks.push(part.text);
  }

  const text = chunks.join('\n').trim();
  if (!text) return { ok: false, error: 'message.parts carried no text' };
  return { ok: true, value: text };
}

function unsupportedPartDescription(part: A2APart): string {
  return `unsupported part (${partKind(part)}); only text parts are accepted`;
}

function partKind(part: A2APart): string {
  if (part.raw !== undefined) return 'file content';
  if (part.url !== undefined) return 'file URL';
  if (part.data !== undefined) return 'structured data';
  return 'empty';
}

export interface TaskSnapshot {
  taskId: string;
  contextId: string;
  state: TaskState;
  /** Latest status timestamp, e.g. when the reply landed. */
  timestamp: Date;
  /** The message that best explains the current state — usually the answer. */
  statusMessage?: A2AMessage;
  /** Full turn history, oldest first. Omitted entirely when historyLength is 0. */
  history?: A2AMessage[];
}

export function buildTask(snapshot: TaskSnapshot): A2ATask {
  return {
    id: snapshot.taskId,
    contextId: snapshot.contextId,
    status: {
      state: snapshot.state,
      ...(snapshot.statusMessage ? { message: snapshot.statusMessage } : {}),
      timestamp: isoTimestamp(snapshot.timestamp),
    },
    ...(snapshot.history ? { history: snapshot.history } : {}),
  };
}

/**
 * `historyLength` semantics (§3.2.4): unset means no limit, 0 means omit the
 * field entirely, and a positive value caps to that many *most recent* messages.
 */
export function applyHistoryLength(
  history: A2AMessage[],
  historyLength: number | undefined,
): A2AMessage[] | undefined {
  if (historyLength === undefined) return history;
  if (historyLength <= 0) return undefined;
  return history.slice(-historyLength);
}

/** The A2A error catalogue (§3.3.2), with the binding mappings from §5.4. */
export const A2A_ERRORS = {
  TASK_NOT_FOUND: { http: 404, status: 'NOT_FOUND' },
  TASK_NOT_CANCELABLE: { http: 400, status: 'FAILED_PRECONDITION' },
  PUSH_NOTIFICATION_NOT_SUPPORTED: { http: 400, status: 'FAILED_PRECONDITION' },
  UNSUPPORTED_OPERATION: { http: 400, status: 'FAILED_PRECONDITION' },
  CONTENT_TYPE_NOT_SUPPORTED: { http: 400, status: 'INVALID_ARGUMENT' },
  INVALID_AGENT_RESPONSE: { http: 500, status: 'INTERNAL' },
  EXTENDED_AGENT_CARD_NOT_CONFIGURED: { http: 400, status: 'FAILED_PRECONDITION' },
  EXTENSION_SUPPORT_REQUIRED: { http: 400, status: 'FAILED_PRECONDITION' },
  VERSION_NOT_SUPPORTED: { http: 400, status: 'FAILED_PRECONDITION' },
  // Not A2A-specific, but §3.3.2 requires the same payload shape for them.
  INVALID_ARGUMENT: { http: 400, status: 'INVALID_ARGUMENT' },
  UNAUTHENTICATED: { http: 401, status: 'UNAUTHENTICATED' },
  PERMISSION_DENIED: { http: 403, status: 'PERMISSION_DENIED' },
  INTERNAL: { http: 500, status: 'INTERNAL' },
} as const satisfies Record<string, { http: number; status: string }>;

export type A2AErrorReason = keyof typeof A2A_ERRORS;

export interface A2AErrorBody {
  error: {
    code: number;
    status: string;
    message: string;
    details: Array<Record<string, unknown>>;
  };
}

/**
 * One error, in the `google.rpc.Status` shape the REST binding requires (§11.6).
 *
 * The `ErrorInfo` detail is not decoration: several A2A error types share an
 * HTTP status (`TaskNotCancelable` and `PushNotificationNotSupported` are both
 * 400), so `reason` is the only field that tells a client which one happened.
 */
export function a2aError(
  reason: A2AErrorReason,
  message: string,
  metadata: Record<string, string> = {},
): { body: A2AErrorBody; http: number } {
  const { http, status } = A2A_ERRORS[reason];
  return {
    http,
    body: {
      error: {
        code: http,
        status,
        message,
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            reason,
            domain: 'a2a-protocol.org',
            ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
          },
        ],
      },
    },
  };
}
