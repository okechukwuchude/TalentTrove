/**
 * `SETTINGS_ADMIN_EMAILS` restricts who can view/edit `/settings` (which
 * writes instance-wide ingestion credentials shared by every account, not
 * per-user data). Unset or empty means today's original behavior: any
 * signed-in account. This is deliberately additive/optional — no existing
 * deployment breaks by not setting it.
 */
export function isSettingsAdmin(email: string): boolean {
  const raw = process.env.SETTINGS_ADMIN_EMAILS;
  const allowlist = raw
    ?.split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (!allowlist || allowlist.length === 0) return true;
  return allowlist.includes(email.toLowerCase());
}
