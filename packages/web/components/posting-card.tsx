import type { ReactNode } from 'react';
import { Badge } from './ui/badge.tsx';
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
      </CardContent>
    </Card>
  );
}
