import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './route.ts';

describe('GET /api/cron/tailor-resumes', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret';
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.JUDGE_MODEL;
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('returns 401 with no Authorization header', async () => {
    const response = await GET(new Request('http://localhost/api/cron/tailor-resumes'));
    expect(response.status).toBe(401);
  });

  it('returns 401 with a shorter wrong secret', async () => {
    const response = await GET(
      new Request('http://localhost/api/cron/tailor-resumes', { headers: { authorization: 'Bearer wrong' } }),
    );
    expect(response.status).toBe(401);
  });

  it('returns 401 with an equal-length wrong secret', async () => {
    const response = await GET(
      new Request('http://localhost/api/cron/tailor-resumes', {
        headers: { authorization: 'Bearer wrong-secret-16!' },
      }),
    );
    expect(response.status).toBe(401);
  });

  it('returns 200 and an empty summary with the correct secret', async () => {
    const response = await GET(
      new Request('http://localhost/api/cron/tailor-resumes', {
        headers: { authorization: 'Bearer test-cron-secret' },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rows: [] });
  });
});
