import { describe, expect, it } from 'vitest';
import { POST } from './route.ts';

describe('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    const response = await POST();
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
