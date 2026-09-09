'use client';

import { type ChangeEvent, useState } from 'react';
import { FILE_CAP } from '@pinloop/shared';
import { useUploadResume } from '../../lib/profile-queries.ts';
import { Card, CardContent, CardHeader } from '../../components/ui/card.tsx';

export function ResumeCard() {
  const upload = useUploadResume();
  const [clientError, setClientError] = useState<string | null>(null);

  function handleFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setClientError(null);

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
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold">Resume</h2>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <input type="file" accept="application/pdf" aria-label="Resume" onChange={handleFile} className="text-sm" />
        {upload.isPending && <p className="text-sm text-muted-foreground">Uploading…</p>}
        {clientError && (
          <p role="alert" className="text-sm text-destructive">
            {clientError}
          </p>
        )}
        {upload.isError && (
          <p role="alert" className="text-sm text-destructive">
            {upload.error.message}
          </p>
        )}
        {upload.isSuccess && (
          <p aria-live="polite" className="text-sm text-muted-foreground">
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
      </CardContent>
    </Card>
  );
}
