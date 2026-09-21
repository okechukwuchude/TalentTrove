import { describe, expect, it } from 'vitest';
import { SETTINGS } from './settings-registry.ts';

describe('settings-registry', () => {
  it('has exactly the seven expected setting keys with correct secret flags', () => {
    const actual = [...SETTINGS].map((s) => ({ key: s.key, secret: s.secret })).sort((a, b) => a.key.localeCompare(b.key));
    expect(actual).toEqual([
      { key: 'adzuna_app_id', secret: true },
      { key: 'adzuna_app_key', secret: true },
      { key: 'ashby_companies', secret: false },
      { key: 'greenhouse_companies', secret: false },
      { key: 'jsearch_api_key', secret: true },
      { key: 'lever_companies', secret: false },
      { key: 'linkedin_api_key', secret: true },
    ]);
  });

  it('gives every setting a unique key', () => {
    const keys = SETTINGS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
