import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractStyleProfile, tailorResumeContent } from './openrouter.ts';

function toolCallResponse(toolName: string, args: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { tool_calls: [{ function: { name: toolName, arguments: JSON.stringify(args) } }] } }],
    }),
  };
}

describe('extractStyleProfile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the section order and contact from a successful tool-call response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        toolCallResponse('submit_style_profile', {
          sectionOrder: ['summary', 'experience', 'education'],
          contact: { name: 'Jane Doe', email: 'jane@example.com', phone: '555-0100' },
        }),
      ),
    );

    const result = await extractStyleProfile('key', 'test/model', 'resume text');

    expect(result).toEqual({
      sectionOrder: ['summary', 'experience', 'education'],
      contact: { name: 'Jane Doe', email: 'jane@example.com', phone: '555-0100' },
    });
  });

  it('returns an error when the model does not call submit_style_profile', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: {} }] }) }));

    const result = await extractStyleProfile('key', 'test/model', 'resume text');

    expect(result).toEqual({ error: 'model did not call submit_style_profile' });
  });

  it('returns an error when the HTTP response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));

    const result = await extractStyleProfile('key', 'test/model', 'resume text');

    expect(result).toEqual({ error: 'openrouter request failed with 429' });
  });
});

const TAILOR_REQUEST = {
  resumeText: 'resume',
  postingText: 'posting',
  profileText: 'profile',
  sectionOrder: ['summary', 'skills'],
};

describe('tailorResumeContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns tailored content from a successful tool-call response', async () => {
    const args = {
      summary: 'Backend engineer tailored for this role.',
      skills: ['TypeScript', 'PostgreSQL'],
      experience: [{ title: 'Engineer', company: 'Acme', dates: '2022-Present', bullets: ['Shipped things.'] }],
      education: [{ degree: 'B.S. CS', school: 'State U', dates: '2014-2018' }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(toolCallResponse('submit_tailored_resume', args)));

    const result = await tailorResumeContent('key', 'test/model', TAILOR_REQUEST);

    expect(result).toEqual(args);
  });

  it('returns an error when the model does not call submit_tailored_resume', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: {} }] }) }));

    const result = await tailorResumeContent('key', 'test/model', TAILOR_REQUEST);

    expect(result).toEqual({ error: 'model did not call submit_tailored_resume' });
  });

  it('returns an error when the HTTP response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const result = await tailorResumeContent('key', 'test/model', TAILOR_REQUEST);

    expect(result).toEqual({ error: 'openrouter request failed with 500' });
  });
});
