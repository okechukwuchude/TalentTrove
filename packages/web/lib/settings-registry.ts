export type SettingKey =
  | 'jsearch_api_key'
  | 'adzuna_app_id'
  | 'adzuna_app_key'
  | 'greenhouse_companies'
  | 'lever_companies'
  | 'ashby_companies';

export type SettingConfig = { key: SettingKey; envVar: string; secret: boolean; label: string };

export const SETTINGS: SettingConfig[] = [
  { key: 'jsearch_api_key', envVar: 'JSEARCH_API_KEY', secret: true, label: 'JSearch API key' },
  { key: 'adzuna_app_id', envVar: 'ADZUNA_APP_ID', secret: true, label: 'Adzuna app ID' },
  { key: 'adzuna_app_key', envVar: 'ADZUNA_APP_KEY', secret: true, label: 'Adzuna app key' },
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

export type SettingItem = { key: SettingKey; label: string; secret: boolean; value: string | null; isSet: boolean };
