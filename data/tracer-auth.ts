/**
 * -------------------------------------------------------------------------
 * @file   tracer-auth.ts
 * @brief  Creates the configured Better Auth instance for Tracer.
 *
 * @description
 *  Builds an injectable authentication service with Drizzle, passwordless
 *  email OTP, and Organization membership support.
 *
 * @remarks
 *  The factory keeps database and provider boundaries request-testable.
 *  Better Auth's session cookie cache is on for 60 seconds so a navigation
 *  does not read the session from the database every time; a user set to
 *  Disabled keeps a working session for at most that minute, which the
 *  Product Owner accepted on 2026-10-24 for an internal tool.
 *
 * @see
 *  docs/adr/0003-map-better-auth-membership-roles-to-canonical-roles.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP, organization } from "better-auth/plugins";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import { decideEmailCodeRequest, normalizeIdentityEmail, type UserState } from "@/data/auth-policy";
import { schema, users } from "@/data/schema";
import { isAllowedRecipient, sendSignInCode, type TransactionalEmail } from "@/data/transactional-email";

const safeAuthenticationError = "Unable to sign in with these credentials.";

/** How long a signed session copy in the cookie is trusted before the database is read again. */
export const sessionCookieCacheSeconds = 60;

export interface TracerAuthOptions {
  database: NodePgDatabase<typeof schema>;
  email: TransactionalEmail;
  emailFrom: string;
  allowedRecipients: ReadonlySet<string>;
  backgroundTask?: (promise: Promise<unknown>) => void;
  secret?: string;
  baseURL?: string;
}

export function createTracerAuth(options: TracerAuthOptions) {
  const database = options.database;

  return betterAuth({
    secret: options.secret ?? process.env.BETTER_AUTH_SECRET,
    baseURL: options.baseURL ?? process.env.BETTER_AUTH_URL,
    database: drizzleAdapter(database, { provider: "pg", schema }),
    user: {
      additionalFields: {
        state: {
          type: "string",
          required: false,
          defaultValue: "Provisioned",
          input: false,
        },
        timezone: {
          type: "string",
          required: false,
          defaultValue: "UTC",
          input: true,
        },
      },
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
      validateUserInfo: async ({ user }) => {
        const email = normalizeIdentityEmail(user.email ?? "");
        const [existing] = await database
          .select({ state: users.state })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (!existing || existing.state === "Disabled") {
          return { error: "authentication_denied", errorDescription: safeAuthenticationError };
        }
      },
    },
    emailAndPassword: { enabled: false },
    session: { cookieCache: { enabled: true, maxAge: sessionCookieCacheSeconds } },
    databaseHooks: {
      user: {
        delete: { before: async () => false },
      },
      session: {
        create: {
          before: async (session) => {
            const [user] = await database
              .select({ state: users.state })
              .from(users)
              .where(eq(users.id, session.userId))
              .limit(1);
            return user?.state === "Disabled" ? false : true;
          },
          after: async (session) => {
            await database
              .update(users)
              .set({ state: "Active", lastSignInAt: new Date(), updatedAt: new Date() })
              .where(eq(users.id, session.userId));
          },
        },
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        storeOTP: "hashed",
        disableSignUp: true,
        sendVerificationOnSignUp: false,
        async sendVerificationOTP(data) {
          const [user] = await database
            .select({ state: users.state })
            .from(users)
            .where(eq(users.email, normalizeIdentityEmail(data.email)))
            .limit(1);
          const decision = decideEmailCodeRequest((user?.state as UserState | undefined) ?? null);
          if (!decision.send || !isAllowedRecipient(options.allowedRecipients, data.email)) {
            return;
          }
          const sendPromise = sendSignInCode(options.email, {
            to: data.email,
            from: options.emailFrom,
            code: data.otp,
          });
          if (options.backgroundTask) {
            options.backgroundTask(sendPromise);
            return;
          }
          await sendPromise;
        },
      }),
      organization({
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
      }),
    ],
  });
}

export type TracerAuth = ReturnType<typeof createTracerAuth>;

export { safeAuthenticationError };
