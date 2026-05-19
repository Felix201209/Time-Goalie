# Time Goalie

Time Goalie is a local-first planning app for turning messy intentions into a guarded week: quick capture, weekly load view, AI-assisted drafts, time blocks, reviews, and Bark/Web Push reminders.

The public repository intentionally contains only source code and project files. Local runtime data, generated builds, screenshots, installed dependencies, and secrets are excluded.

## Highlights

- Weekly planning dashboard with day load, completion, and previous/next week navigation.
- Quick capture for anything you might forget, with smart slot placement.
- 12 closed-loop templates for reading, study, projects, health, bills, follow-ups, exercise, exams, creation, errands, travel, and habits.
- AI inbox for natural language or Markdown input, with a local fallback when no API key is configured.
- Time-block planner with collision checks, drag adjustment, completion, skip, duplicate, delete, undo, and focus mode.
- Lightweight local Node backend for plan mirroring, AI proxying, reminder scheduling, ICS export, Bark, and Web Push.
- First-run setup dialog writes `.env.local` locally; API keys are not stored in frontend code.
- PWA assets and service worker are included for local-first usage.

## What Is Not In This Repo

These are deliberately ignored and should not be committed:

- `.env`, `.env.local`, and any real API/Bark keys.
- `server/data/` runtime JSON stores.
- `node_modules/`.
- `dist/` production builds.
- `test-results/` and `playwright-report/`.
- local logs, screenshots, and temporary archives.

## Quick Start

```bash
npm ci
npm run dev:full
```

Open the app at the Vite URL, usually:

```text
http://127.0.0.1:5175/
```

If port `8787` is already used, run the backend on another port:

```bash
SERVER_PORT=8797 VITE_PORT=5175 npm run dev:full
```

## Configuration

Copy the example env file if you want to configure manually:

```bash
cp .env.example .env.local
```

Or use the first-run setup dialog inside the app.

Supported local environment variables:

```bash
AI_API_KEY=
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
SERVER_PORT=8787
BARK_KEY=
BARK_SERVER=https://api.day.app
```

## Verification

```bash
npm run format:check
npm run verify
npm run test:e2e
```

`npm run verify` runs lint, unit tests, and a production build.

## Architecture

- `src/` - React UI, planning logic, hooks, components, storage helpers.
- `server/` - local backend, AI parsing proxy, reminder scheduler, Bark/Web Push, ICS export.
- `public/` - manifest, icons, favicon, service worker.
- `tests/e2e/` - Playwright smoke flow for the closed-loop path.
- `scripts/dev-full.mjs` - starts frontend and backend together.
- `scripts/sync-public.mjs` - allowlist sync into the clean public GitHub repo.

## Local Data Model

Frontend planning data is kept in browser `localStorage` under `time-goalie.plan.v1`.

Backend runtime data is stored under `server/data/` in local development. That folder is ignored because it may contain private plans, reminder logs, and local push subscriptions.

## Public Repo Hygiene

Before publishing, sync and verify the git tree:

```bash
npm run public:sync
npm run public:audit
```

The sync allowlist keeps source, tests, docs, and public assets only. It should
not include `server/data`, `dist`, `node_modules`, `.env.local`, screenshots,
Playwright reports, logs, or archives.
