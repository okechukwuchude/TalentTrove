'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SettingItem } from './settings-registry.ts';

export type { SettingItem } from './settings-registry.ts';

type SettingsResponse = { items: SettingItem[] };

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = init ? await fetch(input, init) : await fetch(input);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error((data as { error?: string }).error ?? 'request failed');
  return data;
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => fetchJson<SettingsResponse>('/api/settings').then((data) => data.items),
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, string>) =>
      fetchJson<SettingsResponse>('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });
}
