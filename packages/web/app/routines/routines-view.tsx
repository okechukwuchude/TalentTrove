'use client';

import { type FormEvent, useState } from 'react';
import {
  type Routine,
  useCreateRoutine,
  useDeleteRoutine,
  useRoutines,
  useUpdateRoutine,
} from '../../lib/routine-queries.ts';
import { EMPTY_FILTER_FIELDS, FilterFields, type FilterFieldsValue } from '../search/filter-fields.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardHeader } from '../../components/ui/card.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';

function summarizeFilter(filters: Routine['filters']): string {
  const parts: string[] = [];
  if (filters.q) parts.push(`q: ${filters.q}`);
  if (filters.country) parts.push(`country: ${filters.country}`);
  if (filters.workplace) parts.push(`workplace: ${filters.workplace}`);
  if (filters.employment) parts.push(`employment: ${filters.employment}`);
  if (filters.postedAfter) parts.push(`posted after: ${filters.postedAfter}`);
  if (filters.company && filters.company.length > 0) parts.push(`company: ${filters.company.join(', ')}`);
  return parts.length > 0 ? parts.join(', ') : 'no filters (matches every posting)';
}

function fieldsFromRoutine(routine: Routine): FilterFieldsValue {
  return {
    q: routine.filters.q ?? '',
    country: routine.filters.country ?? '',
    workplace: routine.filters.workplace ?? '',
    employment: routine.filters.employment ?? '',
    postedAfter: routine.filters.postedAfter ?? '',
    // Company ids/names are identical strings in this app (searchCompanies
    // returns {id: company.name, name: company.name} — see postings-search.ts)
    // so a stored filter's company array round-trips into CompanyCombobox's
    // {id, name} shape directly, with no separate id lookup needed.
    companies: (routine.filters.company ?? []).map((name) => ({ id: name, name })),
  };
}

function RoutineCard({ routine }: { routine: Routine }) {
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<FilterFieldsValue>(() => fieldsFromRoutine(routine));
  const [judgePrompt, setJudgePrompt] = useState(routine.judgePrompt ?? '');
  const [destinationTab, setDestinationTab] = useState(routine.destinationTab ?? '');
  const update = useUpdateRoutine(routine.name);
  const del = useDeleteRoutine(routine.name);

  function startEditing(): void {
    setFields(fieldsFromRoutine(routine));
    setJudgePrompt(routine.judgePrompt ?? '');
    setDestinationTab(routine.destinationTab ?? '');
    setEditing(true);
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    update.mutate(
      {
        q: fields.q || undefined,
        country: fields.country || undefined,
        workplace: fields.workplace || undefined,
        employment: fields.employment || undefined,
        postedAfter: fields.postedAfter || undefined,
        company: fields.companies.length > 0 ? fields.companies.map((one) => one.id).join(',') : undefined,
        judgePrompt: judgePrompt || undefined,
        destinationTab: destinationTab || undefined,
      },
      { onSuccess: () => setEditing(false) },
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="flex flex-col gap-1">
          <span className="font-semibold">{routine.name}</span>
          <p className="text-sm text-muted-foreground">{summarizeFilter(routine.filters)}</p>
          {routine.judgePrompt && (
            <p className="text-sm text-muted-foreground">prompt: {routine.judgePrompt.slice(0, 80)}{routine.judgePrompt.length > 80 ? '…' : ''}</p>
          )}
          {routine.destinationTab && <p className="text-sm text-muted-foreground">files into: {routine.destinationTab}</p>}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={startEditing}>
            Edit
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={del.isPending} onClick={() => del.mutate()}>
            {del.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </CardHeader>
      {editing && (
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <FilterFields value={fields} onChange={setFields} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`judge-prompt-${routine.name}`}>Judge prompt (optional)</Label>
              <Textarea id={`judge-prompt-${routine.name}`} value={judgePrompt} onChange={(event) => setJudgePrompt(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`destination-tab-${routine.name}`}>File strong/fair matches into tab (optional)</Label>
              <Input
                id={`destination-tab-${routine.name}`}
                value={destinationTab}
                onChange={(event) => setDestinationTab(event.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={update.isPending} className="self-start">
                {update.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
            {update.isError && (
              <p role="alert" className="text-sm text-destructive">
                {update.error.message}
              </p>
            )}
          </form>
        </CardContent>
      )}
      {del.isError && (
        <CardContent>
          <p role="alert" className="text-sm text-destructive">
            {del.error.message}
          </p>
        </CardContent>
      )}
    </Card>
  );
}

function NewRoutineForm() {
  const create = useCreateRoutine();
  const [name, setName] = useState('');
  const [fields, setFields] = useState<FilterFieldsValue>(EMPTY_FILTER_FIELDS);
  const [judgePrompt, setJudgePrompt] = useState('');
  const [destinationTab, setDestinationTab] = useState('');

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    create.mutate(
      {
        name,
        q: fields.q || undefined,
        country: fields.country || undefined,
        workplace: fields.workplace || undefined,
        employment: fields.employment || undefined,
        postedAfter: fields.postedAfter || undefined,
        company: fields.companies.length > 0 ? fields.companies.map((one) => one.id).join(',') : undefined,
        judgePrompt: judgePrompt || undefined,
        destinationTab: destinationTab || undefined,
      },
      {
        onSuccess: () => {
          setName('');
          setFields(EMPTY_FILTER_FIELDS);
          setJudgePrompt('');
          setDestinationTab('');
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-routine-name">New routine name</Label>
        <Input id="new-routine-name" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <FilterFields value={fields} onChange={setFields} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-routine-judge-prompt">Judge prompt (optional — defaults to the standard judge prompt)</Label>
        <Textarea id="new-routine-judge-prompt" value={judgePrompt} onChange={(event) => setJudgePrompt(event.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-routine-destination-tab">File strong/fair matches into tab (optional)</Label>
        <Input id="new-routine-destination-tab" value={destinationTab} onChange={(event) => setDestinationTab(event.target.value)} />
      </div>
      <Button type="submit" disabled={create.isPending || name.trim() === ''} className="self-start">
        {create.isPending ? 'Creating…' : 'New routine'}
      </Button>
      {create.isError && (
        <p role="alert" className="text-sm text-destructive">
          {create.error.message}
        </p>
      )}
    </form>
  );
}

export function RoutinesView() {
  const { data: routines, isLoading, isError, error } = useRoutines();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Routines</h1>
      <p className="text-sm text-muted-foreground">
        Once you have at least one routine, judge stops sweeping every unjudged posting and instead only judges
        postings matching your routines, using each routine&rsquo;s own prompt.
      </p>
      <NewRoutineForm />
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      {routines && routines.length === 0 && <p className="text-sm text-muted-foreground">This account has no routines yet.</p>}
      {routines && routines.length > 0 && (
        <div className="flex flex-col gap-3">
          {routines.map((routine) => (
            <RoutineCard key={routine.name} routine={routine} />
          ))}
        </div>
      )}
    </div>
  );
}
