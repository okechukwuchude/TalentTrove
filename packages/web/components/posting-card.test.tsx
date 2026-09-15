// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PostingCard } from './posting-card.tsx';
import type { Posting } from '../lib/posting.ts';

const posting: Posting = {
  id: 'p1',
  title: 'Staff Engineer',
  company: 'Acme',
  locations: ['Remote'],
  workplace: 'remote',
  employment: 'full-time',
  posted_at: '2026-09-01T00:00:00Z',
  url: 'https://example.com/p1',
};

describe('PostingCard', () => {
  it('shows the title as a link to the posting, the company, and posted date', () => {
    render(<PostingCard posting={posting} />);
    const link = screen.getByRole('link', { name: 'Staff Engineer' });
    expect(link).toHaveAttribute('href', 'https://example.com/p1');
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('posted 2026-09-01')).toBeInTheDocument();
  });

  it('shows a match-strength badge only when the posting carries one', () => {
    const { rerender } = render(<PostingCard posting={posting} />);
    expect(screen.queryByText(/match/)).not.toBeInTheDocument();

    rerender(<PostingCard posting={{ ...posting, strength: 0.87 }} />);
    expect(screen.getByText('match 0.87')).toBeInTheDocument();
  });

  it('renders whatever is passed as actions', () => {
    render(<PostingCard posting={posting} actions={<button>Judge</button>} />);
    expect(screen.getByRole('button', { name: 'Judge' })).toBeInTheDocument();
  });

  it('shows a verdict badge and reasoning only when the posting carries one', () => {
    const { rerender } = render(<PostingCard posting={posting} />);
    expect(screen.queryByText('strong')).not.toBeInTheDocument();

    rerender(<PostingCard posting={{ ...posting, verdict: 'strong', verdict_reasoning: 'Great fit for this role.' }} />);
    expect(screen.getByText('strong')).toBeInTheDocument();
    expect(screen.getByText('Great fit for this role.')).toBeInTheDocument();
  });

  it('shows a download link only when the posting has a tailored resume', () => {
    const { rerender } = render(<PostingCard posting={posting} />);
    expect(screen.queryByRole('link', { name: 'Download tailored resume' })).not.toBeInTheDocument();

    rerender(<PostingCard posting={{ ...posting, has_tailored_resume: true }} />);
    const link = screen.getByRole('link', { name: 'Download tailored resume' });
    expect(link).toHaveAttribute('href', `/api/tailored-resumes/${posting.id}`);
  });

  it('shows the cover letter with a copy button only when the posting carries one', () => {
    const { rerender } = render(<PostingCard posting={posting} />);
    expect(screen.queryByText('Cover letter')).not.toBeInTheDocument();

    rerender(<PostingCard posting={{ ...posting, cover_letter: 'Dear Hiring Manager, I am excited...' }} />);
    expect(screen.getByText('Cover letter')).toBeInTheDocument();
    expect(screen.getByText('Dear Hiring Manager, I am excited...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });
});
