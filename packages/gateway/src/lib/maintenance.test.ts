import { afterEach, expect, spyOn, test } from 'bun:test';
import { runDetached, settleDetached, trackResponseWork } from './background.js';
import { maintenanceRequest, maintenanceStatus, setMaintenance } from './maintenance.js';

afterEach(() => setMaintenance(false));
test('drains response bodies and detached writes before a consistent backup', async () => {
  let finish: (() => void) | undefined;
  const work = new Promise<void>((resolve) => {
    finish = resolve;
  });
  runDetached(work, () => {});
  let close: (() => void) | undefined;
  const response = await maintenanceRequest(
    new Request('http://localhost/stream'),
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('first'));
            close = () => controller.close();
          },
        }),
      ),
  );
  setMaintenance(true);
  expect(maintenanceStatus().ready).toBe(false);
  const denied = await maintenanceRequest(new Request('http://localhost/write'), () => {
    throw new Error('must not run');
  });
  expect(denied.status).toBe(503);
  close?.();
  expect(await response.text()).toBe('first');
  expect(maintenanceStatus().ready).toBe(false);
  finish?.();
  await settleDetached();
  expect(maintenanceStatus().ready).toBe(true);
  const health = await maintenanceRequest(new Request('http://localhost/health'), () =>
    Response.json(maintenanceStatus()),
  );
  expect(health.status).toBe(200);
});
test('cancellation and errors release requests; resuming restores admission', async () => {
  const response = await maintenanceRequest(
    new Request('http://localhost/stream'),
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
          },
        }),
      ),
  );
  await response.body?.cancel();
  setMaintenance(true);
  expect(maintenanceStatus().ready).toBe(true);
  setMaintenance(false);
  await expect(
    maintenanceRequest(new Request('http://localhost/fail'), () => {
      throw new Error('broken');
    }),
  ).rejects.toThrow('broken');
  setMaintenance(true);
  expect(maintenanceStatus().ready).toBe(true);
  setMaintenance(false);
  expect(
    (
      await maintenanceRequest(
        new Request('http://localhost/ok'),
        () => new Response(null, { status: 204 }),
      )
    ).status,
  ).toBe(204);
});

test('an abandoned maintenance lease expires without an operator', async () => {
  const now = Date.now();
  setMaintenance(true);
  const clock = spyOn(Date, 'now').mockReturnValue(now + 16 * 60_000);
  try {
    expect(maintenanceStatus().maintenance).toBe(false);
    expect(
      (
        await maintenanceRequest(
          new Request('http://localhost/ok'),
          () => new Response(null, { status: 204 }),
        )
      ).status,
    ).toBe(204);
  } finally {
    clock.mockRestore();
  }
});

test('maintenance renewal keeps its generation; a new lease cannot masquerade as the old capture', () => {
  setMaintenance(true);
  const generation = maintenanceStatus().generation;
  setMaintenance(true);
  expect(maintenanceStatus().generation).toBe(generation);
  setMaintenance(false);
  setMaintenance(true);
  expect(maintenanceStatus().generation).toBe(generation + 1);
});

test('a disconnected SSE client cannot make a still-running writer look safe to snapshot', async () => {
  let release: () => void = () => {};
  const writer = trackResponseWork(
    async (_stream: undefined) =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  )(undefined);
  const response = await maintenanceRequest(
    new Request('http://localhost/stream'),
    () => new Response(new ReadableStream()),
  );
  await response.body?.cancel();
  setMaintenance(true);
  expect(maintenanceStatus().ready).toBe(false);
  release();
  await writer;
  await settleDetached();
  expect(maintenanceStatus().ready).toBe(true);
});
test('in-flight self A2A continuations can drain but cannot write after the snapshot freezes', async () => {
  let release: () => void = () => {};
  runDetached(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
    () => {},
  );
  setMaintenance(true);
  const continuation = await maintenanceRequest(
    new Request('http://localhost/a2a/v1/messages'),
    () => new Response('answer'),
    true,
  );
  expect(continuation.status).toBe(200);
  await continuation.text();
  expect(maintenanceStatus().ready).toBe(false);
  release();
  await settleDetached();
  expect(maintenanceStatus().ready).toBe(true);
  expect(
    (
      await maintenanceRequest(
        new Request('http://localhost/a2a/v1/messages'),
        () => new Response('must not run'),
        true,
      )
    ).status,
  ).toBe(503);
});
