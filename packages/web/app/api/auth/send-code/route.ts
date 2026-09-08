import { PinloopServerError, requestEmailCode } from '../../../../lib/pinloop-server.ts';

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  if (email === '') {
    return Response.json({ error: 'enter your email address' }, { status: 400 });
  }

  try {
    await requestEmailCode(email);
    return Response.json({ sent: true });
  } catch (error) {
    const message = error instanceof PinloopServerError ? error.message : 'could not send a code';
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}
