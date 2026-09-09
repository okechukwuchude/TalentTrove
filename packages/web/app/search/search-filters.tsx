'use client';

import { type FormEvent, useState } from 'react';
import type { SearchFilters as SearchFiltersValue } from '../../lib/search-queries.ts';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { CompanyCombobox } from './company-combobox.tsx';

const WORKPLACE_OPTIONS = ['remote', 'hybrid', 'onsite'];
const EMPLOYMENT_OPTIONS = ['full-time', 'part-time', 'contract', 'internship'];

export function SearchFilters({ onSearch }: { onSearch: (filters: SearchFiltersValue) => void }) {
  const [q, setQ] = useState('');
  const [country, setCountry] = useState('');
  const [workplace, setWorkplace] = useState('');
  const [employment, setEmployment] = useState('');
  const [postedAfter, setPostedAfter] = useState('');
  const [unjudged, setUnjudged] = useState(false);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    onSearch({
      q: q || undefined,
      country: country || undefined,
      workplace: workplace || undefined,
      employment: employment || undefined,
      postedAfter: postedAfter || undefined,
      company: companies.length > 0 ? companies.map((one) => one.id).join(',') : undefined,
      unjudged,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="search-words">Search words</Label>
        <Input
          id="search-words"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="e.g. staff engineer"
        />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="country">Country</Label>
          <Input id="country" value={country} onChange={(event) => setCountry(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="workplace">Workplace</Label>
          <select
            id="workplace"
            value={workplace}
            onChange={(event) => setWorkplace(event.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
          >
            <option value="">Any</option>
            {WORKPLACE_OPTIONS.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="employment">Employment</Label>
          <select
            id="employment"
            value={employment}
            onChange={(event) => setEmployment(event.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
          >
            <option value="">Any</option>
            {EMPLOYMENT_OPTIONS.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="posted-after">Posted after</Label>
          <Input
            id="posted-after"
            type="date"
            value={postedAfter}
            onChange={(event) => setPostedAfter(event.target.value)}
          />
        </div>
      </div>
      <CompanyCombobox selected={companies} onChange={setCompanies} />
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
