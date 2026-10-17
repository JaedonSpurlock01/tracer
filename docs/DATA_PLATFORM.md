# Data platform operations

Tracer uses PostgreSQL 17, Drizzle migrations, Neon, and Cloudflare Hyperdrive. Migration connections are direct and exist only outside the Worker runtime. Application requests use the `tracer_app` role through Hyperdrive.

## Environment inventory

This inventory contains resource identifiers only. Credentials remain in GitHub Environment secrets, Neon, and Cloudflare.

| Path | Neon project | Neon branch | Hyperdrive | Worker | Object bindings |
| --- | --- | --- | --- | --- | --- |
| Local integration CI | Testcontainers PostgreSQL 17 | Ephemeral container | None | None | None |
| Preview | `shy-firefly-82384009` (`tracer-staging`) | `br-hidden-poetry-b7w8wc99` (`main`) | `36fd65b2679c4b739d224f1056b29070` (`tracer-preview`) | Pull-request Preview | None |
| Staging | `shy-firefly-82384009` (`tracer-staging`) | `br-hidden-poetry-b7w8wc99` (`main`) | `19a5d9e69d2a4a82b33c5d3f8cf2480f` (`tracer-staging`) | `tracer-staging` | None |
| Production | `cool-darkness-44273242` (`tracer-production`) | `br-winter-moon-b7xsmx9g` (`main`) | `c7bee152d6814904b4244700482815e2` (`tracer-production`) | `tracer`, not yet deployed to Production | `R2`: `tracer-recordings-production` |

Preview intentionally shares the Staging Neon project but uses a separate Hyperdrive configuration. Because Preview shares the Staging database, it also shares the Staging Recording bucket and Trigger.dev environment. Neither non-production configuration references the Production Neon project, Hyperdrive identifier, or Recording bucket.

## Roles and secrets

Each Neon project has two database roles:

- `tracer_migration` owns the `tracer` database and applies checked-in migrations through a direct connection.
- `tracer_app` can connect and use only the Better Auth, Organization, and `workspace` tables required by runtime authentication and Workspace management plus the `twilio_connection`, `twilio_number`, `number_assignment`, `call_flow_draft`, and `flow_version` integration tables and the `access_grant` table. Access Grants receive SELECT, INSERT, and DELETE but no UPDATE, because a grant is created or removed, never edited. The `call` table receives SELECT, INSERT, and UPDATE but no DELETE, because Calls advance through their lifecycle but are never removed by the application. The `provider_event` table receives only SELECT and INSERT, because accepted and rejected Twilio webhook events are an append-only diagnostic record. The `recording` table receives SELECT, INSERT, and UPDATE but no DELETE, because a Recording advances through its transfer and Twilio cleanup states but is never removed by the application. It cannot create schema objects, delete users, or read the Drizzle migration journal. The migration role remains responsible for bootstrap and schema changes.

The `tracer` GitHub Environment stores non-production Cloudflare credentials, `DATABASE_MIGRATION_URL`, `DATABASE_RUNTIME_PASSWORD`, and `DATABASE_SMOKE_TOKEN`. The `Production` GitHub Environment stores separate Production values. Secret values must never be copied into repository files, logs, issues, or documentation.

## Authentication runtime bindings

