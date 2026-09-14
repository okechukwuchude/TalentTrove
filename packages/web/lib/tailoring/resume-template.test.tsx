import { describe, expect, it } from 'vitest';
import { renderToBuffer } from '@react-pdf/renderer';
import { TailoredResumeDocument } from './resume-template.tsx';

describe('TailoredResumeDocument', () => {
  it('renders a valid PDF for a full set of sections', async () => {
    const buffer = await renderToBuffer(
      <TailoredResumeDocument
        contact={{ name: 'Jane Doe', email: 'jane@example.com', phone: '555-0100', location: 'Remote' }}
        sectionOrder={['summary', 'skills', 'experience', 'education']}
        summary="Backend engineer with 6 years of experience."
        skills={['TypeScript', 'PostgreSQL', 'AWS']}
        experience={[
          { title: 'Senior Engineer', company: 'Acme', dates: '2022-Present', bullets: ['Led the migration to microservices.'] },
        ]}
        education={[{ degree: 'B.S. Computer Science', school: 'State University', dates: '2014-2018' }]}
      />,
    );

    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('renders a valid PDF when every section is empty', async () => {
    const buffer = await renderToBuffer(
      <TailoredResumeDocument
        contact={{ name: 'Jane Doe', email: 'jane@example.com' }}
        sectionOrder={['summary', 'skills', 'experience', 'education']}
        summary=""
        skills={[]}
        experience={[]}
        education={[]}
      />,
    );

    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });
});
