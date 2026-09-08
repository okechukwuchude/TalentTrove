'use client';

import { PER_DOCUMENT_CAP } from '@pinloop/shared';
import { ResumeCard } from './resume-card.tsx';
import { TextDocumentCard } from './text-document-card.tsx';
import { WholeProfileUsage } from './whole-profile-usage.tsx';

export function ProfileEditor() {
  return (
    <main>
      <h1>Profile</h1>
      <WholeProfileUsage />
      <ResumeCard />
      <TextDocumentCard name="constraints" label="Constraints" perDocumentCap={PER_DOCUMENT_CAP} />
      <TextDocumentCard name="background" label="Background" perDocumentCap={PER_DOCUMENT_CAP} />
      <TextDocumentCard name="preferences" label="Preferences" perDocumentCap={PER_DOCUMENT_CAP} />
      <TextDocumentCard name="judge-prompt" label="Judge prompt" perDocumentCap={PER_DOCUMENT_CAP} resettable />
      <TextDocumentCard
        name="quick-judge-prompt"
        label="Quick judge prompt"
        perDocumentCap={PER_DOCUMENT_CAP}
        resettable
      />
    </main>
  );
}