The Worker uses the `HYPERDRIVE` binding for request-scoped PostgreSQL pools and the `EMAIL` send binding for Cloudflare Email Service. Wrangler environments and Previews do not inherit top-level bindings or secrets, so `env.staging` and `previews` each declare their own `EMAIL` binding and every environment needs its own copy of the secrets below (Previews through the Previews Base configuration or `wrangler preview secret put --name <preview>`). The following values are deployment secrets or environment configuration and must not be committed: `AUTH_EMAIL_FROM`, `AUTH_EMAIL_ALLOWED_RECIPIENTS`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `TWILIO_CREDENTIAL_MASTER_KEY`. The master key is a base64-encoded 32-byte value generated per environment (for example `openssl rand -base64 32`) and set with `wrangler secret put TWILIO_CREDENTIAL_MASTER_KEY --env ""` for the `tracer` Worker, `--env staging` for `tracer-staging`, and `wrangler preview base-config secret put TWILIO_CREDENTIAL_MASTER_KEY` for new pull-request Previews, which do not inherit the top-level Worker's secrets. Behind a TLS-inspecting proxy, export `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt` so Wrangler trusts the system root store instead of disabling verification. Rotating the master key makes stored Twilio ciphertext unreadable, so reconnect Twilio through the Integrations page afterwards. The Integrations page also reports whether the `R2` binding, `OPENAI_API_KEY`, and `TRIGGER_SECRET_KEY` are present; `OPENAI_API_KEY` is not consumed until its milestone, and the `R2` binding and `TRIGGER_SECRET_KEY` are described under Recording media access and Recording processing runtime. An empty or missing `AUTH_EMAIL_ALLOWED_RECIPIENTS` value disables OTP sends. Preview uses a non-production sender and an allowlisted recipient configured outside the repository.

Run the initial bootstrap only through the migration connection:

```text
pnpm auth:bootstrap --email operator@example.com --name "Example Operator" --timezone America/Chicago
```

The command requires `DATABASE_MIGRATION_URL` and prints only status and opaque identifiers. Run migrations before bootstrap. Local and Preview authentication requires the non-production secret and binding configuration above; live Preview Email Service sender and recipient validation remains an external gate. For the approved GitHub Actions database path, run the protected `Bootstrap Authentication` workflow from the approved branch, provide the initial Operator email, display name, and IANA timezone inputs, and approve the `tracer` Environment. The workflow verifies the code before applying idempotent migrations, runtime grants, and bootstrap.

## Recording media access

The Worker reads Recording audio only through the `R2` R2 bucket binding. Each environment declares its own binding and its own `R2_BUCKET` variable naming the bound bucket, which the Integrations page shows: the top-level `tracer` Worker binds `tracer-recordings-production`, and `env.staging` and `previews` bind `tracer-recordings-staging`. Both buckets are private, with no public or `r2.dev` access, and Tracer never issues presigned or public object URLs.

