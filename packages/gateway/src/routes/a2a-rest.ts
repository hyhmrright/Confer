import { AppError } from '@confer/shared';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { admitInboundMessage } from '../a2a/inbound.js';
import {
  type A2AErrorReason,
  type A2ATask,
  a2aError,
  isTaskState,
  isTerminal,
  type TaskState,
  textFromParts,
} from '../a2a/rest-model.js';
import { hasReply, listTasks, loadTask } from '../a2a/rest-task.js';
import {
  type Agent,
  findAgentByTenant,
  findSolePublicAgent,
  isReachable,
} from '../a2a/target-agent.js';
import { verifyA2ASignature } from '../a2a/verify-signature.js';
import { SIGNATURE_EXTENSION_URI } from '../lib/agent-card.js';

/**
 * The Linux Foundation A2A HTTP+JSON/REST binding (protocol version 1.0).
 *
 * This is the interface the Agent Card advertises, and the paths are the spec's
 * verbatim (§11.3): `POST /message:send`, `GET /tasks/{id}`, and so on, under
 * `/a2a/v1`. Confer's own dialect lives beside it in `a2a.ts`; both go through
 * `a2a/inbound.ts`, so the consent gate, the tenant scoping and the policy check
 * cannot drift between them.
 *
 * Authentication is the one place this deviates from a stock A2A deployment, and
 * it is deliberate. The spec's `securitySchemes` are API key / HTTP auth /
 * OAuth2 / OIDC / mTLS — none of which is a request signature — while Confer's
 * whole premise is that an agent speaks for a person and proves it with a key
 * published in their DID document. So the requirement is declared the way the
 * spec provides for exactly this case: a `required: true` extension on the Card.
 * §3.3.4 then obliges us to reject a client that did not declare support for it,
 * which is why the header check below runs before the signature is even read —
 * "you must implement RFC 9421" is a far more useful answer than a bare 401.
 */

export const a2aRestRoutes = new Hono();

/** The media type the binding SHOULD use for requests and responses (§11.1). */
const A2A_MEDIA_TYPE = 'application/a2a+json';

/** The protocol version this binding implements, as the Agent Card declares it. */
const PROTOCOL_VERSION = '1.0';

/**
 * How long a blocking `message:send` waits for the answer before handing back a
 * still-`WORKING` task for the client to poll.
 *
 * §3.2.2 says a blocking call waits until the task is terminal or interrupted,
 * with no escape hatch — but an LLM turn has no upper bound and no timeout of
 * its own, and Bun closes an idle connection after 255 seconds regardless. So
 * the wait is bounded and the client is told the truth about where the task got
 * to. The ceiling matches the consult long-poll, which nginx and Bun are already
 * configured to hold open.
 */
const BLOCKING_WAIT_MS = 55_000;
const POLL_INTERVAL_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Respond with the binding's media type rather than plain `application/json`. */
function a2aJson(c: Context, value: unknown, status = 200) {
  return c.body(JSON.stringify(value), status as 200, { 'content-type': A2A_MEDIA_TYPE });
}

function fail(
  c: Context,
  reason: A2AErrorReason,
  message: string,
  metadata: Record<string, string> = {},
) {
  const { body, http } = a2aError(reason, message, metadata);
  return a2aJson(c, body, http);
}

/**
 * §3.3.4: a client that has not declared a `required: true` extension must be
 * refused. Ours is the signature requirement, so this is also the friendly face
 * of the 401 a client would otherwise get with no explanation of what to sign.
 */
const requireSignatureExtension: MiddlewareHandler = async (c, next) => {
  const declared = (c.req.header('a2a-extensions') ?? '')
    .split(',')
    .map((uri) => uri.trim())
    .filter(Boolean);

  if (!declared.includes(SIGNATURE_EXTENSION_URI)) {
    return fail(
      c,
      'EXTENSION_SUPPORT_REQUIRED',
      `This agent requires the HTTP Message Signatures extension. Send the header "A2A-Extensions: ${SIGNATURE_EXTENSION_URI}" and sign the request per RFC 9421.`,
      { extension: SIGNATURE_EXTENSION_URI },
    );
  }
  await next();
};

