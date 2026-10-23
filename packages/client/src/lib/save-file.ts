/** Hand the reader a file through a temporary blob link. */
export function saveBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  // Revoked on the next tick: some engines start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