`GET /api/workspaces/{workspaceId}/recordings/{recordingId}/audio` is the only read path for Recording media. On every request it requires an Active session, authorizes the Workspace through `data/workspace-authorization.ts` (an Operator of the Workspace's Organization, or a Client Viewer holding a current Access Grant to an Active or Archived Workspace), and then loads the Recording scoped to that Organization and Workspace with `transfer_state` `Stored`. An unauthenticated request receives `401`. An ungranted, revoked, cross-Organization, not-yet-Stored, or missing-object request receives the same `404` `not_found` response as any other unreadable Workspace, so Recordings cannot be discovered. The response streams `audio/wav` with `cache-control: private, no-store` and honors one HTTP `Range` per request with `206` and `Content-Range`, or `416` when the range is unsatisfiable. The object key is never logged or returned.

## Recording processing runtime

Recording transfer runs in Trigger.dev Cloud project `proj_tdulgcojxncuxbsettnq`, configured by `trigger.config.ts` with tasks in `trigger/`. The Worker does not import the Trigger.dev SDK; it triggers the `recording-transfer` task through the Trigger.dev REST API with the `TRIGGER_SECRET_KEY` Worker secret, and the key selects the Trigger.dev environment. Without the secret the Worker still accepts Recording callbacks and leaves each Recording Pending. Each trigger request sets a 7-day queue TTL, matching the recovery sweep window, so a queued run waits instead of expiring after the Trigger.dev Dev environment's 10-minute default.

| Tracer environment | Trigger.dev environment | `TRIGGER_SECRET_KEY` | Task environment variables |
| --- | --- | --- | --- |
| Preview | Dev | The Dev environment's secret key | The local `.env.trigger` file |
| Staging | Dev | The Dev environment's secret key | The local `.env.trigger` file |
| Production | Production | A Production secret key | The Trigger.dev dashboard Environment Variables page, or `pnpm exec trigger env set --env prod --secret <name> <value>` |

Tracer Staging and Preview use the Trigger.dev Dev environment because additional Trigger.dev environments require a paid plan. Dev runs execute only while `pnpm trigger:dev` is running on a developer machine; it starts the pinned Trigger.dev CLI with `--env-file .env.trigger`. The `.env.trigger` file is ignored by Git and must point at the Staging database through the runtime role, the Staging Twilio master key, and the `tracer-recordings-staging` bucket token. While no dev session runs, Staging and Preview Recordings stay queued for up to 7 days, and the 12-hour recovery sweep, which also fires only while the dev session runs, re-requests any that remain Pending or Failed. Set the Worker secret with `wrangler secret put TRIGGER_SECRET_KEY --env ""` for the `tracer` Worker using a Production key, and with `--env staging` for `tracer-staging` and `wrangler preview base-config secret put TRIGGER_SECRET_KEY` for Previews using the Dev environment's secret key, each taken from the Trigger.dev API Keys page of the matching environment.

The tasks run outside the Worker bindings, so each Trigger.dev environment needs these environment variables, never committed:

- `DATABASE_URL`: a Neon connection string for the `tracer_app` runtime role in the environment's Neon project. The transfer task reads `recording` and `twilio_connection` and updates `recording`, all covered by the runtime grants.
- `TWILIO_CREDENTIAL_MASTER_KEY`: the same master key as the environment's Worker, used to decrypt the Organization Twilio API key secret.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: an R2 API token with Object Read and Write scoped to the environment's bucket only.
- `R2_BUCKET`: `tracer-recordings-staging` for the Dev environment that serves Staging and Preview, and `tracer-recordings-production` for Production.

The `recording-recovery-sweep` scheduled task runs every 12 hours and re-requests processing through the same REST API, so it also needs `TRIGGER_SECRET_KEY` in its run environment. Deploy Production tasks with the Trigger.dev CLI only through an approved deployment step.

## Migration path

1. Change `data/schema.ts`.
2. Run `pnpm db:generate` and review the generated SQL and metadata.
3. Run `pnpm test:integration` against a clean Testcontainers PostgreSQL 17 database in GitHub Actions.
4. Apply the migration to Staging with `pnpm db:migrate` through the `tracer` GitHub Environment.
5. Apply runtime grants with `pnpm db:grant-runtime` through the approved GitHub Environment before deploying to Staging. Rerun it whenever a migration adds tables the runtime role must reach, as the M5 integration tables and the M11 `recording` table did.
6. Run the `Verification` workflow manually. Its Staging gate reapplies migrations as a no-op, deploys `tracer-staging`, and performs the protected transactional read/write smoke check through Hyperdrive.
7. Before Production promotion, run `verify:full`, review the SQL, rehearse it in Staging, and apply it through the `Production` GitHub Environment.

The current Windows environment cannot run Docker, so Testcontainers integration suites run on GitHub Actions. Other Local environments may run `pnpm test:integration` when a Docker-compatible daemon is available.

## Forward recovery

Migrations are forward-only. Tracer does not maintain hand-written down migrations.

When a migration fails before commit:

1. Stop promotion and keep the affected milestone or deployment blocked.
2. Diagnose the failed SQL without editing an already-applied migration.
3. Generate a new corrective migration.
4. Prove the correction against a clean Testcontainers database and Staging.
5. Resume promotion only after the normal verification gate passes.

When an applied migration causes data corruption:

1. Stop writes and promotion for the affected environment.
2. Preserve the failed database for diagnosis.
3. Restore the Neon project to a point-in-time or recovery branch from before the migration.
4. Validate schema, Organization reads, and Organization writes through an isolated Hyperdrive configuration.
5. Switch the affected environment binding only after validation.
6. Record a Staging or Production promotion, rollback, or recovery in `docs/CHANGELOG.md`.

Production restore or binding changes are destructive operational actions and require explicit approval at execution time.
