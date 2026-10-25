# Tracer

Tracer is Spurlock Labs' internal call-tracking app. It runs the phone numbers on our lead-generation sites, forwards calls to the business that owns each site, records and transcribes those calls, scores how good each lead was, and lets each business owner log in to see their own calls and reports.

There is no public sign-up. Spurlock Labs staff (Operators) set everything up and invite business owners (Client Viewers), who get read-only access to the Workspaces they are granted.

- **What it does, in detail:** [docs/SPECIFICATION.md](./docs/SPECIFICATION.md)
- **What the words mean** (Workspace, Tracking Number, Call Flow, and so on): [CONTEXT.md](./CONTEXT.md)
- **What it looks like:** [DESIGN.md](./DESIGN.md)
- **What is being built next:** [docs/IMPLEMENTATION_ROADMAP.md](./docs/IMPLEMENTATION_ROADMAP.md)
- **What changed and when:** [docs/CHANGELOG.md](./docs/CHANGELOG.md)
- **Databases, storage, and background jobs, in depth:** [docs/DATA_PLATFORM.md](./docs/DATA_PLATFORM.md)
- **Rules for coding agents:** [AGENTS.md](./AGENTS.md)

## How it fits together

| Piece | Service | What it does |
| --- | --- | --- |
| Web app | Cloudflare Workers | The website and API. One Worker per environment. |
| Database | Neon PostgreSQL, reached through Cloudflare Hyperdrive | Users, Workspaces, Calls, reports, everything that is not a file. |
| File storage | Cloudflare R2 | Call recordings, waveforms, MP3s, report files, site screenshots. Private, never public links. |
| Background jobs | Trigger.dev | Moves recordings off Twilio, makes waveforms and MP3s, transcribes, scores leads, builds reports, syncs Sites and rankings. |
| Phone calls | Twilio | The phone numbers. Tracer imports numbers you already own. |
| Transcripts and lead scores | OpenAI | Speech-to-text and the lead assessment. |
| Sign-in codes and form emails | Cloudflare Email Service | Sends the 6-digit sign-in code and forwards website form submissions. |
| Search rankings | DataForSEO | Daily keyword positions for each Site. |
| City lookup | Photon (komoot), free OpenStreetMap geocoder | Finds a Business's city and its map point in Site settings. No account or key. |

There are three places Tracer runs:

| Environment | Who uses it | Database | Recording bucket | Background jobs |
| --- | --- | --- | --- | --- |
| **Local** | You, on your computer | A Postgres container on your machine | None (fakes) | Not needed |
| **Staging** | Testing before going live; pull-request Previews share it | Neon project `tracer-staging` | `tracer-recordings-staging` | Trigger.dev **Dev**, only while `pnpm trigger:dev` runs on your computer |
| **Production** | Real clients | Neon project `tracer-production` | `tracer-recordings-production` | Trigger.dev **Production** (deployed, always on) |

Staging and Production never share a database, bucket, or key.

## Run it on your computer

You need:

- Node.js 22, and pnpm through Corepack (`corepack enable`)
- Docker or Podman, for a throwaway Postgres database
- Chromium for the browser tests: `pnpm exec playwright install chromium`
- Linux, macOS, or WSL. The Cloudflare build tool (OpenNext, see [ADR 0001](./docs/adr/0001-use-opennext-for-cloudflare-workers.md)) only partly supports Windows.

Then:

```bash
pnpm install --frozen-lockfile
docker run -d --name tracer-postgres -p 5433:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=tracer \
  docker.io/library/postgres:17-alpine
export DATABASE_MIGRATION_URL=postgresql://postgres:postgres@127.0.0.1:5433/tracer
pnpm db:migrate
pnpm auth:bootstrap --email you@example.com --name "Your Name" --timezone America/New_York
pnpm dev:local
```

Bootstrap with the email address listed in `AUTH_EMAIL_ALLOWED_RECIPIENTS` inside the `dev:local` script in `package.json`, since only that address can sign in locally.

Open `http://127.0.0.1:3000/sign-in`. Locally no email is sent; read your sign-in code from `http://127.0.0.1:3000/api/test/auth-otp`.

`pnpm dev:local` needs **no `.env` file**. It brings its own throwaway settings and turns on fakes so nothing calls a real provider:

| Switch | What it fakes |
| --- | --- |
| `E2E_AUTH_FAKE` | Sign-in emails. The code is shown at `/api/test/auth-otp` instead. |
| `E2E_CLOUDFLARE_FAKE` | The Cloudflare account. Six made-up Sites with traffic and a placeholder screenshot. |
| `E2E_DATAFORSEO_FAKE` | Search rankings. Any login works and every Keyword gets a predictable position. |
| `E2E_TWILIO_FAKE` | Twilio numbers and call webhooks (browser tests only). |
| `E2E_TRIGGER_FAKE` | Trigger.dev, so reports finish without background jobs (browser tests only). |

Every switch is ignored in Production.

Other useful local commands:

| Command | What it does |
| --- | --- |
| `pnpm verify` | Unit, component, and Worker tests, then typecheck and lint. Run before every pull request. |
| `pnpm verify:full` | Everything above plus database integration tests, browser tests, and a production build. Needs Docker and a Postgres at `127.0.0.1:5433/tracer_e2e`. |
| `pnpm test:integration` | Database tests in a throwaway Postgres container. With Podman, run `systemctl --user enable --now podman.socket` and export `DOCKER_HOST=unix:///run/user/$(id -u)/podman/podman.sock` and `TESTCONTAINERS_RYUK_DISABLED=true`. |
| `pnpm db:generate` | Creates a migration after you change `data/schema.ts`. |
| `pnpm preview` | Builds the real Cloudflare Worker and runs it locally. |
| `pnpm cf-typegen` | Regenerates Worker types from `wrangler.jsonc`. |

## Environment variables and secrets

Tracer has a lot of keys because it talks to a lot of services. The good news: **you never put them all in one file**. Each one lives in the place that uses it, and almost none of them belong on your computer.

There are five places:

1. **Cloudflare Worker secrets** - what the website itself needs. Set once per Worker with `wrangler secret put`.
2. **Trigger.dev environment variables** - what the background jobs need. Set in the Trigger.dev dashboard (Production) or in your local `.env.trigger` file (Staging).
3. **GitHub Environment secrets** - what the deploy workflows need to change the database and deploy the Worker.
4. **`.env.trigger` on your computer** - only if you want Staging background jobs to run.
5. **`.env` on your computer** - only for running maintenance commands against a real environment. Not needed for local development.

Values never go in the repository, in issues, or in chat. Templates with every name and a plain-English comment are in [.env.example](./.env.example) and [.env.trigger.example](./.env.trigger.example).

### 1. Cloudflare Worker secrets (the website)

Set each one for Production with `pnpm exec wrangler secret put <NAME>` (no `--env` flag means the Production `tracer` Worker) and for Staging with `pnpm exec wrangler secret put <NAME> --env staging`. Pull-request Previews use `pnpm exec wrangler preview base-config secret put <NAME>`. Type only the name on the command line; Wrangler then asks for the value, so it never lands in your shell history.

Add every value below as a **Secret** (the `wrangler secret put` command, or type **Secret** on the dashboard), never as a plain-text **Variable**. Each deploy replaces the Worker's plain-text variables with the ones in `wrangler.jsonc`, so a value added as a Variable disappears on the next deploy. Secrets survive deploys.

| Name | In plain English | Where to get it |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | A long random password that signs everyone's login cookie. If it changes, everyone is logged out. | Make one: `openssl rand -base64 32`. Different per environment. |
| `BETTER_AUTH_URL` | The web address people type to reach this Tracer, like `https://tracer.example.com`. | The Worker's custom domain or `workers.dev` address. |
| `AUTH_EMAIL_FROM` | The address sign-in codes come from, like `auth@spurlocklabs.com`. | Any address on a domain onboarded to Cloudflare Email Sending. |
| `AUTH_EMAIL_ALLOWED_RECIPIENTS` | A comma-separated list of every email address allowed to receive a sign-in code. **Anyone not on this list cannot sign in**, including Client Viewers you add later. Empty means nobody gets a code. | Your list of Operators and Client Viewers. |
| `TWILIO_CREDENTIAL_MASTER_KEY` | The key that locks the Twilio, Cloudflare, and DataForSEO passwords Tracer stores in its database. If it changes, you must reconnect all three on the Integrations page. | Make one: `openssl rand -base64 32`. Different per environment, and the same value must go to that environment's Trigger.dev variables. |
| `TRIGGER_SECRET_KEY` | Lets the website start background jobs. Without it, recordings stay Pending and reports are unavailable. | Trigger.dev dashboard, **API Keys** page. Production key for Production; Dev key for Staging and Previews. |
| `OPENAI_API_KEY` | Only shown as present or missing on the Integrations page; the jobs are what actually use it. Optional here. | OpenAI dashboard, project API keys. |

