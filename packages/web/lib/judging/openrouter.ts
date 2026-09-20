import { VERDICTS, type Verdict } from '@talenttrove/shared';

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export type JudgeRequest = {
  model: string;
  systemPrompt: string;
  postingText: string;
  profileText: string;
};

export type JudgeResult = { verdict: Verdict; reasoning: string } | { error: string };

const SUBMIT_VERDICT_TOOL = {
  type: 'function',
  function: {
    name: 'submit_verdict',
    description: 'Submit the verdict and reasoning for this posting.',
    parameters: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: VERDICTS },
        reasoning: { type: 'string' },
      },
      required: ['verdict', 'reasoning'],
    },
  },
} as const;

export async function callJudgeModel(apiKey: string, request: JudgeRequest): Promise<JudgeResult> {
  let response: Response;
  try {
    response = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: request.model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: `${request.postingText}\n\n---\n\n${request.profileText}` },
        ],
        tools: [SUBMIT_VERDICT_TOOL],
        tool_choice: { type: 'function', function: { name: 'submit_verdict' } },
      }),
    });
  } catch (error) {
    // A network error (DNS, ECONNRESET, TLS) or the AbortSignal.timeout above
    // firing on a slow model response both surface as a rejected fetch
    // promise, not an HTTP error status. Without this catch, that rejection
    // would propagate out of callJudgeModel and abort the whole judging run
    // over a single posting's slow response.
    return { error: `openrouter request failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  if (!response.ok) {
    return { error: `openrouter request failed with ${response.status}` };
  }

  let body: { choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[] };
  try {
    body = (await response.json()) as {
      choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
    };
  } catch {
    return { error: 'openrouter response was not valid JSON' };
  }

  const toolCall = body.choices?.[0]?.message?.tool_calls?.find((call) => call.function?.name === 'submit_verdict');
  if (!toolCall?.function?.arguments) {
    return { error: 'model did not call submit_verdict' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(toolCall.function.arguments);
  } catch {
    return { error: 'submit_verdict arguments were not valid JSON' };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { error: 'submit_verdict arguments did not return an object' };
  }

  const parsedObj = parsed as { verdict?: unknown; reasoning?: unknown };
  if (typeof parsedObj.verdict !== 'string' || !(VERDICTS as readonly string[]).includes(parsedObj.verdict)) {
    return { error: `model returned an invalid verdict: ${String(parsedObj.verdict)}` };
  }
  if (typeof parsedObj.reasoning !== 'string' || parsedObj.reasoning.trim() === '') {
    return { error: 'model returned no reasoning' };
  }

  return { verdict: parsedObj.verdict as Verdict, reasoning: parsedObj.reasoning };
}
