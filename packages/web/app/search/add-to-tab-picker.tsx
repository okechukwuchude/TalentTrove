'use client';

import { useState } from 'react';
import { useAddToTab, useCreateTab, useTabs } from '../../lib/tab-queries.ts';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';

export function AddToTabPicker({ postingId }: { postingId: string }) {
  const [open, setOpen] = useState(false);
  const [newTabName, setNewTabName] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const { data: tabs } = useTabs();
  const addToTab = useAddToTab();
  const createTab = useCreateTab();

  function addTo(name: string): void {
    addToTab.mutate(
      { name, ids: [postingId] },
      {
        onSuccess: () => {
          setFeedback(`Added to '${name}'`);
          setOpen(false);
        },
      },
    );
  }

  function createAndAdd(): void {
    const name = newTabName.trim();
    if (name === '') return;
    createTab.mutate(
      { name },
      {
        onSuccess: () => {
          setNewTabName('');
          addTo(name);
        },
      },
    );
  }

  return (
    <div className="relative">
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen((value) => !value)}>
        Add to tab
      </Button>
      {open && (
        <div className="absolute z-10 mt-1 w-56 rounded-md border bg-card p-2 shadow-md">
          {(tabs ?? []).map((tab) => (
            <button
              key={tab.name}
              type="button"
              className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
              disabled={addToTab.isPending}
              onClick={() => addTo(tab.name)}
            >
              {tab.name}
            </button>
          ))}
          <div className="mt-2 flex gap-1.5 border-t pt-2">
            <Input
              aria-label="New tab name"
              value={newTabName}
              onChange={(event) => setNewTabName(event.target.value)}
              placeholder="New tab…"
            />
            <Button
              type="button"
              size="sm"
              disabled={createTab.isPending || newTabName.trim() === ''}
              onClick={createAndAdd}
            >
              Add
            </Button>
          </div>
        </div>
      )}
      {feedback && (
        <p aria-live="polite" className="mt-1 text-xs text-muted-foreground">
          {feedback}
        </p>
      )}
      {(addToTab.isError || createTab.isError) && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {addToTab.error?.message ?? createTab.error?.message}
        </p>
      )}
    </div>
  );
}
