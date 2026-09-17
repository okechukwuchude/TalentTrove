import { getUserPreferences, setUserPreferences } from '../../../lib/user-preferences-db.ts';
import { requireSession } from '../../../lib/require-session.ts';
import { ADZUNA_COUNTRIES } from '../../../lib/ingestion/adzuna-countries.ts';

const MAX_ROLES = 5;
const MAX_COUNTRIES = 3;

export async function GET(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;

  const prefs = await getUserPreferences(auth.user.userId);
  return Response.json(prefs ?? { roles: [], countries: [] });
}

export async function PUT(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;

  const body = (await request.json().catch(() => null)) as { roles?: unknown; countries?: unknown } | null;
  if (!body || !Array.isArray(body.roles) || !Array.isArray(body.countries)) {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  const roles = body.roles.map((role) => (typeof role === 'string' ? role.trim() : '')).filter(Boolean);
  const countries = body.countries.map((country) => (typeof country === 'string' ? country.trim().toLowerCase() : ''));

  if (roles.length > MAX_ROLES) {
    return Response.json({ error: `at most ${MAX_ROLES} roles are allowed` }, { status: 400 });
  }
  if (countries.length > MAX_COUNTRIES) {
    return Response.json({ error: `at most ${MAX_COUNTRIES} countries are allowed` }, { status: 400 });
  }
  const unsupported = countries.find((country) => !ADZUNA_COUNTRIES.includes(country));
  if (unsupported) {
    return Response.json({ error: `"${unsupported}" is not a supported country code` }, { status: 400 });
  }

  await setUserPreferences(auth.user.userId, roles, countries);
  return Response.json({ roles, countries });
}
