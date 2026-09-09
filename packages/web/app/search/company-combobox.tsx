'use client';

import { useState } from 'react';
import { useCompanies, type Company } from '../../lib/search-queries.ts';
import { Input } from '../../components/ui/input.tsx';
import { Badge } from '../../components/ui/badge.tsx';

type SelectedCompany = { id: string; name: string };

export function CompanyCombobox({
  selected,
  onChange,
}: {
  selected: SelectedCompany[];
  onChange: (next: SelectedCompany[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const { data: suggestions } = useCompanies(query);

  function add(company: Company): void {
    if (!selected.some((one) => one.id === company.id)) {
      onChange([...selected, { id: company.id, name: company.name }]);
    }
    setQuery('');
    setOpen(false);
  }

  function remove(id: string): void {
    onChange(selected.filter((one) => one.id !== id));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="company-search" className="text-sm font-medium">
        Company
      </label>
      <div className="relative">
        <Input
          id="company-search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 100)}
          placeholder="Type an employer name…"
          autoComplete="off"
        />
        {open && suggestions && suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded-md border bg-card shadow-md">
            {suggestions.map((company) => (
              <li key={company.id}>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => add(company)}
                >
                  {company.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((company) => (
            <Badge key={company.id} variant="secondary" className="gap-1">
              {company.name}
              <button type="button" aria-label={`Remove ${company.name}`} onClick={() => remove(company.id)}>
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
