/**
 * -------------------------------------------------------------------------
 * @file   bootstrap-initial-operator.ts
 * @brief  Runs the one-time initial Operator bootstrap command.
 *
 * @description
 *  Reads non-secret bootstrap flags, connects through the migration URL, and
 *  prints only the resulting status and opaque identifiers.
 *
 * @remarks
 *  Credentials and input email are never printed by this command.
 *
 * @see
 *  data/bootstrap-initial-operator.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { openDatabase } from "../data/database";

import { bootstrapInitialOperator } from "../data/bootstrap-initial-operator";

function requiredFlag(arguments_: Record<string, string | undefined>, name: string): string {
  const value = arguments_[name]?.trim();
  if (!value) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function parseArguments(values: string[]): Record<string, string | undefined> {
  const parsed: Record<string, string | undefined> = {};
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("Flags must use --email, --name, and --timezone");
    }
    parsed[flag.slice(2)] = value;
  }
  return parsed;
}

const connectionString = process.env.DATABASE_MIGRATION_URL;
if (!connectionString) {
  throw new Error("DATABASE_MIGRATION_URL is required");
}

const flags = parseArguments(process.argv.slice(2));
const database = openDatabase(connectionString, { max: 1 });

try {
  const result = await bootstrapInitialOperator(database, {
    email: requiredFlag(flags, "email"),
    name: requiredFlag(flags, "name"),
    timezone: requiredFlag(flags, "timezone"),
  });
  console.log(`status=${result.status} organizationId=${result.organizationId} userId=${result.userId}`);
} finally {
  await database.close();
}
