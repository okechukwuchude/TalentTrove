'use client';

import { useEffect, useState } from 'react';
import { useProfileDocumentText, useResetToDefault, useSaveTextDocument } from '../../lib/profile-queries.ts';

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function TextDocumentCard({
  name,
  label,
  perDocumentCap,
  resettable = false,
}: {
  name: string;
  label: string;
  perDocumentCap: number;
  resettable?: boolean;
}) {
  const { data, isLoading } = useProfileDocumentText(name);
  const save = useSaveTextDocument(name);
  const reset = useResetToDefault(name);
  const [draft, setDraft] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched && data?.text !== undefined) setDraft(data.text);
  }, [data?.text, touched]);

  const byteCount = byteLength(draft);
  const overCap = byteCount > perDocumentCap;
  const usingDefault = resettable && data?.stored === false;

  return (
    <section>
      <h2>{label}</h2>
      {isLoading ? (
        <p>Loading…</p>
      ) : (
        <>
          {usingDefault && <p>Using the default Pinloop ships. Edit below to store your own.</p>}
          <textarea
            aria-label={label}
            value={draft}
            onChange={(event) => {
              setTouched(true);
              setDraft(event.target.value);
            }}
          />
          <p aria-live="polite">
            {byteCount.toLocaleString('en-US')} / {perDocumentCap.toLocaleString('en-US')} bytes
            {overCap ? ' — over the per-document limit' : ''}
          </p>
          <button
            type="button"
            disabled={save.isPending || overCap || draft === (data?.text ?? '')}
            onClick={() => save.mutate(draft, { onSuccess: () => setTouched(false) })}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          {resettable && !usingDefault && (
            <button
              type="button"
              disabled={reset.isPending}
              onClick={() => reset.mutate(undefined, { onSuccess: () => setTouched(false) })}
            >
              {reset.isPending ? 'Resetting…' : 'Reset to default'}
            </button>
          )}
          {save.isError && <p role="alert">{save.error.message}</p>}
          {reset.isError && <p role="alert">{reset.error.message}</p>}
        </>
      )}
    </section>
  );
}
