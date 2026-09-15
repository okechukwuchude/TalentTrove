const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

const KNOWN_SECTIONS = ['summary', 'skills', 'experience', 'education'] as const;

export type StyleProfile = {
  sectionOrder: string[];
  contact: { name: string; email: string; phone?: string; location?: string; links?: string[] };
};
export type StyleProfileResult = StyleProfile | { error: string };

type ToolCallBody = {
  choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
};

async function readToolCallArguments(response: Response, toolName: string): Promise<unknown | { error: string }> {
  let body: ToolCallBody;
  try {
    body = (await response.json()) as ToolCallBody;
  } catch {
    return { error: 'openrouter response was not valid JSON' };
  }

  const toolCall = body.choices?.[0]?.message?.tool_calls?.find((call) => call.function?.name === toolName);
  if (!toolCall?.function?.arguments) {
    return { error: `model did not call ${toolName}` };
  }

  try {
    return JSON.parse(toolCall.function.arguments);
  } catch {
    return { error: `${toolName} arguments were not valid JSON` };
  }
}

function isErrorResult(value: unknown): value is { error: string } {
  return typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string';
}

const EXTRACT_STYLE_TOOL = {
  type: 'function',
  function: {
    name: 'submit_style_profile',
    description: "Submit the resume's section order and contact information.",
    parameters: {
      type: 'object',
      properties: {
        sectionOrder: {
          type: 'array',
          items: { type: 'string', enum: KNOWN_SECTIONS },
          description: 'The section headings found in the resume, in their original order.',
        },
        contact: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
            location: { type: 'string' },
            links: { type: 'array', items: { type: 'string' } },
          },
          required: ['name', 'email'],
        },
      },
      required: ['sectionOrder', 'contact'],
    },
  },
} as const;

