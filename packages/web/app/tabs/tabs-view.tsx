'use client';

import { type FormEvent, useState } from 'react';
import Link from 'next/link';
import { useCreateTab, useDeleteTab, useRenameTab, useTabs } from '../../lib/tab-queries.ts';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardHeader } from '../../components/ui/card.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';

function TabCard({ name, description, items }: { name: string; description?: string; items: number }) {
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(name);
  const rename = useRenameTab(name);
  const del = useDeleteTab(name);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          {renaming ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                rename.mutate(newName, { onSuccess: () => setRenaming(false) });
              }}
            >
              <Input
                aria-label={`Rename ${name}`}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
              <Button type="submit" size="sm" disabled={rename.isPending || newName.trim() === ''}>
                {rename.isPending ? 'Renaming…' : 'Save'}
              </Button>
            </form>
          ) : (
            <Link href={`/tabs/${encodeURIComponent(name)}`} className="font-semibold hover:underline">
              {name}
            </Link>
          )}
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
          <p className="text-sm text-muted-foreground">
            {items} posting{items === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex gap-2">
          {!renaming && (
            <Button type="button" variant="outline" size="sm" onClick={() => setRenaming(true)}>
              Rename
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" disabled={del.isPending} onClick={() => del.mutate()}>
            {del.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </CardHeader>
      {rename.isError && (
        <CardContent>
          <p role="alert" className="text-sm text-destructive">
            {rename.error.message}
          </p>
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

function NewTabForm() {
  const create = useCreateTab();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    create.mutate(
      { name, description: description || undefined },
      {
        onSuccess: () => {
          setName('');
          setDescription('');
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-tab-name">New tab name</Label>
        <Input id="new-tab-name" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-tab-description">Description (optional)</Label>
        <Input
          id="new-tab-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <Button type="submit" disabled={create.isPending || name.trim() === ''} className="self-start">
        {create.isPending ? 'Creating…' : 'New tab'}
      </Button>
      {create.isError && (
        <p role="alert" className="text-sm text-destructive">
          {create.error.message}
        </p>
      )}
    </form>
  );
}

export function TabsView() {
  const { data: tabs, isLoading, isError, error } = useTabs();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Tabs</h1>
      <NewTabForm />
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      {tabs && tabs.length === 0 && <p className="text-sm text-muted-foreground">This account has no tabs yet.</p>}
      {tabs && tabs.length > 0 && (
        <div className="flex flex-col gap-3">
          {tabs.map((tab) => (
            <TabCard key={tab.name} name={tab.name} description={tab.description} items={tab.items} />
          ))}
        </div>
      )}
    </div>
  );
}
