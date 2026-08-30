import { describe, expect, test } from 'bun:test';
import {
  A2A_ERRORS,
  a2aError,
  applyHistoryLength,
  buildTask,
  isoTimestamp,
  isTerminal,
  textFromParts,
  textMessage,
} from './rest-model.js';

// The wire contract with any A2A client that is not Confer. Every expectation
// here is a literal from `specification/a2a.proto` at v1.0.1 or from the spec
// prose — a value that "looks right" is not the same as the value the standard
// names, and a client written against the standard will not negotiate.

describe('textFromParts', () => {
  test('joins the text of every part', () => {
    const result = textFromParts([{ text: 'first' }, { text: 'second' }]);
    expect(result).toEqual({ ok: true, value: 'first\nsecond' });
  });

  test('accepts a text part with no media type', () => {
    expect(textFromParts([{ text: 'hello' }])).toEqual({ ok: true, value: 'hello' });
  });

  test('accepts a text subtype we did not advertise', () => {
    // Refusing text/markdown would be refusing content we handle correctly.
    const result = textFromParts([{ text: '# heading', mediaType: 'text/markdown' }]);
    expect(result.ok).toBe(true);
  });

  test('refuses a non-text media type by name', () => {
    const result = textFromParts([{ text: 'x', mediaType: 'application/pdf' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('application/pdf');
  });

  test.each([
    ['file content', { raw: 'AAAA' }],
    ['file URL', { url: 'https://example.com/a.pdf' }],
    ['structured data', { data: { a: 1 } }],
  ])('refuses a %s part rather than dropping it', (kind, part) => {
    // Silently skipping one part of a multi-part message answers a question the
    // client did not ask.
    const result = textFromParts([{ text: 'question' }, part]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(kind);
  });

  test('refuses an empty parts array', () => {
    expect(textFromParts([]).ok).toBe(false);
  });

  test('refuses parts that carry only whitespace', () => {
    expect(textFromParts([{ text: '   ' }]).ok).toBe(false);
  });
});

describe('applyHistoryLength', () => {
  const history = [
    textMessage('a', 'ROLE_USER', 'a'),
    textMessage('b', 'ROLE_AGENT', 'b'),
    textMessage('c', 'ROLE_USER', 'c'),
  ];

  test('unset means no limit', () => {
    expect(applyHistoryLength(history, undefined)).toHaveLength(3);
  });

  test('zero means omit the field entirely, not return an empty array', () => {
    expect(applyHistoryLength(history, 0)).toBeUndefined();
  });

  test('a positive value keeps the most RECENT messages', () => {
    expect(applyHistoryLength(history, 2)?.map((m) => m.messageId)).toEqual(['b', 'c']);
  });

  test('a limit beyond the history returns all of it', () => {
    expect(applyHistoryLength(history, 99)).toHaveLength(3);
  });
});

describe('task states', () => {
  test.each([
    'TASK_STATE_COMPLETED',
    'TASK_STATE_FAILED',
    'TASK_STATE_CANCELED',
    'TASK_STATE_REJECTED',
  ] as const)('%s is terminal', (state) => {
    expect(isTerminal(state)).toBe(true);
  });

  test.each([
    'TASK_STATE_SUBMITTED',
    'TASK_STATE_WORKING',
    'TASK_STATE_INPUT_REQUIRED',
    // Interrupted, not terminal: a human can still let it proceed.
    'TASK_STATE_AUTH_REQUIRED',
  ] as const)('%s is not terminal', (state) => {
    expect(isTerminal(state)).toBe(false);
  });
});

describe('buildTask', () => {
  const at = new Date('2026-08-30T12:34:56.789Z');

  test('serializes to the proto3 JSON shape', () => {
    const task = buildTask({
      taskId: 'task-1',
      contextId: 'ctx-1',
      state: 'TASK_STATE_COMPLETED',
      timestamp: at,
      statusMessage: textMessage('m1', 'ROLE_AGENT', 'answer'),
      history: [textMessage('m0', 'ROLE_USER', 'question')],
    });

    expect(task).toEqual({
      id: 'task-1',
      contextId: 'ctx-1',
      status: {
        state: 'TASK_STATE_COMPLETED',
        message: { messageId: 'm1', role: 'ROLE_AGENT', parts: [{ text: 'answer' }] },
        timestamp: '2026-08-30T12:34:56.789Z',
      },
      history: [{ messageId: 'm0', role: 'ROLE_USER', parts: [{ text: 'question' }] }],
    });
  });

  test('omits history entirely when there is none to report', () => {
    const task = buildTask({
      taskId: 't',
      contextId: 'c',
      state: 'TASK_STATE_WORKING',
      timestamp: at,
    });
    expect('history' in task).toBe(false);
    expect('message' in task.status).toBe(false);
  });

  test('timestamps are ISO 8601 UTC with milliseconds', () => {
    // §5.6.1: `YYYY-MM-DDTHH:mm:ss.sssZ`, never an offset other than Z.
    expect(isoTimestamp(at)).toBe('2026-08-30T12:34:56.789Z');
    expect(isoTimestamp(at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('a2aError', () => {
  test('carries the reason in an ErrorInfo detail, not just the HTTP status', () => {
    // Several A2A errors share one status — TaskNotCancelable and
    // PushNotificationNotSupported are both 400 — so `reason` is the only field
    // that tells a client which of them happened.
    const { body, http } = a2aError('TASK_NOT_CANCELABLE', 'nope', { taskId: 't1' });

    expect(http).toBe(400);
    expect(body.error.code).toBe(400);
    expect(body.error.status).toBe('FAILED_PRECONDITION');
    expect(body.error.details[0]).toEqual({
      '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
      reason: 'TASK_NOT_CANCELABLE',
      domain: 'a2a-protocol.org',
      metadata: { taskId: 't1' },
    });
  });

  test('omits the metadata key when there is none', () => {
    const { body } = a2aError('TASK_NOT_FOUND', 'gone');
    expect(body.error.details[0]).not.toHaveProperty('metadata');
  });

  test('matches the §5.4 error mapping table exactly', () => {
    // Transcribed from the spec. A wrong status here is invisible in our own
    // tests and fatal to a client switching on it, so the whole table is
    // compared at once rather than the few entries this code happens to use.
    expect({
      TASK_NOT_FOUND: A2A_ERRORS.TASK_NOT_FOUND,
      TASK_NOT_CANCELABLE: A2A_ERRORS.TASK_NOT_CANCELABLE,
      PUSH_NOTIFICATION_NOT_SUPPORTED: A2A_ERRORS.PUSH_NOTIFICATION_NOT_SUPPORTED,
      UNSUPPORTED_OPERATION: A2A_ERRORS.UNSUPPORTED_OPERATION,
      CONTENT_TYPE_NOT_SUPPORTED: A2A_ERRORS.CONTENT_TYPE_NOT_SUPPORTED,
      INVALID_AGENT_RESPONSE: A2A_ERRORS.INVALID_AGENT_RESPONSE,
      EXTENDED_AGENT_CARD_NOT_CONFIGURED: A2A_ERRORS.EXTENDED_AGENT_CARD_NOT_CONFIGURED,
      EXTENSION_SUPPORT_REQUIRED: A2A_ERRORS.EXTENSION_SUPPORT_REQUIRED,
      VERSION_NOT_SUPPORTED: A2A_ERRORS.VERSION_NOT_SUPPORTED,
    }).toEqual({
      TASK_NOT_FOUND: { http: 404, status: 'NOT_FOUND' },
      TASK_NOT_CANCELABLE: { http: 400, status: 'FAILED_PRECONDITION' },
      PUSH_NOTIFICATION_NOT_SUPPORTED: { http: 400, status: 'FAILED_PRECONDITION' },
      UNSUPPORTED_OPERATION: { http: 400, status: 'FAILED_PRECONDITION' },
      CONTENT_TYPE_NOT_SUPPORTED: { http: 400, status: 'INVALID_ARGUMENT' },
      INVALID_AGENT_RESPONSE: { http: 500, status: 'INTERNAL' },
      EXTENDED_AGENT_CARD_NOT_CONFIGURED: { http: 400, status: 'FAILED_PRECONDITION' },
      EXTENSION_SUPPORT_REQUIRED: { http: 400, status: 'FAILED_PRECONDITION' },
      VERSION_NOT_SUPPORTED: { http: 400, status: 'FAILED_PRECONDITION' },
    });
  });
});
