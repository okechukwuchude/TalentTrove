'use client';

import { type ChangeEvent, useState } from 'react';
import { FILE_CAP } from '@pinloop/shared';
import { useUploadResume } from '../../lib/profile-queries.ts';

export function ResumeCard() {
  const upload = useUploadResume();
  const [clientError, setClientError] = useState<string | null>(null);

  function handleFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setClientError(null);

    // Fast, client-side checks only — the server's own byte-header check
    // (beginsLikeAPdf in packages/shared) remains the real authority. This
    // catches the two most common mistakes without a round trip, and avoids
    // needing a Buffer polyfill in the browser: beginsLikeAPdf takes a Node
    // Buffer, which the browser doesn't have.
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setClientError('that does not look like a PDF file');
      return;
    }
    if (file.size > FILE_CAP) {
      setClientError(`that file is ${file.size.toLocaleString('en-US')} bytes, over the 10MB limit`);
      return;
    }

    upload.mutate(file);
  }

  return (
    <section>
      <h2>Resume</h2>
      <input type="file" accept="application/pdf" aria-label="Resume" onChange={handleFile} />
      {upload.isPending && <p>Uploading…</p>}
      {clientError && <p role="alert">{clientError}</p>}
      {upload.isError && <p role="alert">{upload.error.message}</p>}
      {upload.isSuccess && (
        <p aria-live="polite">
          Stored
          {typeof upload.data.pages === 'number'
            ? ` — ${upload.data.pages} page${upload.data.pages === 1 ? '' : 's'}, ` +
              `${upload.data.pages_read ?? upload.data.pages} read, ` +
              `${(upload.data.characters ?? 0).toLocaleString('en-US')} characters of text stored`
            : typeof upload.data.bytes === 'number'
              ? ` — ${upload.data.bytes.toLocaleString('en-US')} bytes`
              : ''}
          {upload.data.note ? ` ${upload.data.note}` : ''}
        </p>
      )}
    </section>
  );
}
