# Visual Foundation & Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `packages/web` a real visual foundation (Tailwind CSS + shadcn/ui, retrofitted onto the existing sign-in/profile pages) and ship the `/search` page — word/filter search over postings, folding in `pinloop list` and `pinloop companies`, with cursor pagination — reaching that slice of parity with `pinloop search`/`pinloop list`/`pinloop companies`.

**Architecture:** Task 1 adds Tailwind + a small, dependency-light set of shadcn-style primitives (`Button`, `Input`, `Textarea`, `Label`, `Card`, `Badge` — no Radix packages needed yet) and restyles every existing page without changing any accessible name, label, role, or button text the current test suite depends on. Tasks 2–5 build the search feature bottom-up: a shared `Posting` type and presentational `<PostingCard>`/`<PostingList>` (with an unused-for-now `renderActions` extension point, so the tabs and judge phases can add actions without touching these files again), a `search-queries.ts` TanStack Query hook file mirroring `profile-queries.ts`, two new BFF routes (`/api/search`, `/api/companies`) mirroring the profile routes' `requireSession`/`callAsAccount`/`withRenewedCookie` pattern, and finally the `/search` page itself (filter form, company typeahead, results list, "Load more" pagination).

**Tech Stack:** `tailwindcss`, `postcss`, `autoprefixer`, `class-variance-authority`, `clsx`, `tailwind-merge` (all added in Task 1); everything else already in `packages/web` (Next 15, React 19, `@tanstack/react-query`, Vitest + Testing Library).

**Spec:** `docs/superpowers/specs/2026-09-08-web-app-migration-design.md` (see "Visual foundation, decided for the search/tabs/judge phase" and the `/search` half of "Search, Tabs & Judge, in detail")

**Depends on:** `docs/superpowers/plans/2026-09-08-monorepo-restructuring.md`, `docs/superpowers/plans/2026-09-08-auth-and-session.md`, `docs/superpowers/plans/2026-09-08-profile-and-cv-upload.md`.

**Not in this plan:** `/tabs`, the judge dialog, `streamAsAccount`, semantic search (`--semantic`/`--from-profile`/`--min-match`/`--preview`), and any posting-level action (Judge, Add to tab) — these are separate follow-up plans against the same spec section.

## Global Constraints

- Every new route under `/api/search` and `/api/companies` requires a valid session via `requireSession`; an unauthenticated request gets `401`, exactly like every existing route.
- Whenever `callAsAccount` reports a `renewedPass`, the route handler re-seals and re-sets the session cookie via `withRenewedCookie` before returning — the same rule every existing route already follows.
- Word/filter search only. `/api/search`'s request body never sets `semantic`, `from_profile`, `min_match`, or `preview` — those are a later, separate slice.
- Restyling existing pages must preserve every accessible name, label, role, and button text exactly as it is today. The existing test suite (`sign-in/page.test.tsx`, `sign-out-button.test.tsx`, `resume-card.test.tsx`, `text-document-card.test.tsx`) must keep passing **unmodified** — no edits to those test files in this plan.
- `<PostingCard>`/`<PostingList>` expose a `renderActions`/`actions` extension point but nothing in this plan passes one — no multi-select, no Judge button, no Add-to-tab button. Those land in the tabs and judge follow-up plans without needing to touch these two files' props again.
- `"type": "module"`, strict/`noUncheckedIndexedAccess` TypeScript, and `.ts`/`.tsx` extensions on relative imports (`allowImportingTsExtensions`) carry over unchanged from Plans 1–3.
- No new Radix-based dependency (`@radix-ui/*`, `cmdk`) in this plan — the company typeahead is a plain absolutely-positioned list, not a shadcn `Popover`/`Command`. Those get added when the judge dialog actually needs a `Dialog` primitive.

---

### Task 1: Tailwind CSS + shadcn-style primitives, retrofit existing pages

