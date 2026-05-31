import { type ChangeEvent, type RefObject, useRef, useState } from 'react';

const MAX_FILE_CHARS = 40_000;

export interface AttachedFile {
  name: string;
  content: string;
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file, 'utf-8');
  });
}

export interface FileAttachment {
  attachedFile: AttachedFile | null;
  fileInputRef: RefObject<HTMLInputElement>;
  handleFileChange: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  openFilePicker: () => void;
  clearAttachment: () => void;
}

// Reads a chosen text file (truncated to MAX_FILE_CHARS) into memory so the
// composer can inline it into the next message. Self-contained: owns the hidden
// file input ref and the attachment state.
export function useFileAttachment(): FileAttachment {
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      let content = await readFileAsText(file);
      if (content.length > MAX_FILE_CHARS)
        content = content.slice(0, MAX_FILE_CHARS) + '\n\n[内容已截断]';
      setAttachedFile({ name: file.name, content });
    } catch {
      alert('无法读取该文件，请选择文本文件。');
    }
  };

  return {
    attachedFile,
    fileInputRef,
    handleFileChange,
    openFilePicker: () => fileInputRef.current?.click(),
    clearAttachment: () => setAttachedFile(null),
  };
}
