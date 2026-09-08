import { PinloopServerError, tradeHandoffCode } from '../../../../lib/pinloop-server.ts';
import { sealSession, sessionCookieHeader } from '../../../../lib/session.ts';

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (code === '') {
    return Response.json({ error: 'paste the code the sign-in page showed you' }, { status: 400 });
  }

  try {
    const pass = await tradeHandoffCode(code);
    const sealed = await sealSession({
      accessToken: pass.accessToken,
      refreshToken: pass.refreshToken,
      email: pass.email,
    });
    const response = Response.json({ email: pass.email ?? null });
    response.headers.append('Set-Cookie', sessionCookieHeader(sealed));
    return response;
  } catch (error) {
    const message = error instanceof PinloopServerError ? error.message : 'could not sign in';
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}
