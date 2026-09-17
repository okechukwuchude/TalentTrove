/**
 * Two-letter country codes Adzuna's API supports. Used to constrain the
 * `/profile` country picker and validate `PUT /api/user-preferences` --
 * Adzuna is the stricter of the two per-user-driven adapters (JSearch's
 * `country` param accepts a broader set), so this list is the shared cap
 * for both.
 */
export const ADZUNA_COUNTRIES: readonly string[] = [
  'at',
  'au',
  'br',
  'ca',
  'de',
  'es',
  'fr',
  'gb',
  'in',
  'it',
  'mx',
  'nl',
  'nz',
  'pl',
  'sg',
  'us',
  'za',
];
