'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export type ProfileDocumentSummary = {
  name: string;
  kind: 'text' | 'file';
  bytes: number;
  updated_at?: string;
  original_filename?: string;
};

type ProfileDocumentDetail = {
  text?: string;
  stored?: boolean;
};

type ResumeUploadResult = {
  pages?: number;
  pages_read?: number;
  characters?: number;
  note?: string;
  bytes?: number;
};

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'request failed');
  return data;
}

export function useProfileDocuments() {
  return useQuery({
    queryKey: ['profile', 'documents'],
    queryFn: () => fetchJson<{ rows: ProfileDocumentSummary[] }>('/api/profile').then((data) => data.rows),
  });
}

export function useProfileDocumentText(name: string) {
  return useQuery({
    queryKey: ['profile', 'document', name, 'text'],
    queryFn: () => fetchJson<ProfileDocumentDetail>(`/api/profile/${name}`),
  });
}

export function useSaveTextDocument(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) =>
      fetchJson(`/api/profile/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useUploadResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      fetchJson<ResumeUploadResult>(`/api/profile/resume?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf' },
        body: file,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useResetToDefault(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson(`/api/profile/${name}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
