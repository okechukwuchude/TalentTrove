'use client';

import { WHOLE_PROFILE_CAP } from '@pinloop/shared';
import { useProfileDocuments } from '../../lib/profile-queries.ts';

export function WholeProfileUsage() {
  const { data, isError, error } = useProfileDocuments();
  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error.message}
      </p>
    );
  }
  const textBytes = (data ?? [])
    .filter((document) => document.kind === 'text')
    .reduce((total, document) => total + document.bytes, 0);
  const overCap = textBytes > WHOLE_PROFILE_CAP;

  return (
    <p aria-live="polite" className="text-sm text-muted-foreground">
      {textBytes.toLocaleString('en-US')} / {WHOLE_PROFILE_CAP.toLocaleString('en-US')} bytes of text documents
      stored{overCap ? ' — over the whole-profile limit' : ''}
    </p>
  );
}
