'use client';

import { type FormEvent, useState } from 'react';
import type { SearchFilters as SearchFiltersValue } from '../../lib/search-queries.ts';
import { Button } from '../../components/ui/button.tsx';
import { EMPTY_FILTER_FIELDS, FilterFields } from './filter-fields.tsx';

export function SearchFilters({ onSearch }: { onSearch: (filters: SearchFiltersValue) => void }) {
  const [fields, setFields] = useState(EMPTY_FILTER_FIELDS);
  const [unjudged, setUnjudged] = useState(false);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    onSearch({
      q: fields.q || undefined,
      country: fields.country || undefined,
      workplace: fields.workplace || undefined,
      employment: fields.employment || undefined,
      postedAfter: fields.postedAfter || undefined,
      company: fields.companies.length > 0 ? fields.companies.map((one) => one.id).join(',') : undefined,
      unjudged,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <FilterFields value={fields} onChange={setFields} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={unjudged} onChange={(event) => setUnjudged(event.target.checked)} />
        Leave out postings I&rsquo;ve already judged
      </label>
      <Button type="submit" className="self-start">
        Search
      </Button>
    </form>
  );
}
