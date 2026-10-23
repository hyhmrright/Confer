import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.js';
import { saveBlob } from '../lib/save-file.js';
import { FOCUS_RING } from '../lib/styles.js';
import type { AttachmentMeta } from '../stores/chat.js';
import { Paperclip } from './Icons.js';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const contentPath = (id: string) => `/attachments/${id}/content`;

// The files sent with a message: images shown, documents offered as downloads.
export function MessageAttachments({ attachments }: { attachments: AttachmentMeta[] }) {
  if (attachments.length === 0) return null;
  const images = attachments.filter((a) => IMAGE_TYPES.has(a.content_type ?? ''));
  const documents = attachments.filter((a) => !IMAGE_TYPES.has(a.content_type ?? ''));
  return (
    <div className="mt-2 space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((a) => (
            <AttachmentImage key={a.id} attachment={a} />
          ))}
        </div>
      )}
      {documents.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {documents.map((a) => (
            <li key={a.id}>
              <DocumentChip attachment={a} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Fetched with the session token — an <img src> cannot send one — and shown
// from a blob URL that is released when the message leaves the screen.
function AttachmentImage({ attachment }: { attachment: AttachmentMeta }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let live = true;
    api
      .getBlob(contentPath(attachment.id))
      .then((blob) => {
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id]);

  return url ? (
    <img
      src={url}
      alt={attachment.filename}
      className="max-h-64 max-w-full rounded-lg border border-dark-border object-contain"
    />
  ) : (
    <div className="h-24 w-32 rounded-lg border border-dark-border bg-dark-card animate-pulse" />
  );
}

function DocumentChip({ attachment }: { attachment: AttachmentMeta }) {
  const { t } = useTranslation();
  const download = () =>
    api
      .getBlob(contentPath(attachment.id))
      .then((blob) => saveBlob(attachment.filename, blob))
      .catch(() => {});
  return (
    <button
      type="button"
      onClick={download}
      aria-label={t('message.downloadAttachment', { name: attachment.filename })}
      className={`flex items-center gap-2 px-2.5 py-1 rounded-md bg-dark-card border border-dark-border text-xs text-ink-secondary hover:text-ink-primary hover:bg-dark-hover ${FOCUS_RING}`}
    >
      <Paperclip className="w-3 h-3 shrink-0" />
      <span className="truncate max-w-56">{attachment.filename}</span>
    </button>
  );
}
