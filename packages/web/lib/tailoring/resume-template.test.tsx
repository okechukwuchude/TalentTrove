import { describe, expect, it } from 'vitest';
import { renderToBuffer } from '@react-pdf/renderer';
import { TailoredResumeDocument } from './resume-template.tsx';
import { parseResumePdf } from '../pdf.ts';

describe('TailoredResumeDocument', () => {
  it('renders a valid PDF for a full set of sections, with the contact block present', async () => {
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

    const { text } = await parseResumePdf(buffer);
    expect(text).toContain('Jane Doe');
    expect(text).toContain('jane@example.com');
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

  it('renders sections in the order given by sectionOrder, not a fixed natural order', async () => {
    const buffer = await renderToBuffer(
      <TailoredResumeDocument
        contact={{ name: 'Jane Doe', email: 'jane@example.com' }}
        sectionOrder={['education', 'summary']}
        summary="Backend engineer with 6 years of experience."
        skills={[]}
        experience={[]}
        education={[{ degree: 'B.S. Computer Science', school: 'State University', dates: '2014-2018' }]}
      />,
    );

    const { text } = await parseResumePdf(buffer);
    // Section headings render uppercase (resume-template.tsx's
    // `sectionTitle` style sets textTransform: 'uppercase'), which @react-pdf
    // actually bakes into the PDF's text layer rather than applying only at
    // paint time — so the extracted text carries it too.
    const educationIndex = text.indexOf('EDUCATION');
    const summaryIndex = text.indexOf('SUMMARY');
    expect(educationIndex).toBeGreaterThanOrEqual(0);
    expect(summaryIndex).toBeGreaterThanOrEqual(0);
    expect(educationIndex).toBeLessThan(summaryIndex);
  });

  it('ignores a sectionOrder entry outside the four known section keys', async () => {
    const buffer = await renderToBuffer(
      <TailoredResumeDocument
        contact={{ name: 'Jane Doe', email: 'jane@example.com' }}
        sectionOrder={['summary', 'certifications']}
        summary="Backend engineer with 6 years of experience."
        skills={[]}
        experience={[]}
        education={[]}
      />,
    );

    const { text } = await parseResumePdf(buffer);
    expect(text).toContain('SUMMARY');
    expect(text).not.toContain('CERTIFICATIONS');
  });
});
