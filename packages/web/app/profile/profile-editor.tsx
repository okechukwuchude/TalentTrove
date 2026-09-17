'use client';

import { PER_DOCUMENT_CAP } from '@pinloop/shared';
import { ResumeCard } from './resume-card.tsx';
import { RolePreferencesCard } from './role-preferences-card.tsx';
import { RolePreferencesResults } from './role-preferences-results.tsx';
import { TextDocumentCard } from './text-document-card.tsx';
import { WholeProfileUsage } from './whole-profile-usage.tsx';

export function ProfileEditor() {
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Profile</h1>
      <WholeProfileUsage />
      <RolePreferencesCard />
      <RolePreferencesResults />
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
