import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { encrypt, newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { app } from '../app.js';
import { getDb } from '../db/connection.js';
import { agents, attachments, users } from '../db/schema.js';
import { getEnv } from '../env.js';
import { del, get, mockFetch, post, resetDb, type SeededUser, seedUser } from '../test/helpers.js';

// The smallest valid PNG: 1×1, one transparent pixel.
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  ),
  (ch) => ch.charCodeAt(0),
);

let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

function upload(
  token: string,
  name: string,
  bytes: Uint8Array<ArrayBuffer> | string,
  type: string,
) {
  const form = new FormData();
  form.append('file', new File([bytes], name, { type }));
  return app.request('/api/v1/attachments', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
}

async function uploadId(
  token: string,
  name: string,
  bytes: Uint8Array<ArrayBuffer> | string,
  type: string,
) {
  const res = await upload(token, name, bytes, type);
  expect(res.status).toBe(201);
  return (await res.json()).attachment.id as string;
}

async function conversation(token: string): Promise<string> {
  const res = await post('/api/v1/conversations', { token, body: { name: 'Files' } });
  return (await res.json()).conversation.id;
}

const send = (token: string, convId: string, body: Record<string, unknown>) =>
  post(`/api/v1/conversations/${convId}/messages`, { token, body });

describe('uploading', () => {
  test('recognises an image by its bytes, not by the type the browser claimed', async () => {
    const res = await upload(user.token, 'cat.bin', PNG, 'application/octet-stream');
    expect(res.status).toBe(201);
    expect((await res.json()).attachment).toMatchObject({
      filename: 'cat.bin',
      content_type: 'image/png',
      size_bytes: PNG.byteLength,
    });
  });

  // SVG can carry script and the content route serves images inline, so it is
  // never an image here: it is read as the text it is, and downloaded as such.
  test('takes SVG as text, never as an image', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const res = await upload(user.token, 'x.svg', svg, 'image/svg+xml');
    const { attachment } = await res.json();
    expect(attachment.content_type).toBe('text/plain');
    const served = await get(`/api/v1/attachments/${attachment.id}/content`, { token: user.token });
    expect(served.headers.get('content-type')).toBe('application/octet-stream');
  });

  test('refuses bytes that are neither an image nor readable text', async () => {
    const binary = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0xff, 0xfe]);
    expect((await upload(user.token, 'x.exe', binary, 'application/x-msdownload')).status).toBe(
      400,
    );
  });

  // Browsers label a `.ts` source file as an MPEG transport stream.
  test('reads a text file by its extension when the browser mislabels it', async () => {
    const res = await upload(user.token, 'main.ts', 'export const x = 1;', 'video/mp2t');
    expect(res.status).toBe(201);
    expect((await res.json()).attachment.content_type).toBe('text/plain');
  });

  test('refuses an image over the per-image ceiling', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG);
    expect((await upload(user.token, 'big.png', big, 'image/png')).status).toBe(400);
  });
});

describe('sending', () => {
  test('a message claims its uploads, and they come back with it', async () => {
    const convId = await conversation(user.token);
    const image = await uploadId(user.token, 'cat.png', PNG, 'image/png');
    const note = await uploadId(user.token, 'notes.md', '# Plan\nship it', 'text/markdown');

    // An image needs no caption.
    expect(
      (await send(user.token, convId, { content: '', attachment_ids: [image, note] })).status,
    ).toBe(201);

    const { messages } = await (
      await get(`/api/v1/conversations/${convId}/messages`, { token: user.token })
    ).json();
    expect(messages[0].attachments.map((a: { filename: string }) => a.filename)).toEqual([
      'cat.png',
      'notes.md',
    ]);
  });

  test('an id is not a capability: another user’s upload, or a sent one, is refused', async () => {
    const convId = await conversation(user.token);
    const other = await seedUser();
    const theirs = await uploadId(other.token, 'x.png', PNG, 'image/png');
    expect(
      (await send(user.token, convId, { content: 'hi', attachment_ids: [theirs] })).status,
    ).toBe(400);

    const mine = await uploadId(user.token, 'y.png', PNG, 'image/png');
    expect((await send(user.token, convId, { content: 'a', attachment_ids: [mine] })).status).toBe(
      201,
    );
    expect((await send(user.token, convId, { content: 'b', attachment_ids: [mine] })).status).toBe(
      400,
    );
  });

  test('a message with neither text nor files is refused', async () => {
    const convId = await conversation(user.token);
    expect((await send(user.token, convId, { content: '' })).status).toBe(400);
  });

  test('deleting the conversation takes its attachments with it', async () => {
    const convId = await conversation(user.token);
    const id = await uploadId(user.token, 'cat.png', PNG, 'image/png');
    await send(user.token, convId, { content: 'x', attachment_ids: [id] });

    expect((await del(`/api/v1/conversations/${convId}`, { token: user.token })).status).toBe(200);
    expect(await getDb().select().from(attachments).where(eq(attachments.id, id))).toEqual([]);
  });
});

