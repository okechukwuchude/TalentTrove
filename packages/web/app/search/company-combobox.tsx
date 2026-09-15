'use client';

import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useCompanies, type Company } from '../../lib/search-queries.ts';
import { Input } from '../../components/ui/input.tsx';
import { Badge } from '../../components/ui/badge.tsx';

type SelectedCompany = { id: string; name: string };

export function CompanyCombobox({
  selected,
  onChange,
  idPrefix = '',
}: {
  selected: SelectedCompany[];
  onChange: (next: SelectedCompany[]) => void;
  idPrefix?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: suggestions } = useCompanies(query);

  useEffect(
    () => () => {
      if (blurTimeout.current) clearTimeout(blurTimeout.current);
    },
    [],
  );

  const availableSuggestions = (suggestions ?? []).filter(
    (company) => !selected.some((one) => one.id === company.id),
  );

  function add(company: Company): void {
    if (!selected.some((one) => one.id === company.id)) {
      onChange([...selected, { id: company.id, name: company.name }]);
    }
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
  }

  function remove(id: string): void {
    onChange(selected.filter((one) => one.id !== id));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((index) => Math.min(index + 1, availableSuggestions.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      const active = activeIndex >= 0 ? availableSuggestions[activeIndex] : undefined;
      if (open && active) {
        event.preventDefault();
        add(active);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  const activeOption = activeIndex >= 0 ? availableSuggestions[activeIndex] : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${idPrefix}company-search`} className="text-sm font-medium">
        Company
      </label>
      <div className="relative">
        <Input
          id={`${idPrefix}company-search`}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${idPrefix}company-listbox`}
          aria-autocomplete="list"
          aria-activedescendant={activeOption ? `${idPrefix}company-option-${activeOption.id}` : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            blurTimeout.current = setTimeout(() => setOpen(false), 100);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Type an employer name…"
          autoComplete="off"
        />
        {open && availableSuggestions.length > 0 && (
          <ul
            id={`${idPrefix}company-listbox`}
            role="listbox"
            className="absolute z-10 mt-1 w-full rounded-md border bg-card shadow-md"
          >
            {availableSuggestions.map((company, index) => (
              <li
                key={company.id}
                id={`${idPrefix}company-option-${company.id}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`cursor-pointer px-3 py-1.5 text-sm hover:bg-accent ${
                  index === activeIndex ? 'bg-accent' : ''
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => add(company)}
              >
                {company.name}
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
