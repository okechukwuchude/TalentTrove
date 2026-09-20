# TalentTrove

TalentTrove is a job search web app. It holds a large collection of
frequently updated job postings, keeps your resume and other profile
documents, and calls AI models to judge postings against what it knows
about you — then tailors a resume and cover letter for the ones worth
applying to.

## Structure

This is an npm workspaces monorepo:

- `packages/web` — the Next.js web app: sign-in, profile, search, tabs,
  routines, judging, tailoring, and applying. See
  [`packages/web/README.md`](packages/web/README.md) for environment
  variables, running the app locally, and the database-backed test setup.
- `packages/shared` — logic shared between the web app's server-side route
  handlers and its client-side components (the reserved profile-document
  registry and default judge prompts, the coverage-fraction convention, and
  verdict wording), so neither side keeps its own copy.

## Run it locally

Needs Node 22 or newer.

```
npm install
npm run build -w packages/shared
npm run dev -w packages/web
```

See [`packages/web/README.md`](packages/web/README.md) for the environment
variables the app needs (database, session secret, postings ingestion,
judging, and resume tailoring).

## Deploy

The web app is meant to be deployed on Vercel (`packages/web/vercel.json`
configures the scheduled ingestion/judging/tailoring cron routes).

## License

MIT. See [LICENSE](LICENSE).
