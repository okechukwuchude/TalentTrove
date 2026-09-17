'use client';

import { useUserPreferences } from '../../lib/user-preferences-queries.ts';
import { useUserPreferencesSearch } from '../../lib/user-preferences-search.ts';
import { PostingList } from '../../components/posting-list.tsx';
import { AddToTabPicker } from '../search/add-to-tab-picker.tsx';

export function RolePreferencesResults() {
  const { data } = useUserPreferences();
  const roles = data?.roles ?? [];
  const countries = data?.countries ?? [];
  const search = useUserPreferencesSearch(roles, countries);

  if (roles.length === 0 || countries.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Matching postings</h2>
      <PostingList
        postings={search.rows}
        isLoading={search.isLoading}
        isError={search.isError}
        error={search.error}
        emptyMessage="No postings matched your saved roles and countries yet."
        renderActions={(posting) => <AddToTabPicker postingId={posting.id} />}
      />
    </div>
  );
}
