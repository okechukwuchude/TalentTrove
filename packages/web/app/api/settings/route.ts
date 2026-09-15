import { clearSetting, getSecretSetting, getSetting, setSecretSetting, setSetting } from '../../../lib/settings-db.ts';
import { requireSession } from '../../../lib/require-session.ts';

type SettingConfig = { key: string; envVar?: string; secret: boolean; label: string };

const SETTINGS: SettingConfig[] = [
  { key: 'jsearch_api_key', envVar: 'JSEARCH_API_KEY', secret: true, label: 'JSearch API key' },
  { key: 'jsearch_queries', envVar: 'JSEARCH_QUERIES', secret: false, label: 'JSearch search queries (comma-separated)' },
  { key: 'jsearch_country', envVar: 'JSEARCH_COUNTRY', secret: false, label: 'JSearch country code (e.g. us)' },
  { key: 'adzuna_app_id', envVar: 'ADZUNA_APP_ID', secret: true, label: 'Adzuna app ID' },
  { key: 'adzuna_app_key', envVar: 'ADZUNA_APP_KEY', secret: true, label: 'Adzuna app key' },
  { key: 'adzuna_countries', envVar: 'ADZUNA_COUNTRIES', secret: false, label: 'Adzuna country codes (comma-separated)' },
  { key: 'adzuna_queries', envVar: 'ADZUNA_QUERIES', secret: false, label: 'Adzuna search queries (comma-separated)' },
  {
    key: 'greenhouse_companies',
    envVar: 'GREENHOUSE_COMPANIES',
    secret: false,
    label: 'Greenhouse companies (token:Display Name, comma-separated)',
  },
  {
    key: 'lever_companies',
    envVar: 'LEVER_COMPANIES',
    secret: false,
    label: 'Lever companies (token:Display Name, comma-separated)',
  },
  {
    key: 'ashby_companies',
    envVar: 'ASHBY_COMPANIES',
    secret: false,
    label: 'Ashby companies (token:Display Name, comma-separated)',
  },
];

const SETTINGS_BY_KEY = new Map(SETTINGS.map((config) => [config.key, config]));

type SettingItem = { key: string; label: string; secret: boolean; value: string | null; isSet: boolean };

async function currentItem(config: SettingConfig): Promise<SettingItem> {
  const envFallback = config.envVar ? (process.env[config.envVar] ?? null) : null;
  if (config.secret) {
    const value = (await getSecretSetting(config.key)) ?? envFallback;
    return { key: config.key, label: config.label, secret: true, value: null, isSet: Boolean(value) };
  }
  const value = (await getSetting(config.key)) ?? envFallback;
  return { key: config.key, label: config.label, secret: false, value, isSet: Boolean(value) };
}

export async function GET(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;

  const items = await Promise.all(SETTINGS.map(currentItem));
  return Response.json({ items });
}

export async function PUT(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  for (const key of Object.keys(body)) {
    const config = SETTINGS_BY_KEY.get(key);
    if (!config) {
      return Response.json({ error: `unknown setting "${key}"` }, { status: 400 });
    }
    const value = body[key];
    if (typeof value !== 'string') {
      return Response.json({ error: `"${key}" must be a string` }, { status: 400 });
    }
    if (value === '') {
      await clearSetting(key);
    } else if (config.secret) {
      await setSecretSetting(key, value);
    } else {
      await setSetting(key, value);
    }
  }

  const items = await Promise.all(SETTINGS.map(currentItem));
  return Response.json({ items });
}