describe('reading the file', () => {
  test('serves an image inline to a participant and to nobody else', async () => {
    const convId = await conversation(user.token);
    const id = await uploadId(user.token, 'cat.png', PNG, 'image/png');
    await send(user.token, convId, { content: 'x', attachment_ids: [id] });

    const res = await get(`/api/v1/attachments/${id}/content`, { token: user.token });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-disposition')).toStartWith('inline');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);

    const outsider = await seedUser();
    expect((await get(`/api/v1/attachments/${id}/content`, { token: outsider.token })).status).toBe(
      404,
    );
  });

  // Anything that is not a sniffed raster image is a download, so no upload can
  // be rendered as a page on the app's own origin.
  test('serves a document as a download under a generic type', async () => {
    const id = await uploadId(user.token, 'page.md', '<script>alert(1)</script>', 'text/markdown');
    const res = await get(`/api/v1/attachments/${id}/content`, { token: user.token });
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toStartWith('attachment');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('in the agent turn', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  test('the model receives the image as an image and the document as text', async () => {
    const enc = await encrypt('sk-test', getEnv().ENCRYPTION_KEY);
    if (!enc.ok) throw new Error(enc.error);
    await getDb()
      .update(users)
      .set({ llm_keys_json: { openai: enc.value } })
      .where(eq(users.id, user.id));
    await getDb()
      .insert(agents)
      .values({
        id: newId(),
        user_id: user.id,
        did: `${user.did}:agent`,
        model_config_json: { provider: 'openai' },
      });

    let sent: Array<{ role: string; content: unknown }> = [];
    restore = mockFetch((url, init) => {
      // Recall's embedding call would otherwise leave for the real vendor.
      if (url.includes('/embeddings')) return new Response('{}', { status: 401 });
      if (!url.includes('/chat/completions')) return undefined;
      const body = JSON.parse(String(init?.body));
      if (body.stream) sent = body.messages;
      return new Response(
        body.stream
          ? `data: ${JSON.stringify({ choices: [{ delta: { content: 'A cat.' } }] })}\n\ndata: [DONE]\n\n`
          : JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
        { headers: { 'content-type': body.stream ? 'text/event-stream' : 'application/json' } },
      );
    });

    const convId = await conversation(user.token);
    const image = await uploadId(user.token, 'cat.png', PNG, 'image/png');
    const note = await uploadId(user.token, 'notes.md', 'ship on friday', 'text/markdown');
    const msg = await send(user.token, convId, {
      content: 'what is this?',
      attachment_ids: [image, note],
    });
    const { id } = await msg.json();

    const res = await get(`/api/v1/stream/${convId}/${id}`, { token: user.token });
    expect(await res.text()).toContain('A cat.');

    const question = sent.at(-1);
    expect(question?.role).toBe('user');
    const parts = question?.content as Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }>;
    expect(parts[0]?.image_url?.url.startsWith('data:image/png;base64,')).toBe(true);
    expect(parts[1]?.text).toContain('what is this?');
    expect(parts[1]?.text).toContain('<attachment name="notes.md">\nship on friday\n</attachment>');
  });
});
