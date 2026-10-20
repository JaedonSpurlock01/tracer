/**
 * -------------------------------------------------------------------------
 * @file   seed-retention-fixtures.ts
 * @brief  Seeds, verifies, or removes the backdated retention fixture Calls on Staging.
 *
 * @description
 *  Usage: pnpm fixtures:retention --organization <id> --workspace <id> [--verify | --remove]
 *  Without a mode it seeds the `expired`, `expired-pending`, and `fresh`
 *  fixture Calls into the Workspace and uploads their placeholder R2
 *  objects, skipping any fixture that already exists. `--verify` prints,
 *  for each fixture, whether its cleanup is finished, unfinished, retained,
 *  or missing and what remains, and exits 1 when R2 and PostgreSQL
 *  disagree. `--remove` deletes the fixture objects and rows.
 *
 * @remarks
 *  Requires DATABASE_MIGRATION_URL for the target database and the
 *  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET
 *  object token the tasks use. It refuses the Production bucket and any
 *  non-loopback database unless R2_BUCKET is the Staging bucket.
 *  Credentials, caller numbers, and Twilio SIDs are never printed.
 *
 * @see
 *  data/retention-fixtures.ts
 *  docs/DATA_PLATFORM.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { parseArgs } from "node:util";

import pg from "pg";

import { createR2RecordingObjects } from "../data/r2-objects";
import { createRetentionFixtures } from "../data/retention-fixtures";

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const { values } = parseArgs({
  options: {
    organization: { type: "string" },
    workspace: { type: "string" },
    verify: { type: "boolean", default: false },
    remove: { type: "boolean", default: false },
  },
});
if (!values.organization || !values.workspace) throw new Error("--organization and --workspace are required");
if (values.verify && values.remove) throw new Error("Choose one of --verify or --remove");

const databaseUrl = requireEnvironment("DATABASE_MIGRATION_URL");
const bucket = requireEnvironment("R2_BUCKET");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

try {
  const fixtures = createRetentionFixtures({
    databaseUrl,
    bucket,
    pool,
    objects: createR2RecordingObjects({
      accountId: requireEnvironment("R2_ACCOUNT_ID"),
      accessKeyId: requireEnvironment("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnvironment("R2_SECRET_ACCESS_KEY"),
      bucket,
    }),
    organizationId: values.organization,
    workspaceId: values.workspace,
  });
  console.log(`environment=${fixtures.environment} bucket=${bucket}`);
  if (values.remove) {
    const removed = await fixtures.remove();
    console.log(`removed calls=${removed.calls} objects=${removed.objects}`);
  } else if (values.verify) {
    const report = await fixtures.verify();
    for (const fixture of report) {
      console.log(`${fixture.agrees ? "ok" : "DISAGREE"} fixture=${fixture.fixture} call=${fixture.callId} status=${fixture.status} remaining=${fixture.remaining.length ? fixture.remaining.join(", ") : "-"}`);
    }
    if (report.some((fixture) => !fixture.agrees)) process.exitCode = 1;
  } else {
    for (const fixture of await fixtures.seed(new Date())) {
      console.log(`fixture=${fixture.fixture} call=${fixture.callId} ${fixture.created ? "created" : "already exists"}`);
    }
  }
} finally {
  await pool.end();
}
