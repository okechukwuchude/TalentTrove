import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export type UserPreferences = { roles: string[]; countries: string[] };

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = init ? await fetch(input, init) : await fetch(input);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error((data as { error?: string }).error ?? 'request failed');
  return data;
}

export function useUserPreferences() {
  return useQuery({
    queryKey: ['user-preferences'],
    queryFn: () => fetchJson<UserPreferences>('/api/user-preferences'),
  });
}

export function useUpdateUserPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UserPreferences) =>
      fetchJson<UserPreferences>('/api/user-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user-preferences'] }),
  });
}
