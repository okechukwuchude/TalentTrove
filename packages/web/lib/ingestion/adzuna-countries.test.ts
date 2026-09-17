import { describe, expect, it } from 'vitest';
import { ADZUNA_COUNTRIES } from './adzuna-countries.ts';

describe('ADZUNA_COUNTRIES', () => {
  it('is non-empty and every entry is a lowercase two-letter code', () => {
    expect(ADZUNA_COUNTRIES.length).toBeGreaterThan(0);
    for (const code of ADZUNA_COUNTRIES) {
      expect(code).toMatch(/^[a-z]{2}$/);
    }
  });

  it('has no duplicate entries', () => {
    expect(new Set(ADZUNA_COUNTRIES).size).toBe(ADZUNA_COUNTRIES.length);
  });
});