**Files:**
- Modify: `packages/web/package.json` (add `tailwindcss`, `postcss`, `autoprefixer` devDependencies; `class-variance-authority`, `clsx`, `tailwind-merge` dependencies)
- Create: `packages/web/tailwind.config.ts`
- Create: `packages/web/postcss.config.mjs`
- Create: `packages/web/app/globals.css`
- Create: `packages/web/lib/utils.ts`
- Create: `packages/web/components/ui/button.tsx`
- Create: `packages/web/components/ui/input.tsx`
- Create: `packages/web/components/ui/textarea.tsx`
- Create: `packages/web/components/ui/label.tsx`
- Create: `packages/web/components/ui/card.tsx`
- Create: `packages/web/components/ui/badge.tsx`
- Create: `packages/web/components/app-nav.tsx`
- Modify: `packages/web/app/layout.tsx`
- Modify: `packages/web/app/page.tsx`
- Modify: `packages/web/app/sign-in/page.tsx`
- Modify: `packages/web/app/sign-out-button.tsx`
- Modify: `packages/web/app/profile/profile-editor.tsx`
- Modify: `packages/web/app/profile/resume-card.tsx`
- Modify: `packages/web/app/profile/text-document-card.tsx`
- Modify: `packages/web/app/profile/whole-profile-usage.tsx`

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` from `lib/utils.ts` — every later task's new components use it for conditional class names.
- Produces: `<Button>`, `<Input>`, `<Textarea>`, `<Label>`, `<Card>`/`<CardHeader>`/`<CardContent>`, `<Badge>` from `components/ui/*` — the primitives Tasks 2 and 5 build on.
- Produces: `<AppNav signedIn: boolean, email?: string>` — rendered once, in `layout.tsx`.

This task has no new business logic, so it is not TDD'd like the others — it is infrastructure plus markup, verified by (a) the existing test suite still passing unmodified and (b) `next build` succeeding.

- [ ] **Step 1: Add the styling dependencies**

Edit `packages/web/package.json`:

```json
{
  "name": "@pinloop/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "@pinloop/shared": "*",
    "@tanstack/react-query": "^5.59.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "iron-session": "^8.0.4",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwind-merge": "^2.5.4"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.0.1",
    "@types/node": "^22.10.2",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.1",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.15"
  }
}
```

Run: `npm install` (from the repo root — this is an npm-workspaces monorepo)
Expected: lockfile updates, no errors.

- [ ] **Step 2: Tailwind and PostCSS config**

Create `packages/web/tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [],
};

export default config;
```

Create `packages/web/postcss.config.mjs`:

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

Create `packages/web/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 240 10% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 3.9%;
    --primary: 240 5.9% 10%;
    --primary-foreground: 0 0% 98%;
    --secondary: 240 4.8% 95.9%;
    --secondary-foreground: 240 5.9% 10%;
    --muted: 240 4.8% 95.9%;
    --muted-foreground: 240 3.8% 46.1%;
    --accent: 240 4.8% 95.9%;
    --accent-foreground: 240 5.9% 10%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 5.9% 90%;
    --input: 240 5.9% 90%;
    --ring: 240 5.9% 10%;
    --radius: 0.5rem;
  }

  * {
    @apply border-border;
  }

  body {
    @apply bg-background text-foreground;
  }
}
```

- [ ] **Step 3: `cn` helper**

Create `packages/web/lib/utils.ts`:

```ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: The six primitives**

Create `packages/web/components/ui/button.tsx`:

```tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.ts';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        outline: 'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  ),
);
Button.displayName = 'Button';

export { Button, buttonVariants };
```

Create `packages/web/components/ui/input.tsx`:

```tsx
import * as React from 'react';
import { cn } from '../../lib/utils.ts';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm ' +
          'transition-colors placeholder:text-muted-foreground focus-visible:outline-none ' +
          'focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
```

Create `packages/web/components/ui/textarea.tsx`:

```tsx
import * as React from 'react';
import { cn } from '../../lib/utils.ts';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ' +
          'transition-colors placeholder:text-muted-foreground focus-visible:outline-none ' +
          'focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Textarea };
```

Create `packages/web/components/ui/label.tsx`:

```tsx
import * as React from 'react';
import { cn } from '../../lib/utils.ts';

const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn('text-sm font-medium leading-none', className)} {...props} />
  ),
);
Label.displayName = 'Label';

export { Label };
```

Create `packages/web/components/ui/card.tsx`:

```tsx
import * as React from 'react';
import { cn } from '../../lib/utils.ts';

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)} {...props} />
  ),
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-4', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-4 pt-0', className)} {...props} />,
);
CardContent.displayName = 'CardContent';

export { Card, CardHeader, CardContent };
```

Create `packages/web/components/ui/badge.tsx`:

```tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.ts';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
```

- [ ] **Step 5: The nav bar**

Create `packages/web/components/app-nav.tsx`:

```tsx
import Link from 'next/link';
import { SignOutButton } from '../app/sign-out-button.tsx';

export function AppNav({ signedIn, email }: { signedIn: boolean; email?: string }) {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-semibold">
          TalentTrove
        </Link>
        {signedIn ? (
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/search" className="hover:underline">
              Search
            </Link>
            <Link href="/profile" className="hover:underline">
              Profile
            </Link>
            {email && <span className="text-muted-foreground">{email}</span>}
            <SignOutButton />
          </nav>
        ) : (
          <Link href="/sign-in" className="text-sm hover:underline">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 6: Wire the nav into the root layout**

Replace `packages/web/app/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { QueryProvider } from './query-provider.tsx';
import { readSession } from '../lib/session.ts';
import { AppNav } from '../components/app-nav.tsx';
import './globals.css';

export const metadata = {
  title: 'TalentTrove',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
  const session = await readSession(cookieHeader);

  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground">
        <QueryProvider>
          <AppNav signedIn={Boolean(session.accessToken)} email={session.email} />
          <div className="mx-auto max-w-4xl px-4 py-8">{children}</div>
        </QueryProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Simplify the home page (the nav now owns sign-in/out)**

Replace `packages/web/app/page.tsx`:

```tsx
export default function HomePage() {
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Welcome to TalentTrove</h1>
      <p className="text-muted-foreground">
        Search postings, keep tabs of the ones you like, and get Pinloop&rsquo;s judgment on how well
        they fit your profile.
      </p>
    </main>
  );
}
```

- [ ] **Step 8: Restyle sign-out**

Replace `packages/web/app/sign-out-button.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { Button } from '../components/ui/button.tsx';

export function SignOutButton() {
  const router = useRouter();

  async function handleClick(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
    router.refresh();
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={handleClick}>
      Sign out
    </Button>
  );
}
```

- [ ] **Step 9: Restyle sign-in (preserving every label/role/button-text the tests query by)**

Replace `packages/web/app/sign-in/page.tsx`:

```tsx
'use client';

import { type FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';

type Step = { name: 'email' } | { name: 'code'; email: string };

export default function SignInPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: 'email' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSendCode(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? 'could not send a code');
        return;
      }
      setStep({ name: 'code', email });
    } catch {
      setError('could not reach the server — check your connection and try again');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyCode(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (step.name !== 'code') return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: step.email, code }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? 'could not verify that code');
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('could not reach the server — check your connection and try again');
    } finally {
      setSubmitting(false);
    }
  }

  if (step.name === 'code') {
    return (
      <main className="mx-auto flex max-w-sm flex-col gap-4">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-muted-foreground">We sent a code to {step.email}.</p>
        <form onSubmit={handleVerifyCode} noValidate className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">Code</Label>
            <Input
              id="code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              disabled={submitting}
            />
          </div>
          <Button type="submit" disabled={submitting || code.trim() === ''}>
            {submitting ? 'Verifying…' : 'Verify'}
          </Button>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setStep({ name: 'email' });
            setCode('');
            setError(null);
          }}
        >
          Use a different email
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="text-sm text-muted-foreground">
        Enter your email and we&rsquo;ll send you a code to sign in with.
      </p>
      <form onSubmit={handleSendCode} noValidate className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={submitting}
          />
        </div>
        <Button type="submit" disabled={submitting || email.trim() === ''}>
          {submitting ? 'Sending…' : 'Send code'}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
```

- [ ] **Step 10: Restyle the profile pieces**

Replace `packages/web/app/profile/resume-card.tsx`:

```tsx
'use client';

import { type ChangeEvent, useState } from 'react';
import { FILE_CAP } from '@pinloop/shared';
import { useUploadResume } from '../../lib/profile-queries.ts';
import { Card, CardContent, CardHeader } from '../../components/ui/card.tsx';

export function ResumeCard() {
  const upload = useUploadResume();
  const [clientError, setClientError] = useState<string | null>(null);

  function handleFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setClientError(null);

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setClientError('that does not look like a PDF file');
      return;
    }
    if (file.size > FILE_CAP) {
      setClientError(`that file is ${file.size.toLocaleString('en-US')} bytes, over the 10MB limit`);
      return;
    }

    upload.mutate(file);
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold">Resume</h2>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <input type="file" accept="application/pdf" aria-label="Resume" onChange={handleFile} className="text-sm" />
        {upload.isPending && <p className="text-sm text-muted-foreground">Uploading…</p>}
        {clientError && (
          <p role="alert" className="text-sm text-destructive">
            {clientError}
          </p>
        )}
        {upload.isError && (
          <p role="alert" className="text-sm text-destructive">
            {upload.error.message}
          </p>
        )}
        {upload.isSuccess && (
          <p aria-live="polite" className="text-sm text-muted-foreground">
            Stored
            {typeof upload.data.pages === 'number'
              ? ` — ${upload.data.pages} page${upload.data.pages === 1 ? '' : 's'}, ` +
                `${upload.data.pages_read ?? upload.data.pages} read, ` +
                `${(upload.data.characters ?? 0).toLocaleString('en-US')} characters of text stored`
              : typeof upload.data.bytes === 'number'
                ? ` — ${upload.data.bytes.toLocaleString('en-US')} bytes`
                : ''}
            {upload.data.note ? ` ${upload.data.note}` : ''}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

Replace `packages/web/app/profile/text-document-card.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useProfileDocumentText, useResetToDefault, useSaveTextDocument } from '../../lib/profile-queries.ts';
import { Button } from '../../components/ui/button.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { Card, CardContent, CardHeader } from '../../components/ui/card.tsx';

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function TextDocumentCard({
  name,
  label,
  perDocumentCap,
  resettable = false,
}: {
  name: string;
  label: string;
  perDocumentCap: number;
  resettable?: boolean;
}) {
  const { data, isLoading, isError, error } = useProfileDocumentText(name);
  const save = useSaveTextDocument(name);
  const reset = useResetToDefault(name);
  const [draft, setDraft] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched && data?.text !== undefined) setDraft(data.text);
  }, [data?.text, touched]);

  const byteCount = byteLength(draft);
  const overCap = byteCount > perDocumentCap;
  const usingDefault = resettable && data?.stored === false;

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold">{label}</h2>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ) : (
          <>
            {usingDefault && (
              <p className="text-sm text-muted-foreground">
                Using the default Pinloop ships. Edit below to store your own.
              </p>
            )}
            <Textarea
              aria-label={label}
              value={draft}
              onChange={(event) => {
                setTouched(true);
                setDraft(event.target.value);
              }}
              rows={6}
            />
            <p aria-live="polite" className="text-xs text-muted-foreground">
              {byteCount.toLocaleString('en-US')} / {perDocumentCap.toLocaleString('en-US')} bytes
              {overCap ? ' — over the per-document limit' : ''}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={save.isPending || overCap || draft === (data?.text ?? '')}
                onClick={() => save.mutate(draft, { onSuccess: () => setTouched(false) })}
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
              {resettable && !usingDefault && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={reset.isPending}
                  onClick={() => reset.mutate(undefined, { onSuccess: () => setTouched(false) })}
                >
                  {reset.isPending ? 'Resetting…' : 'Reset to default'}
                </Button>
              )}
            </div>
            {save.isError && (
              <p role="alert" className="text-sm text-destructive">
                {save.error.message}
              </p>
            )}
            {reset.isError && (
              <p role="alert" className="text-sm text-destructive">
                {reset.error.message}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

Replace `packages/web/app/profile/whole-profile-usage.tsx`:

```tsx
'use client';

import { WHOLE_PROFILE_CAP } from '@pinloop/shared';
import { useProfileDocuments } from '../../lib/profile-queries.ts';

export function WholeProfileUsage() {
  const { data, isError, error } = useProfileDocuments();
  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error.message}
      </p>
    );
  }
  const textBytes = (data ?? [])
    .filter((document) => document.kind === 'text')
    .reduce((total, document) => total + document.bytes, 0);
  const overCap = textBytes > WHOLE_PROFILE_CAP;

  return (
    <p aria-live="polite" className="text-sm text-muted-foreground">
      {textBytes.toLocaleString('en-US')} / {WHOLE_PROFILE_CAP.toLocaleString('en-US')} bytes of text documents
      stored{overCap ? ' — over the whole-profile limit' : ''}
    </p>
  );
}
```

Replace `packages/web/app/profile/profile-editor.tsx`:

```tsx
'use client';

import { PER_DOCUMENT_CAP } from '@pinloop/shared';
import { ResumeCard } from './resume-card.tsx';
import { TextDocumentCard } from './text-document-card.tsx';
import { WholeProfileUsage } from './whole-profile-usage.tsx';

export function ProfileEditor() {
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Profile</h1>
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
```

- [ ] **Step 11: Verify nothing broke**

Run: `npx vitest run` (from the repo root)
Expected: every existing test still passes, unmodified — `sign-in/page.test.tsx`, `sign-out-button.test.tsx`, `resume-card.test.tsx`, `text-document-card.test.tsx`, and everything else.

Run: `npm run build -w packages/web`
Expected: the Next.js build succeeds with no type errors.

- [ ] **Step 12: Commit**

```bash
git add packages/web/package.json packages/web/tailwind.config.ts packages/web/postcss.config.mjs \
  packages/web/app/globals.css packages/web/lib/utils.ts packages/web/components/ui \
  packages/web/components/app-nav.tsx packages/web/app/layout.tsx packages/web/app/page.tsx \
  packages/web/app/sign-in/page.tsx packages/web/app/sign-out-button.tsx packages/web/app/profile \
  package-lock.json
git commit -m "web: add Tailwind + shadcn-style primitives, restyle existing pages and add a nav"
```

---

### Task 2: Shared `Posting` type and `<PostingCard>`/`<PostingList>`

**Files:**
- Create: `packages/web/lib/posting.ts`
- Create: `packages/web/components/posting-card.tsx`
- Test: `packages/web/components/posting-card.test.tsx`
- Create: `packages/web/components/posting-list.tsx`
- Test: `packages/web/components/posting-list.test.tsx`

**Interfaces:**
- Consumes: `Badge` from `components/ui/badge.tsx`, `Card`/`CardHeader`/`CardContent` from `components/ui/card.tsx`, `Button` from `components/ui/button.tsx` (Task 1).
- Produces: `type Posting`, `asPosting(row: Record<string, unknown>): Posting` from `lib/posting.ts` — Task 3's `useSearch` maps server rows through this.
- Produces: `<PostingCard posting: Posting, actions?: ReactNode>` and `<PostingList postings: Posting[], isLoading: boolean, isError: boolean, error?: Error | null, hasNextPage?: boolean, isFetchingNextPage?: boolean, onLoadMore?: () => void, emptyMessage: string, renderActions?: (posting: Posting) => ReactNode>` — Task 5's search page renders results through `<PostingList>`.

- [ ] **Step 1: The `Posting` type and row mapper**

Create `packages/web/lib/posting.ts`:

```ts
export type Posting = {
  id: string;
  title: string;
  company: string;
  locations?: string[];
  workplace?: string;
  employment?: string;
  posted_at?: string | null;
  url: string;
  strength?: number;
};

export function asPosting(row: Record<string, unknown>): Posting {
  return {
    id: String(row['id'] ?? ''),
    title: String(row['title'] ?? ''),
    company: String(row['company'] ?? ''),
    locations: Array.isArray(row['locations']) ? (row['locations'] as string[]) : undefined,
    workplace: typeof row['workplace'] === 'string' ? row['workplace'] : undefined,
    employment: typeof row['employment'] === 'string' ? row['employment'] : undefined,
    posted_at: typeof row['posted_at'] === 'string' ? row['posted_at'] : null,
    url: String(row['url'] ?? ''),
    strength: typeof row['strength'] === 'number' ? row['strength'] : undefined,
  };
}
```

This has no branching worth a unit test on its own — it is exercised by `search-queries.test.tsx` in Task 3, where it matters (mapping a real server row).

- [ ] **Step 2: Write the failing test for `<PostingCard>`**

Create `packages/web/components/posting-card.test.tsx`:

```tsx
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
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run components/posting-card.test.tsx`
Expected: FAIL — `./posting-card.tsx` does not exist yet.

- [ ] **Step 4: Implement `<PostingCard>`**

Create `packages/web/components/posting-card.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Badge } from './ui/badge.tsx';
import { Card, CardContent, CardHeader } from './ui/card.tsx';
import type { Posting } from '../lib/posting.ts';

export function PostingCard({ posting, actions }: { posting: Posting; actions?: ReactNode }) {
  const location = posting.locations?.[0];
  const postedDate = posting.posted_at ? posting.posted_at.slice(0, 10) : undefined;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <a href={posting.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
            {posting.title}
          </a>
          <p className="text-sm text-muted-foreground">{posting.company}</p>
        </div>
        {typeof posting.strength === 'number' && (
          <Badge variant="secondary">match {posting.strength.toFixed(2)}</Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {location && <span>{location}</span>}
        {posting.workplace && <Badge variant="outline">{posting.workplace}</Badge>}
        {posting.employment && <Badge variant="outline">{posting.employment}</Badge>}
        {postedDate && <span>posted {postedDate}</span>}
        {actions && <div className="ml-auto flex gap-2">{actions}</div>}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `npx vitest run components/posting-card.test.tsx`
Expected: PASS

- [ ] **Step 6: Write the failing test for `<PostingList>`**

Create `packages/web/components/posting-list.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PostingList } from './posting-list.tsx';
import type { Posting } from '../lib/posting.ts';

const postings: Posting[] = [
  { id: 'p1', title: 'Staff Engineer', company: 'Acme', url: 'https://example.com/p1', posted_at: null },
  { id: 'p2', title: 'Senior Engineer', company: 'Beta', url: 'https://example.com/p2', posted_at: null },
];

describe('PostingList', () => {
  it('shows the empty message when there are no postings and nothing is loading', () => {
    render(<PostingList postings={[]} isLoading={false} isError={false} emptyMessage="No postings matched." />);
    expect(screen.getByText('No postings matched.')).toBeInTheDocument();
  });

  it('shows the server error instead of the list', () => {
    render(
      <PostingList
        postings={[]}
        isLoading={false}
        isError
        error={new Error('could not search')}
        emptyMessage="No postings matched."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('could not search');
  });

  it('renders one card per posting, with per-posting actions from renderActions', () => {
    render(
      <PostingList
        postings={postings}
        isLoading={false}
        isError={false}
        emptyMessage="No postings matched."
        renderActions={(posting) => <button>Judge {posting.id}</button>}
      />,
    );
    expect(screen.getByRole('link', { name: 'Staff Engineer' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Senior Engineer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Judge p1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Judge p2' })).toBeInTheDocument();
  });

  it('shows a Load more button only when there is a next page, and calls onLoadMore', () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <PostingList postings={postings} isLoading={false} isError={false} emptyMessage="none" />,
    );
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();

    rerender(
      <PostingList
        postings={postings}
        isLoading={false}
        isError={false}
        emptyMessage="none"
        hasNextPage
        onLoadMore={onLoadMore}
      />,
    );
    screen.getByRole('button', { name: /load more/i }).click();
    expect(onLoadMore).toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run it to see it fail**

Run: `npx vitest run components/posting-list.test.tsx`
Expected: FAIL — `./posting-list.tsx` does not exist yet.

- [ ] **Step 8: Implement `<PostingList>`**

Create `packages/web/components/posting-list.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Button } from './ui/button.tsx';
import { PostingCard } from './posting-card.tsx';
import type { Posting } from '../lib/posting.ts';

export function PostingList({
  postings,
  isLoading,
  isError,
  error,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  emptyMessage,
  renderActions,
}: {
  postings: Posting[];
  isLoading: boolean;
  isError: boolean;
  error?: Error | null;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  emptyMessage: string;
  renderActions?: (posting: Posting) => ReactNode;
}) {
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error?.message ?? 'could not load postings'}
      </p>
    );
  }
  if (postings.length === 0) return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;

  return (
    <div className="flex flex-col gap-3">
      {postings.map((posting) => (
        <PostingCard key={posting.id} posting={posting} actions={renderActions?.(posting)} />
      ))}
      {hasNextPage && (
        <Button variant="outline" disabled={isFetchingNextPage} onClick={onLoadMore}>
          {isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 9: Run it to see it pass**

Run: `npx vitest run components/posting-card.test.tsx components/posting-list.test.tsx`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add packages/web/lib/posting.ts packages/web/components/posting-card.tsx \
  packages/web/components/posting-card.test.tsx packages/web/components/posting-list.tsx \
  packages/web/components/posting-list.test.tsx
git commit -m "web: add Posting type and shared PostingCard/PostingList components"
```

---

### Task 3: `search-queries.ts` — `useSearch` and `useCompanies`

**Files:**
- Create: `packages/web/lib/search-queries.ts`
- Test: `packages/web/lib/search-queries.test.tsx`

**Interfaces:**
- Consumes: `asPosting` from `lib/posting.ts` (Task 2).
- Produces: `type SearchFilters`, `type Company`, `useSearch(filters: SearchFilters | null)` (a TanStack `useInfiniteQuery`, disabled while `filters` is `null`), `useCompanies(query: string)` (a `useQuery`, enabled only once `query.trim().length >= 2`) — Task 5's `/search` page and its filter form consume both.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/lib/search-queries.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { useCompanies, useSearch } from './search-queries.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper({ children }: { children: ReactNode }): ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('useSearch', () => {
  it('does not fetch while filters is null', () => {
    const doFetch = vi.fn();
    vi.stubGlobal('fetch', doFetch);
    renderHook(() => useSearch(null), { wrapper });
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('fetches the first page and maps rows to Postings', async () => {
    const doFetch = vi.fn().mockResolvedValue(
      jsonResponse({ rows: [{ id: 'p1', title: 'Staff Engineer', company: 'Acme', url: 'https://x/p1' }], cursor: 'c2' }),
    );
    vi.stubGlobal('fetch', doFetch);

    const { result } = renderHook(() => useSearch({ q: 'engineer' }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data?.pages[0]?.rows).toEqual([
      { id: 'p1', title: 'Staff Engineer', company: 'Acme', url: 'https://x/p1', posted_at: null },
    ]);
    expect(result.current.hasNextPage).toBe(true);
    const [, init] = doFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ limit: '20', q: 'engineer' });
  });

  it('has no next page once the server sends a null cursor', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ rows: [], cursor: null }));
    vi.stubGlobal('fetch', doFetch);

    const { result } = renderHook(() => useSearch({}), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.hasNextPage).toBe(false);
  });
});

describe('useCompanies', () => {
  it('does not fetch for a query shorter than two characters', () => {
    const doFetch = vi.fn();
    vi.stubGlobal('fetch', doFetch);
    renderHook(() => useCompanies('a'), { wrapper });
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('fetches matching employers for a query of two or more characters', async () => {
    const rows = [{ id: 'c1', name: 'Acme Inc', posting_count: 12 }];
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ rows }));
    vi.stubGlobal('fetch', doFetch);

    const { result } = renderHook(() => useCompanies('acme'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(rows));
    expect(doFetch).toHaveBeenCalledWith('/api/companies?q=acme');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run lib/search-queries.test.tsx`
Expected: FAIL — `./search-queries.ts` does not exist yet.

- [ ] **Step 3: Implement `search-queries.ts`**

Create `packages/web/lib/search-queries.ts`:

```ts
'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { asPosting, type Posting } from './posting.ts';

export type SearchFilters = {
  q?: string;
  country?: string;
  workplace?: string;
  employment?: string;
  postedAfter?: string;
  company?: string;
  unjudged?: boolean;
};

export type Company = { id: string; name: string; website_domain?: string; posting_count: number };

type SearchResponse = { rows: Record<string, unknown>[]; cursor: string | null };
type SearchPage = { rows: Posting[]; cursor: string | null };

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error((data as { error?: string }).error ?? 'request failed');
  return data;
}

function searchBody(filters: SearchFilters, cursor: string | undefined): Record<string, string> {
  const body: Record<string, string> = { limit: '20' };
  const q = filters.q?.trim();
  if (q) body['q'] = q;
  if (filters.country) body['country'] = filters.country;
  if (filters.workplace) body['workplace'] = filters.workplace;
  if (filters.employment) body['employment'] = filters.employment;
  if (filters.postedAfter) body['posted_after'] = filters.postedAfter;
  if (filters.company) body['company'] = filters.company;
  if (filters.unjudged) body['unjudged'] = 'true';
  if (cursor) body['cursor'] = cursor;
  return body;
}

export function useSearch(filters: SearchFilters | null) {
  return useInfiniteQuery({
    queryKey: ['search', filters],
    queryFn: async ({ pageParam }): Promise<SearchPage> => {
      const data = await fetchJson<SearchResponse>('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchBody(filters ?? {}, pageParam as string | undefined)),
      });
      return { rows: data.rows.map(asPosting), cursor: data.cursor };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    enabled: filters !== null,
  });
}

export function useCompanies(query: string) {
  return useQuery({
    queryKey: ['companies', query],
    queryFn: () =>
      fetchJson<{ rows: Company[] }>(`/api/companies?q=${encodeURIComponent(query)}`).then((data) => data.rows),
    enabled: query.trim().length >= 2,
  });
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run lib/search-queries.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/search-queries.ts packages/web/lib/search-queries.test.tsx
git commit -m "web: add useSearch/useCompanies query hooks"
```

---

### Task 4: `/api/search` and `/api/companies` BFF routes

**Files:**
- Create: `packages/web/app/api/search/route.ts`
- Test: `packages/web/app/api/search/route.test.ts`
- Create: `packages/web/app/api/companies/route.ts`
- Test: `packages/web/app/api/companies/route.test.ts`

**Interfaces:**
- Consumes: `callAsAccount`, `PinloopServerError` from `lib/pinloop-server.ts`; `requireSession`, `withRenewedCookie` from `lib/require-session.ts` (existing, from Plan 2).
- Produces: `POST /api/search` (body: the `SearchFilters`-shaped JSON `search-queries.ts` sends → `{ rows, cursor }`) and `GET /api/companies?q=` (→ `{ rows }`) — the two endpoints Task 3's hooks already call.

- [ ] **Step 1: Write the failing tests for `/api/search`**

Create `packages/web/app/api/search/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route.ts';
import { sealSession, sessionCookieHeader } from '../../../lib/session.ts';

beforeEach(() => {
  process.env.SESSION_SECRET = 'a'.repeat(32);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function signedInRequest(body: unknown): Promise<Request> {
  const sealed = await sealSession({ accessToken: 'a1' });
  const cookie = sessionCookieHeader(sealed).split(';')[0]!;
  return new Request('http://localhost/api/search', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/search', () => {
  it('refuses a signed-out request', async () => {
    const request = new Request('http://localhost/api/search', { method: 'POST', body: '{}' });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it('forwards the filters to /search and returns rows and cursor', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ rows: [{ id: 'p1', title: 'Staff Engineer' }], cursor: 'c2' }));
    vi.stubGlobal('fetch', doFetch);

    const response = await POST(await signedInRequest({ q: 'engineer', limit: '20' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rows: [{ id: 'p1', title: 'Staff Engineer' }], cursor: 'c2' });
    const [calledPath, init] = doFetch.mock.calls[0] as [string, RequestInit];
    expect(calledPath).toContain('/search');
    expect(JSON.parse(init.body as string)).toEqual({ q: 'engineer', limit: '20' });
  });

  it('surfaces the server error on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'server unavailable' }, 500)));
    const response = await POST(await signedInRequest({}));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'server unavailable' });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run app/api/search/route.test.ts`
Expected: FAIL — `./route.ts` does not exist yet.

- [ ] **Step 3: Implement `/api/search`**

Create `packages/web/app/api/search/route.ts`:

```ts
import { PinloopServerError, callAsAccount } from '../../../lib/pinloop-server.ts';
import { requireSession, withRenewedCookie } from '../../../lib/require-session.ts';

export async function POST(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    const { json, renewedPass } = await callAsAccount(auth.pass, '/search', { method: 'POST', body });
    const asRecord = json as { rows?: unknown; cursor?: unknown; next_cursor?: unknown } | undefined;
    const rows = Array.isArray(asRecord?.rows) ? asRecord.rows : [];
    const cursor = asRecord?.cursor ?? asRecord?.next_cursor ?? null;
    return withRenewedCookie(auth.session, Response.json({ rows, cursor }), renewedPass);
  } catch (error) {
    const message = error instanceof PinloopServerError ? error.message : 'could not search';
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run app/api/search/route.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing tests for `/api/companies`**

Create `packages/web/app/api/companies/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route.ts';
import { sealSession, sessionCookieHeader } from '../../../lib/session.ts';

beforeEach(() => {
  process.env.SESSION_SECRET = 'a'.repeat(32);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function signedInRequest(url: string): Promise<Request> {
  const sealed = await sealSession({ accessToken: 'a1' });
  const cookie = sessionCookieHeader(sealed).split(';')[0]!;
  return new Request(url, { headers: { cookie } });
}

describe('GET /api/companies', () => {
  it('refuses a signed-out request', async () => {
    const response = await GET(new Request('http://localhost/api/companies?q=acme'));
    expect(response.status).toBe(401);
  });

  it('looks up employers by the q parameter and returns the rows', async () => {
    const rows = [{ id: 'c1', name: 'Acme Inc', posting_count: 12 }];
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ rows }));
    vi.stubGlobal('fetch', doFetch);

    const response = await GET(await signedInRequest('http://localhost/api/companies?q=acme'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rows });
    const [calledPath] = doFetch.mock.calls[0] as [string];
    expect(calledPath).toContain('/companies?q=acme&limit=10');
  });

  it('surfaces the server error on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'server unavailable' }, 500)));
    const response = await GET(await signedInRequest('http://localhost/api/companies?q=acme'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'server unavailable' });
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `npx vitest run app/api/companies/route.test.ts`
Expected: FAIL — `./route.ts` does not exist yet.

- [ ] **Step 7: Implement `/api/companies`**

Create `packages/web/app/api/companies/route.ts`:

```ts
import { PinloopServerError, callAsAccount } from '../../../lib/pinloop-server.ts';
import { requireSession, withRenewedCookie } from '../../../lib/require-session.ts';

export async function GET(request: Request): Promise<Response> {
  const auth = await requireSession(request);
  if ('unauthorized' in auth) return auth.unauthorized;
  const q = new URL(request.url).searchParams.get('q') ?? '';

  try {
    const query = new URLSearchParams();
    if (q.trim() !== '') query.set('q', q.trim());
    query.set('limit', '10');
    const { json, renewedPass } = await callAsAccount(auth.pass, `/companies?${query.toString()}`);
    const rows = (json as { rows?: unknown } | undefined)?.rows;
    return withRenewedCookie(auth.session, Response.json({ rows: Array.isArray(rows) ? rows : [] }), renewedPass);
  } catch (error) {
    const message = error instanceof PinloopServerError ? error.message : 'could not look up employers';
    const status = error instanceof PinloopServerError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}
```

- [ ] **Step 8: Run it to see it pass**

Run: `npx vitest run app/api/companies/route.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/web/app/api/search packages/web/app/api/companies
git commit -m "web: add /api/search and /api/companies BFF routes"
```

---

### Task 5: The `/search` page — filters, company typeahead, results, pagination

**Files:**
- Create: `packages/web/app/search/company-combobox.tsx`
- Test: `packages/web/app/search/company-combobox.test.tsx`
- Create: `packages/web/app/search/search-filters.tsx`
- Test: `packages/web/app/search/search-filters.test.tsx`
- Create: `packages/web/app/search/search-view.tsx`
- Test: `packages/web/app/search/search-view.test.tsx`
- Create: `packages/web/app/search/page.tsx`

**Interfaces:**
- Consumes: `useSearch`, `useCompanies`, `type SearchFilters`, `type Company` (Task 3); `<PostingList>` (Task 2); `Button`/`Input`/`Label`/`Badge` (Task 1); `readSession` from `lib/session.ts` (existing).
- Produces: the `/search` route, reachable from `<AppNav>`'s "Search" link (already wired in Task 1).

- [ ] **Step 1: Write the failing test for the company combobox**

Create `packages/web/app/search/company-combobox.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { CompanyCombobox } from './company-combobox.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('CompanyCombobox', () => {
  it('shows suggestions once two or more characters are typed, and adds one on click', async () => {
    const doFetch = vi.fn().mockResolvedValue(jsonResponse({ rows: [{ id: 'c1', name: 'Acme Inc', posting_count: 12 }] }));
    vi.stubGlobal('fetch', doFetch);
    const onChange = vi.fn();

    renderWithClient(<CompanyCombobox selected={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'ac' } });

    const suggestion = await screen.findByRole('button', { name: 'Acme Inc' });
    fireEvent.click(suggestion);

    expect(onChange).toHaveBeenCalledWith([{ id: 'c1', name: 'Acme Inc' }]);
  });

  it('shows a removable badge for each already-selected company', () => {
    renderWithClient(<CompanyCombobox selected={[{ id: 'c1', name: 'Acme Inc' }]} onChange={vi.fn()} />);
    expect(screen.getByText('Acme Inc')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Acme Inc' })).toBeInTheDocument();
  });

  it('removes a company when its badge remove button is clicked', () => {
    const onChange = vi.fn();
    renderWithClient(<CompanyCombobox selected={[{ id: 'c1', name: 'Acme Inc' }]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Acme Inc' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run app/search/company-combobox.test.tsx`
Expected: FAIL — `./company-combobox.tsx` does not exist yet.

- [ ] **Step 3: Implement the combobox**

Create `packages/web/app/search/company-combobox.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useCompanies, type Company } from '../../lib/search-queries.ts';
import { Input } from '../../components/ui/input.tsx';
import { Badge } from '../../components/ui/badge.tsx';

type SelectedCompany = { id: string; name: string };

export function CompanyCombobox({
  selected,
  onChange,
}: {
  selected: SelectedCompany[];
  onChange: (next: SelectedCompany[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const { data: suggestions } = useCompanies(query);

  function add(company: Company): void {
    if (!selected.some((one) => one.id === company.id)) {
      onChange([...selected, { id: company.id, name: company.name }]);
    }
    setQuery('');
    setOpen(false);
  }

  function remove(id: string): void {
    onChange(selected.filter((one) => one.id !== id));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="company-search" className="text-sm font-medium">
        Company
      </label>
      <div className="relative">
        <Input
          id="company-search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 100)}
          placeholder="Type an employer name…"
          autoComplete="off"
        />
        {open && suggestions && suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded-md border bg-card shadow-md">
            {suggestions.map((company) => (
              <li key={company.id}>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => add(company)}
                >
                  {company.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((company) => (
            <Badge key={company.id} variant="secondary" className="gap-1">
              {company.name}
              <button type="button" aria-label={`Remove ${company.name}`} onClick={() => remove(company.id)}>
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run app/search/company-combobox.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing test for the filter form**

Create `packages/web/app/search/search-filters.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { SearchFilters } from './search-filters.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('SearchFilters', () => {
  it('calls onSearch with the entered words and selected filters, omitting empty ones', () => {
    const onSearch = vi.fn();
    renderWithClient(<SearchFilters onSearch={onSearch} />);

    fireEvent.change(screen.getByLabelText('Search words'), { target: { value: 'staff engineer' } });
    fireEvent.change(screen.getByLabelText('Workplace'), { target: { value: 'remote' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(onSearch).toHaveBeenCalledWith({
      q: 'staff engineer',
      country: undefined,
      workplace: 'remote',
      employment: undefined,
      postedAfter: undefined,
      company: undefined,
      unjudged: false,
    });
  });

  it('sets unjudged to true when the checkbox is checked', () => {
    const onSearch = vi.fn();
    renderWithClient(<SearchFilters onSearch={onSearch} />);

    fireEvent.click(screen.getByLabelText(/leave out postings/i));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ unjudged: true }));
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `npx vitest run app/search/search-filters.test.tsx`
Expected: FAIL — `./search-filters.tsx` does not exist yet.

- [ ] **Step 7: Implement the filter form**

Create `packages/web/app/search/search-filters.tsx`:

```tsx
'use client';

import { type FormEvent, useState } from 'react';
import type { SearchFilters as SearchFiltersValue } from '../../lib/search-queries.ts';
import { Button } from '../../components/ui/button.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { CompanyCombobox } from './company-combobox.tsx';

const WORKPLACE_OPTIONS = ['remote', 'hybrid', 'onsite'];
const EMPLOYMENT_OPTIONS = ['full-time', 'part-time', 'contract', 'internship'];

export function SearchFilters({ onSearch }: { onSearch: (filters: SearchFiltersValue) => void }) {
  const [q, setQ] = useState('');
  const [country, setCountry] = useState('');
  const [workplace, setWorkplace] = useState('');
  const [employment, setEmployment] = useState('');
  const [postedAfter, setPostedAfter] = useState('');
  const [unjudged, setUnjudged] = useState(false);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    onSearch({
      q: q || undefined,
      country: country || undefined,
      workplace: workplace || undefined,
      employment: employment || undefined,
      postedAfter: postedAfter || undefined,
      company: companies.length > 0 ? companies.map((one) => one.id).join(',') : undefined,
      unjudged,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="search-words">Search words</Label>
        <Input
          id="search-words"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="e.g. staff engineer"
        />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="country">Country</Label>
          <Input id="country" value={country} onChange={(event) => setCountry(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="workplace">Workplace</Label>
          <select
            id="workplace"
            value={workplace}
            onChange={(event) => setWorkplace(event.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
          >
            <option value="">Any</option>
            {WORKPLACE_OPTIONS.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="employment">Employment</Label>
          <select
            id="employment"
            value={employment}
            onChange={(event) => setEmployment(event.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
          >
            <option value="">Any</option>
            {EMPLOYMENT_OPTIONS.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="posted-after">Posted after</Label>
          <Input
            id="posted-after"
            type="date"
            value={postedAfter}
            onChange={(event) => setPostedAfter(event.target.value)}
          />
        </div>
      </div>
      <CompanyCombobox selected={companies} onChange={setCompanies} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={unjudged} onChange={(event) => setUnjudged(event.target.checked)} />
        Leave out postings I&rsquo;ve already judged
      </label>
      <Button type="submit" className="self-start">
        Search
      </Button>
    </form>
  );
}
```

- [ ] **Step 8: Run it to see it pass**

Run: `npx vitest run app/search/search-filters.test.tsx`
Expected: PASS

- [ ] **Step 9: Write the failing test for the search view**

Create `packages/web/app/search/search-view.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { SearchView } from './search-view.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('SearchView', () => {
  it('shows nothing below the form until a search is submitted', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderWithClient(<SearchView />);
    expect(screen.queryByText(/no postings matched/i)).not.toBeInTheDocument();
  });

  it('runs the search on submit and renders the results', async () => {
    const doFetch = vi.fn().mockResolvedValue(
      jsonResponse({ rows: [{ id: 'p1', title: 'Staff Engineer', company: 'Acme', url: 'https://x/p1' }], cursor: null }),
    );
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<SearchView />);

    fireEvent.change(screen.getByLabelText('Search words'), { target: { value: 'engineer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('link', { name: 'Staff Engineer' })).toBeInTheDocument();
    expect(doFetch).toHaveBeenCalledWith('/api/search', expect.objectContaining({ method: 'POST' }));
  });

  it('shows the empty message when the search comes back with no rows', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ rows: [], cursor: null })));
    renderWithClient(<SearchView />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No postings matched that search.')).toBeInTheDocument();
  });

  it('fetches the next page when Load more is clicked', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ rows: [{ id: 'p1', title: 'Staff Engineer', company: 'Acme', url: 'https://x/p1' }], cursor: 'c2' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ rows: [{ id: 'p2', title: 'Senior Engineer', company: 'Beta', url: 'https://x/p2' }], cursor: null }),
      );
    vi.stubGlobal('fetch', doFetch);
    renderWithClient(<SearchView />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('link', { name: 'Staff Engineer' });
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => expect(screen.getByRole('link', { name: 'Senior Engineer' })).toBeInTheDocument());
    expect(doFetch).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 10: Run it to see it fail**

Run: `npx vitest run app/search/search-view.test.tsx`
Expected: FAIL — `./search-view.tsx` does not exist yet.

- [ ] **Step 11: Implement the search view**

Create `packages/web/app/search/search-view.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useSearch, type SearchFilters as SearchFiltersValue } from '../../lib/search-queries.ts';
import { PostingList } from '../../components/posting-list.tsx';
import { SearchFilters } from './search-filters.tsx';

export function SearchView() {
  const [filters, setFilters] = useState<SearchFiltersValue | null>(null);
  const search = useSearch(filters);
  const rows = search.data?.pages.flatMap((page) => page.rows) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Search</h1>
      <SearchFilters onSearch={setFilters} />
      {filters !== null && (
        <>
          {rows.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {rows.length} posting{rows.length === 1 ? '' : 's'} found so far
            </p>
          )}
          <PostingList
            postings={rows}
            isLoading={search.isLoading}
            isError={search.isError}
            error={search.error}
            hasNextPage={search.hasNextPage}
            isFetchingNextPage={search.isFetchingNextPage}
            onLoadMore={() => search.fetchNextPage()}
            emptyMessage="No postings matched that search."
          />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 12: Run it to see it pass**

Run: `npx vitest run app/search/search-view.test.tsx`
Expected: PASS

- [ ] **Step 13: The page itself, protected**

Create `packages/web/app/search/page.tsx`:

```tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { readSession } from '../../lib/session.ts';
import { SearchView } from './search-view.tsx';

export default async function SearchPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
  const session = await readSession(cookieHeader);
  if (!session.accessToken) redirect('/sign-in');

  return <SearchView />;
}
```

- [ ] **Step 14: Run the whole suite and build**

Run: `npx vitest run` (from the repo root)
Expected: PASS — every test in the repo, old and new.

Run: `npm run build -w packages/web`
Expected: succeeds with no type errors.

- [ ] **Step 15: Commit**

```bash
git add packages/web/app/search
git commit -m "web: add the /search page (filters, company typeahead, results, pagination)"
```

---

## Self-Review Notes

- **Spec coverage**: "Visual foundation, decided for the search/tabs/judge phase" → Task 1. The `/search` half of "Search, Tabs & Judge, in detail" (unified endpoint, no separate list mode, company typeahead backed by `/companies`, card fields, pagination via `useInfiniteQuery`, semantic search explicitly deferred) → Tasks 2–5. The `/tabs` half and the judge dialog/streaming half are explicitly out of scope for this plan (see header) and are separate follow-up plans.
- **Type consistency checked**: `Posting` (Task 2) is the type both `asPosting` (Task 2) and `useSearch`'s `SearchPage` (Task 3) use; `SearchFilters`/`Company` (Task 3) are the exact types `search-filters.tsx` and `company-combobox.tsx` (Task 5) import; `renderActions`/`actions` prop names match between `<PostingList>` and `<PostingCard>` (Task 2) and are simply never passed from `search-view.tsx` (Task 5), matching the Global Constraint that this plan wires no posting actions.
- **No placeholders**: every step above ships real, complete code — no `TBD`/"add error handling"/"similar to Task N" is used anywhere in this plan.