export async function extractStyleProfile(apiKey: string, model: string, resumeText: string): Promise<StyleProfileResult> {
  let response: Response;
  try {
    response = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You read a resume and report its structure: which of these sections it has — summary, skills, experience, education — in the order they appear, and the contact information at the top. Do not invent a section that is not present.',
          },
          { role: 'user', content: resumeText },
        ],
        tools: [EXTRACT_STYLE_TOOL],
        tool_choice: { type: 'function', function: { name: 'submit_style_profile' } },
      }),
    });
  } catch (error) {
    return { error: `openrouter request failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  if (!response.ok) {
    return { error: `openrouter request failed with ${response.status}` };
  }

  const parsed = await readToolCallArguments(response, 'submit_style_profile');
  if (isErrorResult(parsed)) return parsed;
  if (typeof parsed !== 'object' || parsed === null) {
    return { error: 'submit_style_profile arguments did not return an object' };
  }

  const parsedObj = parsed as { sectionOrder?: unknown; contact?: unknown };
  if (
    !Array.isArray(parsedObj.sectionOrder) ||
    parsedObj.sectionOrder.length === 0 ||
    !parsedObj.sectionOrder.every((key) => typeof key === 'string' && (KNOWN_SECTIONS as readonly string[]).includes(key))
  ) {
    return { error: 'model returned an invalid or empty sectionOrder' };
  }
  if (typeof parsedObj.contact !== 'object' || parsedObj.contact === null) {
    return { error: 'model returned no contact information' };
  }
  const contact = parsedObj.contact as {
    name?: unknown;
    email?: unknown;
    phone?: unknown;
    location?: unknown;
    links?: unknown;
  };
  if (typeof contact.name !== 'string' || contact.name.trim() === '' || typeof contact.email !== 'string' || contact.email.trim() === '') {
    return { error: 'model returned an incomplete contact block' };
  }

  return {
    sectionOrder: parsedObj.sectionOrder as string[],
    contact: {
      name: contact.name,
      email: contact.email,
      ...(typeof contact.phone === 'string' && contact.phone ? { phone: contact.phone } : {}),
      ...(typeof contact.location === 'string' && contact.location ? { location: contact.location } : {}),
      ...(Array.isArray(contact.links)
        ? { links: contact.links.filter((link): link is string => typeof link === 'string') }
        : {}),
    },
  };
}

export type TailoredContent = {
  summary: string;
  skills: string[];
  experience: Array<{ title: string; company: string; dates: string; bullets: string[] }>;
  education: Array<{ degree: string; school: string; dates: string }>;
  coverLetter: string;
};
export type TailorContentResult = TailoredContent | { error: string };
export type TailorRequest = {
  resumeText: string;
  postingText: string;
  profileText: string;
  sectionOrder: string[];
};

const TAILOR_CONTENT_TOOL = {
  type: 'function',
  function: {
    name: 'submit_tailored_resume',
    description: 'Submit tailored resume content for this posting.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        skills: { type: 'array', items: { type: 'string' } },
        experience: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              company: { type: 'string' },
              dates: { type: 'string' },
              bullets: { type: 'array', items: { type: 'string' } },
            },
            required: ['title', 'company', 'dates', 'bullets'],
          },
        },
        education: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              degree: { type: 'string' },
              school: { type: 'string' },
              dates: { type: 'string' },
            },
            required: ['degree', 'school', 'dates'],
          },
        },
        coverLetter: { type: 'string' },
      },
      required: ['summary', 'skills', 'experience', 'education', 'coverLetter'],
    },
  },
} as const;

function isExperienceEntry(entry: unknown): entry is TailoredContent['experience'][number] {
  if (typeof entry !== 'object' || entry === null) return false;
  const row = entry as Record<string, unknown>;
  return (
    typeof row.title === 'string' &&
    typeof row.company === 'string' &&
    typeof row.dates === 'string' &&
    Array.isArray(row.bullets) &&
    row.bullets.every((bullet) => typeof bullet === 'string')
  );
}

function isEducationEntry(entry: unknown): entry is TailoredContent['education'][number] {
  if (typeof entry !== 'object' || entry === null) return false;
  const row = entry as Record<string, unknown>;
  return typeof row.degree === 'string' && typeof row.school === 'string' && typeof row.dates === 'string';
}

export async function tailorResumeContent(
  apiKey: string,
  model: string,
  request: TailorRequest,
): Promise<TailorContentResult> {
  let response: Response;
  try {
    response = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `You tailor a resume's content to fit one specific job posting, using only what is true of the candidate — never invent experience, skills, or education they do not have. Only write content for these sections, in this exact set: ${request.sectionOrder.join(', ')}. Leave any section not in that list empty. Do not include contact information — that is handled separately. Also write a brief, professional cover letter (2-4 short paragraphs) specific to this posting, using the same candidate facts.`,
          },
          {
            role: 'user',
            content: `resume:\n${request.resumeText}\n\n---\n\nposting:\n${request.postingText}\n\n---\n\nadditional candidate notes:\n${request.profileText}`,
          },
        ],
        tools: [TAILOR_CONTENT_TOOL],
        tool_choice: { type: 'function', function: { name: 'submit_tailored_resume' } },
      }),
    });
  } catch (error) {
    return { error: `openrouter request failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  if (!response.ok) {
    return { error: `openrouter request failed with ${response.status}` };
  }

  const parsed = await readToolCallArguments(response, 'submit_tailored_resume');
  if (isErrorResult(parsed)) return parsed;
  if (typeof parsed !== 'object' || parsed === null) {
    return { error: 'submit_tailored_resume arguments did not return an object' };
  }

  const p = parsed as { summary?: unknown; skills?: unknown; experience?: unknown; education?: unknown; coverLetter?: unknown };
  if (typeof p.summary !== 'string') {
    return { error: 'model returned no summary' };
  }
  if (!Array.isArray(p.skills) || !p.skills.every((skill) => typeof skill === 'string')) {
    return { error: 'model returned an invalid skills list' };
  }
  if (!Array.isArray(p.experience) || !p.experience.every(isExperienceEntry)) {
    return { error: 'model returned an invalid experience list' };
  }
  if (!Array.isArray(p.education) || !p.education.every(isEducationEntry)) {
    return { error: 'model returned an invalid education list' };
  }
  if (typeof p.coverLetter !== 'string' || p.coverLetter.trim() === '') {
    return { error: 'model returned no cover letter' };
  }

  return {
    summary: p.summary,
    skills: p.skills as string[],
    experience: p.experience as TailoredContent['experience'],
    education: p.education as TailoredContent['education'],
    coverLetter: p.coverLetter,
  };
}
