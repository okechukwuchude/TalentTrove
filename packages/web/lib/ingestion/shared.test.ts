import { describe, expect, it } from 'vitest';
import { countryFromLocation, parseCompanyList } from './shared.ts';

describe('parseCompanyList', () => {
  it('parses token:displayName pairs, defaulting the display name to the token', () => {
    expect(parseCompanyList('stripe:Stripe, figma')).toEqual([
      { token: 'stripe', displayName: 'Stripe' },
      { token: 'figma', displayName: 'figma' },
    ]);
  });

  it('returns an empty list when unset', () => {
    expect(parseCompanyList(undefined)).toEqual([]);
  });
});

describe('countryFromLocation', () => {
  it('takes the last comma-separated segment as the country', () => {
    expect(countryFromLocation('San Francisco, CA, United States')).toBe('United States');
  });

  it('returns null for a missing location', () => {
    expect(countryFromLocation(undefined)).toBeNull();
    expect(countryFromLocation(null)).toBeNull();
  });
});
