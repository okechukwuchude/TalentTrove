'use client';

import type { ReactNode } from 'react';
import { Badge } from './ui/badge.tsx';
import { Button } from './ui/button.tsx';
import { Card, CardContent, CardHeader } from './ui/card.tsx';
import type { Posting } from '../lib/posting.ts';

export function PostingCard({ posting, actions }: { posting: Posting; actions?: ReactNode }) {
  const location = posting.locations?.[0];
  const postedDate = posting.posted_at ? posting.posted_at.slice(0, 10) : undefined;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <a href={posting.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
            {posting.title}
          </a>
          <p className="text-sm text-muted-foreground">{posting.company}</p>
        </div>
        {typeof posting.strength === 'number' && (
          <Badge variant="secondary">match {posting.strength.toFixed(2)}</Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {location && <span>{location}</span>}
        {posting.workplace && <Badge variant="outline">{posting.workplace}</Badge>}
        {posting.employment && <Badge variant="outline">{posting.employment}</Badge>}
        {postedDate && <span>posted {postedDate}</span>}
        {actions && <div className="ml-auto flex gap-2">{actions}</div>}
        {posting.verdict && (
          <div className="basis-full">
            <Badge variant="outline">{posting.verdict}</Badge>
            {posting.verdict_reasoning && (
              <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{posting.verdict_reasoning}</p>
            )}
          </div>
        )}
        {posting.has_tailored_resume && (
          <a
            href={`/api/tailored-resumes/${posting.id}`}
            className="basis-full text-sm font-medium text-primary hover:underline"
          >
            Download tailored resume
          </a>
        )}
        {posting.cover_letter && (
          <div className="basis-full">
            <p className="text-sm font-medium">Cover letter</p>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{posting.cover_letter}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1"
              onClick={() => {
                // navigator.clipboard is unavailable in some contexts (non-HTTPS
                // origins, some test/embedded environments) — no-op rather than
                // throw; there is no polyfill for this.
                navigator.clipboard?.writeText(posting.cover_letter ?? '').catch(() => {});
              }}
            >
              Copy
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