Staging also has `STAGING_DATABASE_SMOKE_TOKEN`, which the Deploy Staging workflow sets for you.

These are **not** secrets and are already in [wrangler.jsonc](./wrangler.jsonc), so you do nothing: the database connection (`HYPERDRIVE`), the email sender (`EMAIL`), the recording bucket (`R2`), and its name (`R2_BUCKET`).

### 2. Trigger.dev environment variables (the background jobs)

For Production, add these on the Trigger.dev dashboard, Production environment, **Environment Variables** page (or `pnpm exec trigger env set --env prod --secret <NAME> <value>`). For Staging they go in `.env.trigger` (next section).

| Name | In plain English | Where to get it |
| --- | --- | --- |
| `DATABASE_URL` | How the jobs log in to the database, as the limited `tracer_app` user. | Neon console, the environment's project, **Connect**, role `tracer_app`, database `tracer`. |
| `TWILIO_CREDENTIAL_MASTER_KEY` | Same value as the Worker secret of the same environment. | Copy it from wherever you saved it when you made it. |
| `R2_ACCOUNT_ID` | Your Cloudflare account ID. | Cloudflare dashboard, R2 overview page. |
| `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` | A username and password that can read and write **only** this environment's recording bucket. | Cloudflare dashboard, R2, **Manage API tokens**, Object Read and Write, scoped to the one bucket. |
| `R2_BUCKET` | Which bucket the jobs use. | `tracer-recordings-production` or `tracer-recordings-staging`. |
| `OPENAI_API_KEY` | Pays for transcripts and lead scores. Without it, those steps stay Pending. | OpenAI dashboard, project API keys. A separate project per environment makes costs easy to tell apart. |

The recovery sweep also uses `TRIGGER_SECRET_KEY` inside jobs; deployed Trigger.dev runs receive it automatically.

### 3. GitHub Environment secrets (the deploy workflows)

The repository has two GitHub Environments, `tracer` (Staging) and `Production`. Each holds:

| Name | In plain English |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Which Cloudflare account to deploy to. |
| `CLOUDFLARE_API_TOKEN` | Permission to deploy the Worker and set its secrets. |
| `DATABASE_MIGRATION_URL` | How to log in to the database as `tracer_migration`, the user allowed to change tables. |
| `DATABASE_RUNTIME_PASSWORD` | The `tracer_app` user's password, so the workflow can keep its permissions up to date. |
| `DATABASE_SMOKE_TOKEN` | Staging only. A random value the deploy uses to check the live database round trip. |
| `TRIGGER_ACCESS_TOKEN` | Production only. Lets the workflow upload the background job code to Trigger.dev. Get it from the Trigger.dev dashboard, your profile, **Personal Access Tokens**. |

### 4. `.env.trigger` on your computer (Staging background jobs)

Staging has no always-on job runner, because a Trigger.dev Staging environment costs extra. Instead, `pnpm trigger:dev` runs Staging's jobs on your computer while it is open. It reads `.env.trigger`, which holds the Section 2 variables pointed at **Staging** (`R2_BUCKET=tracer-recordings-staging`), plus `TRIGGER_SECRET_KEY` (the Dev key) and `DATABASE_MIGRATION_URL` for Staging. Your computer also needs `ffmpeg` and `audiowaveform` installed for MP3s and waveforms.

Copy [.env.trigger.example](./.env.trigger.example) to `.env.trigger` and fill it in.

### 5. `.env` on your computer (maintenance commands)

Only needed when you run one of these by hand against a real database:

| Command | Needs |
| --- | --- |
| `pnpm db:migrate`, `pnpm auth:bootstrap` | `DATABASE_MIGRATION_URL` |
| `pnpm db:grant-runtime` | `DATABASE_MIGRATION_URL`, `DATABASE_RUNTIME_PASSWORD` |
| `tsx scripts/configure-report-lifecycle.ts` | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (with R2 bucket settings edit) |
| `pnpm fixtures:retention` | `DATABASE_MIGRATION_URL` and the `R2_*` variables, Staging only |
| `pnpm smoke:staging-call` | `DATABASE_MIGRATION_URL`; `TWILIO_AUTH_TOKEN` for `--replay`; `STAGING_BASE_URL` optional |
| `pnpm dev` (instead of `dev:local`) | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AUTH_EMAIL_FROM`, `AUTH_EMAIL_ALLOWED_RECIPIENTS`, `TWILIO_CREDENTIAL_MASTER_KEY` |

The normal path for Staging and Production database changes is the GitHub workflows below, not your `.env`. Never put Production values in `.env`: Next.js loads it during local builds.

## Deploying

### Staging

Run the **Deploy Staging** workflow from the GitHub Actions tab and pick the branch. It applies database migrations, refreshes database permissions, builds and deploys the `tracer-staging` Worker, and checks the database round trip. A pull request labeled `smoke-staging` does the same automatically after its checks pass.

To create the first Operator on an empty Staging database, run the **Bootstrap Authentication** workflow with your email, name, and timezone. It runs the full test suite, then migrations, permissions, and the bootstrap. It is safe to rerun.

To process Staging recordings and scheduled jobs, keep `pnpm trigger:dev` running.

### Production

Production is not live yet. Getting there is the last two roadmap milestones:

- **M18 - Production Hardening and Acceptance:** prove everything on Staging (security, failure handling, accessibility, cost, rollback) and get a go or no-go decision.
- **M19 - Production Deployment and Stabilization:** set the secrets above for Production, run the **Deploy Production** workflow, run smoke checks, and watch it for the first days.

The **Deploy Production** workflow is started by hand from the Actions tab, always from `main`. It runs the tests, typecheck, and lint, applies Production migrations and database permissions, deploys the `tracer` Worker, deploys the matching Trigger.dev task version, and checks `/health`. If any step fails, the steps after it do not run.

The exact steps and checklists are in the [roadmap](./docs/IMPLEMENTATION_ROADMAP.md#phase-8---deployment-and-operation).

## When Production misbehaves

The `tracer` Worker keeps **Workers Logs** for 7 days: every request with its URL, status, duration, and Cloudflare ray, every `console` line, and every uncaught exception. Open the Cloudflare dashboard, **Workers & Pages**, the `tracer` Worker, then **Logs**. Staging logs the same way under `tracer-staging`.

Each page navigation writes one `tracer.request` line with its database timing: `dbConnectMs` (how long the first connection took), `dbQueries`, `dbWaves` (how many times the page waited on the database one step after another), `dbSlowestMs`, `dbFailed`, and `dbTimedOut`, which is true when a connection took more than 10 seconds or a query more than 30. Workers Logs stores the line as structured fields, so filter on `event = tracer.request` and sort by `durationMs` to find the slow page; `dbTimedOut = true` means the database path stalled, not the page code. The `ray` matches the `cf-ray` response header, so a slow reload in the browser can be found by its ray. API routes write the same line per request.

The Production Neon compute never pauses (set on 2026-10-24 on the Launch plan); the Staging compute still pauses after five idle minutes and takes a couple of seconds to resume. If Staging logs show `dbTimedOut` lines right after an idle gap, the connection path through Hyperdrive to the paused compute is the place to look.

### Page speed budget

One navigation opens one database runtime shared by the actor, the layouts, and the page, with six connections so queries issued together run together, and every route group paints its loading boundary at once while the page streams in, below the layout that decides authorization so a denied URL still answers with a real 404. `tests/integration/page-budgets.test.ts` replays each page's server work against a database and fails when a page exceeds its ceiling of sequential waves and total queries; lower a ceiling when a change earns it, never raise one. `tests/e2e/navigation-timing.spec.ts` reports warm second-visit server times for the main pages against a 1500 ms dev-mode ceiling and only warns until its baseline is steady.

## Project status

The [roadmap's Current state](./docs/IMPLEMENTATION_ROADMAP.md#current-state) is the single source of truth for which milestone is active.
