export type Posting = {
  id: string;
  title: string;
  company: string;
  locations?: string[];
  workplace?: string;
  employment?: string;
  posted_at?: string | null;
  url: string;
  strength?: number;
  item_id?: string;
  verdict?: string;
  verdict_reasoning?: string;
};

export function asPosting(row: Record<string, unknown>): Posting {
  return {
    id: String(row['id'] ?? ''),
    title: String(row['title'] ?? ''),
    company: String(row['company'] ?? ''),
    locations: Array.isArray(row['locations']) ? (row['locations'] as string[]) : undefined,
    workplace: typeof row['workplace'] === 'string' ? row['workplace'] : undefined,
    employment: typeof row['employment'] === 'string' ? row['employment'] : undefined,
    posted_at: typeof row['posted_at'] === 'string' ? row['posted_at'] : null,
    url: String(row['url'] ?? ''),
    strength: typeof row['strength'] === 'number' ? row['strength'] : undefined,
    item_id: typeof row['item_id'] === 'string' ? row['item_id'] : undefined,
    verdict: typeof row['verdict'] === 'string' ? row['verdict'] : undefined,
    verdict_reasoning: typeof row['verdict_reasoning'] === 'string' ? row['verdict_reasoning'] : undefined,
  };
}
