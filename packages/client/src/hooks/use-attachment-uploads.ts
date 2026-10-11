import { type ChangeEvent, type RefObject, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import type { AttachmentMeta } from '../stores/chat.js';

/** The gateway's limit per message. */
export const MAX_ATTACHMENTS = 5;

/** What the file picker offers: the images and documents the gateway reads. */
export const ATTACHMENT_ACCEPT =
  'image/png,image/jpeg,image/gif,image/webp,.pdf,.docx,.xlsx,.txt,.md,.csv,.json,.yaml,.yml,.toml,.xml,.html,.css,.js,.ts,.tsx,.py,.go,.rs,.java,.c,.cpp,.sh';

export interface PendingUpload {
  key: string;
  name: string;
  status: 'uploading' | 'done' | 'error';
  meta?: AttachmentMeta;
}

export interface AttachmentUploads {
  uploads: PendingUpload[];
  /** The uploads ready to send with the next message. */
  ready: AttachmentMeta[];
  uploading: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  openFilePicker: () => void;
  remove: (key: string) => void;
  clear: () => void;
}

// Files the composer will send with the next message. Each is uploaded as soon
// as it is picked, so sending is just naming them; the gateway reads documents
// and checks images at upload, and a refusal shows on the chip that caused it.
export function useAttachmentUploads(): AttachmentUploads {
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const patch = (key: string, change: Partial<PendingUpload>) =>
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...change } : u)));

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])].slice(0, MAX_ATTACHMENTS - uploads.length);
    e.target.value = '';
    for (const file of files) {
      const key = `${file.name}:${file.size}:${Math.random()}`;
      setUploads((list) => [...list, { key, name: file.name, status: 'uploading' }]);
      const form = new FormData();
      form.append('file', file);
      api
        .postForm<{ attachment: AttachmentMeta }>('/attachments', form)
        .then(({ attachment }) => patch(key, { status: 'done', meta: attachment }))
        .catch(() => patch(key, { status: 'error' }));
    }
  };

  return {
    uploads,
    ready: uploads.flatMap((u) => (u.status === 'done' && u.meta ? [u.meta] : [])),
    uploading: uploads.some((u) => u.status === 'uploading'),
    fileInputRef,
    handleFileChange,
    openFilePicker: () => fileInputRef.current?.click(),
    remove: (key) => setUploads((list) => list.filter((u) => u.key !== key)),
    clear: () => setUploads([]),
  };
}
