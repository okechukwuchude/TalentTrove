import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './route.ts';

const ADAPTER_ENV_VARS = [
  'JSEARCH_API_KEY',
  'JSEARCH_QUERIES',
  'ADZUNA_APP_ID',
  'ADZUNA_APP_KEY',
  'ADZUNA_COUNTRIES',
  'ADZUNA_QUERIES',
  'GREENHOUSE_COMPANIES',
  'LEVER_COMPANIES',
  'ASHBY_COMPANIES',
];

describe('POST /api/cron/ingest-postings', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret';
    for (const name of ADAPTER_ENV_VARS) delete process.env[name];
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('returns 401 with no Authorization header', async () => {
    const response = await POST(new Request('http://localhost/api/cron/ingest-postings', { method: 'POST' }));
    expect(response.status).toBe(401);
  });

  it('returns 401 with the wrong secret', async () => {
    const response = await POST(
      new Request('http://localhost/api/cron/ingest-postings', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong-secret' },
      }),
    );
    expect(response.status).toBe(401);
  });

  it('returns 200 and an ingestion summary with the correct secret', async () => {
    const response = await POST(
      new Request('http://localhost/api/cron/ingest-postings', {
        method: 'POST',
        headers: { authorization: 'Bearer test-cron-secret' },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rows).toHaveLength(5);
    expect(body.rows.every((row: { fetched: number }) => row.fetched === 0)).toBe(true);
  });
});