/**
 * §3.2.6: an unsupported `A2A-Version` is refused.
 *
 * An absent header is accepted rather than defaulting to 0.3 and rejecting it.
 * The URL is version-specific and the Card names 1.0 against it, so a client
 * that reached this path has already been told which version it is speaking; a
 * missing header is an omission, not a request for an old protocol.
 */
const requireSupportedVersion: MiddlewareHandler = async (c, next) => {
  const version = c.req.header('a2a-version');
  if (version && version !== PROTOCOL_VERSION) {
    return fail(
      c,
      'VERSION_NOT_SUPPORTED',
      `This interface implements A2A ${PROTOCOL_VERSION}; the request asked for ${version}.`,
      { supported: PROTOCOL_VERSION },
    );
  }
  await next();
};

/**
 * Contract 1 — the signature check — with its failures reported in the A2A error
 * shape instead of Confer's.
 *
 * The `entered` flag is load-bearing: without it a handler that throws after
 * verification would have its error rewritten as a 401, telling a client its
 * credentials were bad when they were fine.
 */
const requireSignature: MiddlewareHandler = async (c, next) => {
  let entered = false;
  try {
    await verifyA2ASignature(c, async () => {
      entered = true;
      await next();
    });
  } catch (error) {
    if (entered) throw error;
    if (error instanceof AppError) {
      return fail(c, 'UNAUTHENTICATED', error.message, { reason: error.code });
    }
    throw error;
  }
};

const guards = [requireSignatureExtension, requireSupportedVersion, requireSignature] as const;

function callerDid(c: Context): string {
  return (c.get('a2aSenderDid' as never) as string | undefined) ?? '';
}

// ---------------------------------------------------------------------------
// Send message
// ---------------------------------------------------------------------------

const partSchema = z.object({
  text: z.string().max(64_000).optional(),
  raw: z.string().optional(),
  url: z.string().optional(),
  data: z.unknown().optional(),
  mediaType: z.string().max(128).optional(),
  filename: z.string().max(256).optional(),
});

const sendMessageSchema = z.object({
  tenant: z.string().max(128).optional(),
  message: z.object({
    messageId: z.string().min(1).max(128),
    // Their identifier for the conversation. Ours is handed back as the task's
    // `contextId`; echoing it continues the same thread, and anything else is
    // treated as the peer's own numbering and mapped to a local thread.
    contextId: z.string().max(128).optional(),
    taskId: z.string().max(128).optional(),
    role: z.enum(['ROLE_USER', 'ROLE_AGENT', 'ROLE_UNSPECIFIED']),
    parts: z.array(partSchema).min(1).max(64),
  }),
  configuration: z
    .object({
      acceptedOutputModes: z.array(z.string().max(128)).max(32).optional(),
      historyLength: z.number().int().min(0).max(1000).optional(),
      returnImmediately: z.boolean().optional(),
      taskPushNotificationConfig: z.unknown().optional(),
    })
    .optional(),
});

/** The only output this agent produces, so a client that cannot take it is told up front. */
function acceptsPlainText(modes: string[] | undefined): boolean {
  if (!modes || modes.length === 0) return true;
  return modes.some((mode) => mode === '*/*' || mode === 'text/*' || mode.startsWith('text/plain'));
}

