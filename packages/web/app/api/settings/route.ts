import { clearSetting, getSetting, setSecretSetting, setSetting } from '../../../lib/settings-db.ts';
import { requireSession } from '../../../lib/require-session.ts';
import { SETTINGS, type SettingConfig, type SettingItem, type SettingKey } from '../../../lib/settings-registry.ts';

const SETTINGS_BY_KEY = new Map(SETTINGS.map((config) => [config.key, config]));

async function currentItem(config: SettingConfig): Promise<SettingItem> {
  const envFallback = process.env[config.envVar] ?? null;
  if (config.secret) {
    const stored = await getSetting(config.key);
    return { key: config.key, label: config.label, secret: true, value: null, isSet: Boolean(stored ?? envFallback) };
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
    const config = SETTINGS_BY_KEY.get(key as SettingKey);
    if (!config) {
      return Response.json({ error: `unknown setting "${key}"` }, { status: 400 });
    }
    const value = body[key];
    if (typeof value !== 'string') {
      return Response.json({ error: `"${key}" must be a string` }, { status: 400 });
    }
    if (value === '') {
      await clearSetting(config.key);
    } else if (config.secret) {
      await setSecretSetting(config.key, value);
    } else {
      await setSetting(config.key, value);
    }
  }

  const items = await Promise.all(SETTINGS.map(currentItem));
  return Response.json({ items });
}
