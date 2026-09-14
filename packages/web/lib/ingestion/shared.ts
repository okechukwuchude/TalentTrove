/** Parses "token:Display Name, token2:Display Name 2" env-var lists shared by the Greenhouse/Lever/Ashby adapters. */
export function parseCompanyList(raw: string | undefined): { token: string; displayName: string }[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [token, displayName] = entry.split(':');
      return { token: token!.trim(), displayName: (displayName ?? token!).trim() };
    });
}

/** A crude but explicit heuristic: the last comma-separated segment of a "City, State, Country"-shaped location string. */
export function countryFromLocation(location: string | undefined | null): string | null {
  if (!location) return null;
  const parts = location
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : null;
}

/**
 * Abbreviations/codes seen across sources, mapped to the one canonical
 * spelling this app stores and filters on. Adzuna sends a lowercase ISO-2
 * code directly; JSearch sends an uppercase ISO-2 code; Greenhouse/Lever/
 * Ashby (via `countryFromLocation`) sometimes produce one of these too when
 * a job's location string is itself abbreviated.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  us: 'United States',
  usa: 'United States',
  'u.s.': 'United States',
  'u.s.a.': 'United States',
  'united states of america': 'United States',
  uk: 'United Kingdom',
  'u.k.': 'United Kingdom',
  gb: 'United Kingdom',
  ca: 'Canada',
  au: 'Australia',
  de: 'Germany',
  fr: 'France',
  ie: 'Ireland',
  sg: 'Singapore',
  jp: 'Japan',
  nz: 'New Zealand',
  pl: 'Poland',
  il: 'Israel',
};

/** Values that turn up in the same field as a country but aren't one. */
const NON_COUNTRY_VALUES = new Set(['remote', 'anywhere', 'hybrid', 'onsite', 'various locations', 'multiple locations']);

/**
 * Normalizes a country-ish string from any ingestion source into one
 * canonical spelling, or `null` when the value isn't confidently a country.
 * Every adapter's `country` field is routed through this — before it, the
 * same country reached `postings.country` under up to five different
 * spellings (`'US'`, `'United States'`, `'USA'`, `'United States - Remote'`,
 * a bare `'Remote'`), which made the `country` search filter quietly wrong
 * in both directions (a search for "us" matching Australia; a search for
 * "United States" missing JSearch's `'US'` rows). `postings-search.ts`
 * routes an incoming filter value through this same function before
 * comparing, so the two sides always speak the same canonical spelling.
 *
 * This does not attempt to detect a bare city name with no country segment
 * at all (e.g. a Greenhouse location of just `"San Francisco"`, which
 * `countryFromLocation` has no way to distinguish from a country) — that
 * needs a real gazetteer, not a heuristic, and is left as a known gap
 * rather than guessed at.
 */
export function normalizeCountry(raw: string | undefined | null): string | null {
  if (!raw) return null;
  // Greenhouse in particular appends "- Remote" / "(Remote)" to what is
  // otherwise a real country name for remote roles (e.g.
  // "United States - Remote"); strip that before evaluating what's left.
  const stripped = raw.replace(/[\s-]*\(?remote\)?\s*$/i, '').trim();
  if (!stripped) return null;
  const lower = stripped.toLowerCase();
  if (NON_COUNTRY_VALUES.has(lower)) return null;
  return COUNTRY_ALIASES[lower] ?? stripped;
}
