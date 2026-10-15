# Data platform operations

Tracer uses PostgreSQL 17, Drizzle migrations, Neon, and Cloudflare Hyperdrive. Migration connections are direct and exist only outside the Worker runtime. Application requests use the `tracer_app` role through Hyperdrive.

## Environment inventory

This inventory contains resource identifiers only. Credentials remain in GitHub Environment secrets, Neon, and Cloudflare.

| Path | Neon project | Neon branch | Hyperdrive | Worker | Object bindings |
| --- | --- | --- | --- | --- | --- |
| Local integration CI | Testcontainers PostgreSQL 17 | Ephemeral container | None | None | None |
| Preview | `shy-firefly-82384009` (`tracer-staging`) | `br-hidden-poetry-b7w8wc99` (`main`) | `36fd65b2679c4b739d224f1056b29070` (`tracer-preview`) | Pull-request Preview | None |
| Staging | `shy-firefly-82384009` (`tracer-staging`) | `br-hidden-poetry-b7w8wc99` (`main`) | `19a5d9e69d2a4a82b33c5d3f8cf2480f` (`tracer-staging`) | `tracer-staging` | None |
| Production | `cool-darkness-44273242` (`tracer-production`) | `br-winter-moon-b7xsmx9g` (`main`) | `c7bee152d6814904b4244700482815e2` (`tracer-production`) | `tracer`, not yet deployed to Production | None |

Preview intentionally shares the Staging Neon project but uses a separate Hyperdrive configuration. Neither non-production configuration references the Production Neon project or Hyperdrive identifier.

## Roles and secrets

Each Neon project has two database roles:

- `tracer_migration` owns the `tracer` database and applies checked-in migrations through a direct connection.
- `tracer_app` can connect and use only the Better Auth, Organization, and `workspace` tables required by runtime authentication and Workspace management plus the `twilio_connection` and `twilio_number` integration tables. It cannot create schema objects, delete users, or read the Drizzle migration journal. The migration role remains responsible for bootstrap and schema changes.

The `tracer` GitHub Environment stores non-production Cloudflare credentials, `DATABASE_MIGRATION_URL`, `DATABASE_RUNTIME_PASSWORD`, and `DATABASE_SMOKE_TOKEN`. The `Production` GitHub Environment stores separate Production values. Secret values must never be copied into repository files, logs, issues, or documentation.

## Authentication runtime bindings

The Worker uses the `HYPERDRIVE` binding for request-scoped PostgreSQL pools and the `EMAIL` send binding for Cloudflare Email Service. Wrangler environments and Previews do not inherit top-level bindings or secrets, so `env.staging` and `previews` each declare their own `EMAIL` binding and every environment needs its own copy of the secrets below (Previews through the Previews Base configuration or `wrangler preview secret put --name <preview>`). The following values are deployment secrets or environment configuration and must not be committed: `AUTH_EMAIL_FROM`, `AUTH_EMAIL_ALLOWED_RECIPIENTS`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `TWILIO_CREDENTIAL_MASTER_KEY`. The master key is a base64-encoded 32-byte value generated per environment (for example `openssl rand -base64 32`) and set with `wrangler secret put TWILIO_CREDENTIAL_MASTER_KEY --env ""` for the `tracer` Worker, `--env staging` for `tracer-staging`, and `wrangler preview base-config secret put TWILIO_CREDENTIAL_MASTER_KEY` for new pull-request Previews, which do not inherit the top-level Worker's secrets. Behind a TLS-inspecting proxy, export `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt` so Wrangler trusts the system root store instead of disabling verification. Rotating the master key makes stored Twilio ciphertext unreadable, so reconnect Twilio through the Integrations page afterwards. The Integrations page also reports whether the `R2` binding, `OPENAI_API_KEY`, and `TRIGGER_SECRET_KEY` are present; those are not consumed until their milestones. An empty or missing `AUTH_EMAIL_ALLOWED_RECIPIENTS` value disables OTP sends. Preview uses a non-production sender and an allowlisted recipient configured outside the repository.

Run the initial bootstrap only through the migration connection:

```text
pnpm auth:bootstrap --email operator@example.com --name "Example Operator" --timezone America/Chicago
```

The command requires `DATABASE_MIGRATION_URL` and prints only status and opaque identifiers. Run migrations before bootstrap. Local and Preview authentication requires the non-production secret and binding configuration above; live Preview Email Service sender and recipient validation remains an external gate. For the approved GitHub Actions database path, run the protected `Bootstrap Authentication` workflow from the approved branch, provide the initial Operator email, display name, and IANA timezone inputs, and approve the `tracer` Environment. The workflow verifies the code before applying idempotent migrations, runtime grants, and bootstrap.

## Migration path

1. Change `data/schema.ts`.
2. Run `pnpm db:generate` and review the generated SQL and metadata.
3. Run `pnpm test:integration` against a clean Testcontainers PostgreSQL 17 database in GitHub Actions.
4. Apply the migration to Staging with `pnpm db:migrate` through the `tracer` GitHub Environment.
5. Apply runtime grants with `pnpm db:grant-runtime` through the approved GitHub Environment before deploying to Staging. Rerun it whenever a migration adds tables the runtime role must reach, as the M5 integration tables did.
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
