'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// The shape filters come back AS (GET /api/routines returns RoutineSummary.filters,
// i.e. RoutineFilters from postings-search.ts — company is a string[], the same
// shape stored in the jsonb column — NOT the comma-joined string the API accepts
// on write. Do not conflate the two; see toBody() below for the write-side shape.
export type RoutineFiltersOutput = {
  q?: string;
  country?: string;
  workplace?: string;
  employment?: string;
  postedAfter?: string;
  company?: string[];
};

export type Routine = {
  name: string;
  filters: RoutineFiltersOutput;
  judgePrompt: string | null;
  destinationTab: string | null;
};

export type RoutineInput = {
  name?: string;
  q?: string;
  country?: string;
  workplace?: string;
  employment?: string;
  postedAfter?: string;
  company?: string;
  judgePrompt?: string;
  destinationTab?: string;
};

type RoutinesResponse = { rows: Record<string, unknown>[] };

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = init ? await fetch(input, init) : await fetch(input);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error((data as { error?: string }).error ?? 'request failed');
  return data;
}

function asRoutine(row: Record<string, unknown>): Routine {
  return {
    name: String(row['name'] ?? ''),
    filters: (row['filters'] as RoutineFiltersOutput) ?? {},
    judgePrompt: typeof row['judge_prompt'] === 'string' ? row['judge_prompt'] : null,
    destinationTab: typeof row['destination_tab'] === 'string' ? row['destination_tab'] : null,
  };
}

function toBody(input: RoutineInput): Record<string, string> {
  const body: Record<string, string> = {};
  if (input.name !== undefined) body['name'] = input.name;
  if (input.q) body['q'] = input.q;
  if (input.country) body['country'] = input.country;
  if (input.workplace) body['workplace'] = input.workplace;
  if (input.employment) body['employment'] = input.employment;
  if (input.postedAfter) body['posted_after'] = input.postedAfter;
  if (input.company) body['company'] = input.company;
  if (input.judgePrompt) body['judge_prompt'] = input.judgePrompt;
  if (input.destinationTab) body['destination_tab'] = input.destinationTab;
  return body;
}

export function useRoutines() {
  return useQuery({
    queryKey: ['routines'],
    queryFn: () => fetchJson<RoutinesResponse>('/api/routines').then((data) => data.rows.map(asRoutine)),
  });
}

export function useCreateRoutine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RoutineInput) =>
      fetchJson('/api/routines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toBody(input)),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['routines'] }),
  });
}

export function useUpdateRoutine(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RoutineInput) =>
      fetchJson(`/api/routines/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toBody(input)),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['routines'] }),
  });
}

export function useDeleteRoutine(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson(`/api/routines/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['routines'] }),
  });
}
