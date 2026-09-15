'use client';

import { useId } from 'react';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { CompanyCombobox } from './company-combobox.tsx';

const WORKPLACE_OPTIONS = ['remote', 'hybrid', 'onsite'];
const EMPLOYMENT_OPTIONS = ['full-time', 'part-time', 'contract', 'internship'];

export type FilterFieldsValue = {
  q: string;
  country: string;
  workplace: string;
  employment: string;
  postedAfter: string;
  companies: { id: string; name: string }[];
};

export const EMPTY_FILTER_FIELDS: FilterFieldsValue = {
  q: '',
  country: '',
  workplace: '',
  employment: '',
  postedAfter: '',
  companies: [],
};

export function FilterFields({
  value,
  onChange,
}: {
  value: FilterFieldsValue;
  onChange: (next: FilterFieldsValue) => void;
}) {
  const uid = useId();
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-search-words`}>Search words</Label>
        <Input
          id={`${uid}-search-words`}
          value={value.q}
          onChange={(event) => onChange({ ...value, q: event.target.value })}
          placeholder="e.g. staff engineer"
        />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-country`}>Country</Label>
          <Input
            id={`${uid}-country`}
            value={value.country}
            onChange={(event) => onChange({ ...value, country: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-workplace`}>Workplace</Label>
          <select
            id={`${uid}-workplace`}
            value={value.workplace}
            onChange={(event) => onChange({ ...value, workplace: event.target.value })}
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
          <Label htmlFor={`${uid}-employment`}>Employment</Label>
          <select
            id={`${uid}-employment`}
            value={value.employment}
            onChange={(event) => onChange({ ...value, employment: event.target.value })}
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
          <Label htmlFor={`${uid}-posted-after`}>Posted after</Label>
          <Input
            id={`${uid}-posted-after`}
            type="date"
            value={value.postedAfter}
            onChange={(event) => onChange({ ...value, postedAfter: event.target.value })}
          />
        </div>
      </div>
      <CompanyCombobox
        selected={value.companies}
        onChange={(companies) => onChange({ ...value, companies })}
        idPrefix={`${uid}-`}
      />
    </>
  );
}
