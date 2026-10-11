import { AppError } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { attachments, messages } from '../db/schema.js';
import { isImageType, storeAttachment } from '../lib/attachments.js';
import { getObject } from '../lib/storage.js';
import { isConversationParticipant } from '../lib/tenant.js';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import type { AppEnv } from '../types.js';

export const attachmentRoutes = new Hono<AppEnv>();

attachmentRoutes.use('/*', authMiddleware);

// Upload one file ahead of sending the message it belongs to. The row is
// unbound until `POST /conversations/{id}/messages` claims it.
attachmentRoutes.post(
  '/',
  rateLimit<AppEnv>(30, 60_000, { keyBy: (c) => `attach:${c.get('user').sub}` }),
  async (c) => {
    const user = c.get('user');
    const file = (await c.req.formData()).get('file');
    if (!(file instanceof File)) throw new AppError('bad_request', 'No file uploaded', 400);
    return c.json({ attachment: await storeAttachment(user.sub, file) }, 201);
  },
);

// The file itself, to whoever may read the message it was sent with — or to
// its uploader before it is sent. 404 rather than 403 for everyone else, so an
// id says nothing about whether it exists.
attachmentRoutes.get('/:id/content', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const [row] = await db
    .select({
      user_id: attachments.user_id,
      filename: attachments.filename,
      content_type: attachments.content_type,
      storage_url: attachments.storage_url,
      conversation_id: messages.conversation_id,
    })
    .from(attachments)
    .leftJoin(messages, eq(messages.id, attachments.message_id))
    .where(eq(attachments.id, c.req.param('id')))
    .limit(1);

  const allowed =
    row &&
    (row.user_id === user.sub ||
      (row.conversation_id !== null &&
        (await isConversationParticipant(user.sub, row.conversation_id))));
  if (!allowed) throw new AppError('not_found', 'Attachment not found', 404);

  const body = await getObject(row.storage_url);
  // Only a sniffed raster image is served inline. Anything else is a download
  // under a generic type, so no upload can be rendered as a page on this origin.
  const inline = isImageType(row.content_type);
  return new Response(new Uint8Array(body), {
    headers: {
      'content-type': inline ? (row.content_type as string) : 'application/octet-stream',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=3600',
    },
  });
});
