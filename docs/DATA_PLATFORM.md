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
- `tracer_app` can connect, use the `public` schema, and `SELECT` or `INSERT` the `organization` table. It cannot create schema objects, update or delete Organizations, or read the Drizzle migration journal.

The `tracer` GitHub Environment stores non-production Cloudflare credentials, `DATABASE_MIGRATION_URL`, `DATABASE_RUNTIME_PASSWORD`, and `DATABASE_SMOKE_TOKEN`. The `Production` GitHub Environment stores separate Production values. Secret values must never be copied into repository files, logs, issues, or documentation.

## Migration path

1. Change `data/schema.ts`.
2. Run `pnpm db:generate` and review the generated SQL and metadata.
3. Run `pnpm test:integration` against a clean Testcontainers PostgreSQL 17 database in GitHub Actions.
4. Apply the migration to Staging with `pnpm db:migrate` through the `tracer` GitHub Environment.
5. Run the `Verification` workflow manually. Its Staging gate reapplies migrations as a no-op, deploys `tracer-staging`, and performs the protected transactional read/write smoke check through Hyperdrive.
6. Before Production promotion, run `verify:full`, review the SQL, rehearse it in Staging, and apply it through the `Production` GitHub Environment.

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
