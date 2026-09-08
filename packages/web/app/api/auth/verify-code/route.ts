import { PinloopServerError, verifyEmailCode } from '../../../../lib/pinloop-server.ts';
import { sealSession, sessionCookieHeader } from '../../../../lib/session.ts';

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { email?: unknown; code?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (email === '' || code === '') {
    return Response.json({ error: 'enter your email and the code that was sent to it' }, { status: 400 });
  }

  try {
    const pass = await verifyEmailCode(email, code);
    const sealed = await sealSession({
      accessToken: pass.accessToken,
      refreshToken: pass.refreshToken,
      email: pass.email,
    });
    const response = Response.json({ email: pass.email ?? null });
    response.headers.append('Set-Cookie', sessionCookieHeader(sealed));
    return response;
  } catch (error) {
    const message = error instanceof PinloopServerError ? error.message : 'could not verify that code';
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}