a2aRestRoutes.post('/message:send', ...guards, async (c) => {
  const parsed = sendMessageSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return fail(c, 'INVALID_ARGUMENT', `Malformed SendMessageRequest: ${parsed.error.message}`);
  }
  const { tenant, message, configuration } = parsed.data;

  if (message.role !== 'ROLE_USER') {
    return fail(c, 'INVALID_ARGUMENT', 'message.role must be ROLE_USER on a request.');
  }
  if (configuration?.taskPushNotificationConfig) {
    return fail(
      c,
      'PUSH_NOTIFICATION_NOT_SUPPORTED',
      'This agent does not support push notifications.',
    );
  }
  if (!acceptsPlainText(configuration?.acceptedOutputModes)) {
    return fail(
      c,
      'CONTENT_TYPE_NOT_SUPPORTED',
      'This agent only produces text/plain, which the request did not accept.',
    );
  }

  const text = textFromParts(message.parts);
  if (!text.ok) return fail(c, 'CONTENT_TYPE_NOT_SUPPORTED', text.error);

  const target = await resolveTenant(tenant);
  if ('reason' in target) return fail(c, target.reason, target.message);

  // Each question is its own task, and none of them ever ends in a state that
  // accepts more input — so a `taskId` can only be a misunderstanding, and the
  // spec has an exact error for each way it can be wrong (§3.1.1).
  if (message.taskId) {
    const existing = await loadTask(message.taskId, callerDid(c));
    if (!existing) {
      return fail(c, 'TASK_NOT_FOUND', 'No such task.', { taskId: message.taskId });
    }
    return fail(
      c,
      'UNSUPPORTED_OPERATION',
      isTerminal(existing.state)
        ? 'That task has finished and cannot accept further messages.'
        : 'This agent does not accept additional messages on a running task; send a new message with the same contextId instead.',
      { taskId: message.taskId, state: existing.state },
    );
  }

  const admitted = await admitInboundMessage({
    targetAgent: target.agent,
    // There is no `from` field in this binding: identity is the signature, and
    // the signer DID is the only thing a peer can prove about itself.
    senderDid: callerDid(c),
    signerDid: callerDid(c),
    threadId: message.contextId,
    message: { type: 'question', content: text.value },
  });

  switch (admitted.status) {
    case 'pending_connection':
      // No task exists to report on: the owner has been handed a connection
      // request, and until they accept it there is nothing here to poll. An
      // authorization error says that in one round trip; a fabricated task id
      // would 404 on the very next call.
      return fail(
        c,
        'PERMISSION_DENIED',
        "You are not a contact of this agent's owner. A connection request has been raised; retry once it is accepted.",
        { confer_status: 'pending_connection' },
      );
    case 'denied':
      return fail(c, 'PERMISSION_DENIED', "This agent's policy refuses requests from you.", {
        confer_status: 'policy_denied',
      });
    default:
      break;
  }

  const historyLength = configuration?.historyLength;
  const immediately = configuration?.returnImmediately === true;

  // A held question is already in an interrupted state, so even a blocking call
  // returns now — there is nothing to wait for until a human acts.
  const task =
    immediately || admitted.status === 'held'
      ? (await loadTask(admitted.messageId, callerDid(c), historyLength))?.task
      : await waitForTask(admitted.messageId, callerDid(c), historyLength);

  // A task we just created must be readable back. If it is not, something wrote
  // a row this process cannot see — and saying so in the binding's own error
  // shape beats a hollow 200, or an error envelope a standard client cannot read.
  if (!task) {
    return fail(c, 'INTERNAL', 'The task could not be read back after it was created.');
  }
  return a2aJson(c, task, 200);
});

/** Poll until the answer lands, or until the blocking budget runs out. */
async function waitForTask(
  taskId: string,
  caller: string,
  historyLength: number | undefined,
): Promise<A2ATask | undefined> {
  const deadline = Date.now() + BLOCKING_WAIT_MS;
  while (Date.now() < deadline && !(await hasReply(taskId))) {
    await sleep(POLL_INTERVAL_MS);
  }
  return (await loadTask(taskId, caller, historyLength))?.task;
}

type TenantResolution = { agent: Agent } | { reason: A2AErrorReason; message: string };

/**
 * The agent a request is addressed to.
 *
 * `tenant` is the Card's opaque routing selector — this instance publishes the
 * owner's username as its value, because that is already the stable public part
 * of the agent's DID and a standard client never sees a DID at all. Omitting it
 * is only unambiguous on a single-agent instance, which is the same condition
 * `/.well-known/agent-card.json` answers under.
 */
