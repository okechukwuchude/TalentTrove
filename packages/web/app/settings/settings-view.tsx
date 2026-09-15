'use client';

import { type FormEvent, useId, useState } from 'react';
import { type SettingItem, useSettings, useUpdateSettings } from '../../lib/settings-queries.ts';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardHeader } from '../../components/ui/card.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';

const ADAPTER_LABELS: Record<string, string> = {
  jsearch: 'JSearch',
  adzuna: 'Adzuna',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
};

function adapterOf(key: string): string {
  return key.split('_')[0]!;
}

function groupByAdapter(items: SettingItem[]): [string, SettingItem[]][] {
  const groups = new Map<string, SettingItem[]>();
  for (const item of items) {
    const adapter = adapterOf(item.key);
    const list = groups.get(adapter) ?? [];
    list.push(item);
    groups.set(adapter, list);
  }
  return [...groups.entries()];
}

function AdapterSection({ adapter, items }: { adapter: string; items: SettingItem[] }) {
  const uid = useId();
  const update = useUpdateSettings();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.key, item.secret ? '' : (item.value ?? '')])),
  );
  const [touched, setTouched] = useState<Set<string>>(new Set());

  function handleChange(key: string, value: string): void {
    setValues((current) => ({ ...current, [key]: value }));
    setTouched((current) => new Set(current).add(key));
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const body = Object.fromEntries([...touched].map((key) => [key, values[key] ?? '']));
    if (Object.keys(body).length === 0) return;
    update.mutate(body, { onSuccess: () => setTouched(new Set()) });
  }

  return (
    <Card>
      <CardHeader>
        <span className="font-semibold">{ADAPTER_LABELS[adapter] ?? adapter}</span>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {items.map((item) => (
            <div key={item.key} className="flex flex-col gap-1.5">
              <Label htmlFor={`${uid}-${item.key}`}>{item.label}</Label>
              <Input
                id={`${uid}-${item.key}`}
                type={item.secret ? 'password' : 'text'}
                value={values[item.key] ?? ''}
                placeholder={item.secret ? (item.isSet ? 'Set — leave blank to keep' : 'Not set') : undefined}
                onChange={(event) => handleChange(item.key, event.target.value)}
              />
              {item.secret && <p className="text-xs text-muted-foreground">{item.isSet ? 'Currently set' : 'Not set'}</p>}
            </div>
          ))}
          <Button type="submit" disabled={update.isPending || touched.size === 0} className="self-start">
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
          {update.isError && (
            <p role="alert" className="text-sm text-destructive">
              {update.error.message}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

export function SettingsView() {
  const { data: items, isLoading, isError, error } = useSettings();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Ingestion settings</h1>
      <p className="text-sm text-muted-foreground">
        These settings are shared instance-wide, not per account — postings ingestion runs once for everyone. A saved
        value here overrides the matching environment variable; clearing a field (Save with it blank) reverts to the
        environment variable, if any.
      </p>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      {items && (
        <div className="flex flex-col gap-3">
          {groupByAdapter(items).map(([adapter, adapterItems]) => (
            <AdapterSection key={adapter} adapter={adapter} items={adapterItems} />
          ))}
        </div>
      )}
    </div>
  );
}
