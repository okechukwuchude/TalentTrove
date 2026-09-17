'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { ADZUNA_COUNTRIES } from '../../lib/ingestion/adzuna-countries.ts';
import { useUpdateUserPreferences, useUserPreferences } from '../../lib/user-preferences-queries.ts';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent, CardHeader } from '../../components/ui/card.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';

const MAX_ROLES = 5;
const MAX_COUNTRIES = 3;

export function RolePreferencesCard() {
  const { data, isLoading, isError, error } = useUserPreferences();
  const update = useUpdateUserPreferences();
  const [roles, setRoles] = useState<string[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [roleDraft, setRoleDraft] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched && data) {
      setRoles(data.roles ?? []);
      setCountries(data.countries ?? []);
    }
  }, [data, touched]);

  function addRole(event: FormEvent): void {
    event.preventDefault();
    const value = roleDraft.trim();
    if (!value || roles.length >= MAX_ROLES || roles.includes(value)) return;
    setRoles([...roles, value]);
    setRoleDraft('');
    setTouched(true);
  }

  function removeRole(role: string): void {
    setRoles(roles.filter((existing) => existing !== role));
    setTouched(true);
  }

  function toggleCountry(country: string): void {
    if (countries.includes(country)) {
      setCountries(countries.filter((existing) => existing !== country));
      setTouched(true);
    } else if (countries.length < MAX_COUNTRIES) {
      setCountries([...countries, country]);
      setTouched(true);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold">Roles &amp; countries</h2>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="role-draft">
                Roles ({roles.length}/{MAX_ROLES})
              </Label>
              <div className="flex flex-wrap gap-2">
                {roles.map((role) => (
                  <Badge key={role} variant="secondary" className="gap-1">
                    <span>{role}</span>
                    <button type="button" aria-label={`Remove ${role}`} onClick={() => removeRole(role)} className="ml-1">
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
              <form onSubmit={addRole} className="flex gap-2">
                <Input
                  id="role-draft"
                  value={roleDraft}
                  onChange={(event) => setRoleDraft(event.target.value)}
                  placeholder="e.g. senior backend engineer"
                  disabled={roles.length >= MAX_ROLES}
                />
                <Button type="submit" variant="outline" disabled={roles.length >= MAX_ROLES || !roleDraft.trim()}>
                  Add
                </Button>
              </form>
            </div>
            <div className="flex flex-col gap-2">
              <Label>
                Countries ({countries.length}/{MAX_COUNTRIES})
              </Label>
              <div className="flex flex-wrap gap-2">
                {ADZUNA_COUNTRIES.map((country) => {
                  const selected = countries.includes(country);
                  return (
                    <button
                      key={country}
                      type="button"
                      onClick={() => toggleCountry(country)}
                      disabled={!selected && countries.length >= MAX_COUNTRIES}
                      aria-pressed={selected}
                    >
                      <Badge variant={selected ? 'default' : 'outline'}>{country.toUpperCase()}</Badge>
                    </button>
                  );
                })}
              </div>
            </div>
            <Button
              type="button"
              disabled={update.isPending}
              onClick={() => update.mutate({ roles, countries }, { onSuccess: () => setTouched(false) })}
              className="self-start"
            >
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
            {update.isError && (
              <p role="alert" className="text-sm text-destructive">
                {update.error.message}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
