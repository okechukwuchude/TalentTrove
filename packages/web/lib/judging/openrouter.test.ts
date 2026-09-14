import { afterEach, describe, expect, it, vi } from 'vitest';
import { callJudgeModel } from './openrouter.ts';

function toolCallResponse(args: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({
      choices: [
        { message: { tool_calls: [{ function: { name: 'submit_verdict', arguments: JSON.stringify(args) } }] } },
      ],
    }),
  };
}

const REQUEST = { model: 'test/model', systemPrompt: 'instructions', postingText: 'posting', profileText: 'profile' };

describe('callJudgeModel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the verdict and reasoning from a successful tool-call response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(toolCallResponse({ verdict: 'strong', reasoning: 'Great fit.' })));

    const result = await callJudgeModel('key', REQUEST);

    expect(result).toEqual({ verdict: 'strong', reasoning: 'Great fit.' });
  });

  it('returns an error when the model does not call submit_verdict', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: {} }] }) }));

    const result = await callJudgeModel('key', REQUEST);

    expect(result).toEqual({ error: 'model did not call submit_verdict' });
  });

  it('returns an error when the HTTP response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));

    const result = await callJudgeModel('key', REQUEST);

    expect(result).toEqual({ error: 'openrouter request failed with 429' });
  });

  it('returns an error when the model returns a verdict outside the four-word scale', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(toolCallResponse({ verdict: 'maybe', reasoning: 'Unsure.' })));

    const result = await callJudgeModel('key', REQUEST);

    expect(result).toEqual({ error: 'model returned an invalid verdict: maybe' });
  });

  it('returns an error when the HTTP response body is not valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    }));

    const result = await callJudgeModel('key', REQUEST);

    expect(result).toEqual({ error: 'openrouter response was not valid JSON' });
  });

  it('returns an error when submit_verdict arguments is null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          { message: { tool_calls: [{ function: { name: 'submit_verdict', arguments: 'null' } }] } },
        ],
      }),
    }));

    const result = await callJudgeModel('key', REQUEST);

    expect(result).toEqual({ error: 'submit_verdict arguments did not return an object' });
  });
});
