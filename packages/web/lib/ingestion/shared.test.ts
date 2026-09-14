import { describe, expect, it } from 'vitest';
import { countryFromLocation, normalizeCountry, parseCompanyList } from './shared.ts';

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

describe('normalizeCountry', () => {
  it('maps common abbreviations and codes to a canonical name', () => {
    expect(normalizeCountry('us')).toBe('United States');
    expect(normalizeCountry('US')).toBe('United States');
    expect(normalizeCountry('usa')).toBe('United States');
    expect(normalizeCountry('uk')).toBe('United Kingdom');
    expect(normalizeCountry('gb')).toBe('United Kingdom');
  });

  it('strips a trailing "- Remote"/"(Remote)" suffix some ATSs append to the country segment', () => {
    expect(normalizeCountry('United States - Remote')).toBe('United States');
    expect(normalizeCountry('Germany (Remote)')).toBe('Germany');
  });

  it('returns null for a value that is not plausibly a country, not the value itself', () => {
    expect(normalizeCountry('Remote')).toBeNull();
    expect(normalizeCountry('Anywhere')).toBeNull();
  });

  it('returns null for a missing value', () => {
    expect(normalizeCountry(undefined)).toBeNull();
    expect(normalizeCountry(null)).toBeNull();
    expect(normalizeCountry('')).toBeNull();
  });

  it('passes an unrecognized value through unchanged rather than guessing', () => {
    expect(normalizeCountry('Elbonia')).toBe('Elbonia');
  });
});