async function resolveTenant(tenant: string | undefined): Promise<TenantResolution> {
  if (tenant) {
    const agent = await findAgentByTenant(tenant);
    if (!isReachable(agent)) {
      return { reason: 'TASK_NOT_FOUND', message: `No agent is served for tenant "${tenant}".` };
    }
    return { agent };
  }

  const sole = await findSolePublicAgent();
  if (!isReachable(sole)) {
    return {
      reason: 'INVALID_ARGUMENT',
      message:
        "This instance serves several agents, so `tenant` is required. Its value is on each agent's Card at /agents/{username}/agent-card.json.",
    };
  }
  return { agent: sole };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

a2aRestRoutes.get('/tasks', ...guards, async (c) => {
  const historyLength = optionalInt(c.req.query('historyLength'));
  const rawPageSize = optionalInt(c.req.query('pageSize'));
  // §3.1.4: default 50, minimum 1, maximum 100.
  const pageSize = rawPageSize === undefined ? 50 : Math.min(Math.max(rawPageSize, 1), 100);

  const page = await listTasks({
    callerDid: callerDid(c),
    contextId: c.req.query('contextId') || undefined,
    state: taskStateQuery(c.req.query('status')),
    pageSize,
    pageToken: c.req.query('pageToken') || undefined,
    historyLength,
  });

  return a2aJson(c, page);
});

a2aRestRoutes.get('/tasks/:id', ...guards, async (c) => {
  const loaded = await loadTask(
    c.req.param('id'),
    callerDid(c),
    optionalInt(c.req.query('historyLength')),
  );
  if (!loaded) {
    return fail(c, 'TASK_NOT_FOUND', 'No such task.', { taskId: c.req.param('id') });
  }
  return a2aJson(c, loaded.task);
});

/**
 * `POST /tasks/{id}:cancel` and `POST /tasks/{id}:subscribe`.
 *
 * Both arrive here rather than as their own routes because Hono cannot express a
 * literal suffix after a path parameter — `/tasks/:id{[^:]+}:cancel` compiles
 * but matches nothing, which was verified rather than assumed.
 */
a2aRestRoutes.post('/tasks/:target', ...guards, async (c) => {
  const target = c.req.param('target');
  const separator = target.lastIndexOf(':');
  const id = separator === -1 ? '' : target.slice(0, separator);
  const verb = separator === -1 ? '' : target.slice(separator + 1);

  if (verb !== 'cancel' && verb !== 'subscribe') {
    return fail(
      c,
      'UNSUPPORTED_OPERATION',
      'Supported task operations are `:cancel` and `:subscribe`.',
    );
  }

  if (verb === 'subscribe') {
    // capabilities.streaming is false, and §3.3.4 requires this exact error.
    return fail(c, 'UNSUPPORTED_OPERATION', 'This agent does not support streaming.');
  }

  const loaded = await loadTask(id, callerDid(c));
  if (!loaded) return fail(c, 'TASK_NOT_FOUND', 'No such task.', { taskId: id });

  // Cancellation is genuinely unavailable: a turn is one LLM call with no
  // interruption point, and by the time a cancel could arrive the owner has
  // already been billed for it. §3.1.5 anticipates exactly this and reserves
  // `TaskNotCancelableError` for a task that cannot be cancelled at its
  // current stage — which here is every stage.
  return fail(
    c,
    'TASK_NOT_CANCELABLE',
    isTerminal(loaded.state)
      ? 'That task has already finished.'
      : 'This agent cannot cancel a turn once it has started.',
    { taskId: id, state: loaded.state },
  );
});

// ---------------------------------------------------------------------------
// Capabilities this agent does not have (§3.3.4 requires each to say so)
// ---------------------------------------------------------------------------

a2aRestRoutes.post('/message:stream', ...guards, (c) =>
  fail(c, 'UNSUPPORTED_OPERATION', 'This agent does not support streaming.'),
);

const pushNotSupported = (c: Context) =>
  fail(c, 'PUSH_NOTIFICATION_NOT_SUPPORTED', 'This agent does not support push notifications.');

a2aRestRoutes.post('/tasks/:id/pushNotificationConfigs', ...guards, pushNotSupported);
a2aRestRoutes.get('/tasks/:id/pushNotificationConfigs', ...guards, pushNotSupported);
a2aRestRoutes.get('/tasks/:id/pushNotificationConfigs/:configId', ...guards, pushNotSupported);
a2aRestRoutes.delete('/tasks/:id/pushNotificationConfigs/:configId', ...guards, pushNotSupported);

a2aRestRoutes.get('/extendedAgentCard', ...guards, (c) =>
  fail(
    c,
    'UNSUPPORTED_OPERATION',
    'This agent publishes one Card, at /agents/{username}/agent-card.json.',
  ),
);

// ---------------------------------------------------------------------------

/** Query parameters are strings; a non-numeric one is absent, not zero (§11.5). */
function optionalInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  return Number.isInteger(value) ? value : undefined;
}

function taskStateQuery(raw: string | undefined): TaskState | undefined {
  return raw && isTaskState(raw) ? raw : undefined;
}
