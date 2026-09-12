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
