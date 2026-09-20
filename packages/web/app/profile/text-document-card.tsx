'use client';

import { useEffect, useState } from 'react';
import { useProfileDocumentText, useResetToDefault, useSaveTextDocument } from '../../lib/profile-queries.ts';
import { Button } from '../../components/ui/button.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { Card, CardContent, CardHeader } from '../../components/ui/card.tsx';

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
  const { data, isLoading, isError, error } = useProfileDocumentText(name);
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
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold">{label}</h2>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ) : (
          <>
            {usingDefault && (
              <p className="text-sm text-muted-foreground">
                Using the default TalentTrove ships. Edit below to store your own.
              </p>
            )}
            <Textarea
              aria-label={label}
              value={draft}
              onChange={(event) => {
                setTouched(true);
                setDraft(event.target.value);
              }}
              rows={6}
            />
            <p aria-live="polite" className="text-xs text-muted-foreground">
              {byteCount.toLocaleString('en-US')} / {perDocumentCap.toLocaleString('en-US')} bytes
              {overCap ? ' — over the per-document limit' : ''}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={save.isPending || overCap || draft === (data?.text ?? '')}
                onClick={() => save.mutate(draft, { onSuccess: () => setTouched(false) })}
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
              {resettable && !usingDefault && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={reset.isPending}
                  onClick={() => reset.mutate(undefined, { onSuccess: () => setTouched(false) })}
                >
                  {reset.isPending ? 'Resetting…' : 'Reset to default'}
                </Button>
              )}
            </div>
            {save.isError && (
              <p role="alert" className="text-sm text-destructive">
                {save.error.message}
              </p>
            )}
            {reset.isError && (
              <p role="alert" className="text-sm text-destructive">
                {reset.error.message}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
