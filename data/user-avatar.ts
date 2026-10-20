/**
 * -------------------------------------------------------------------------
 * @file   user-avatar.ts
 * @brief  Reads a user's chosen avatar seed for the application shell.
 *
 * @description
 *  Loads the user's stored `image` value and resolves it to a validated
 *  Gaze seed, so the shell draws the face the user picked in Account
 *  Settings.
 *
 * @remarks
 *  Kept apart from the Actor: the avatar is presentation, not an
 *  authorization fact. A missing user or an unrecognized value resolves to
 *  the user id, the original default seed.
 *
 * @see
 *  data/avatar.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";

import { avatarSeedFromImage } from "@/data/avatar";
import { users } from "@/data/schema";

export async function findUserAvatarSeed(connection: Pool | PoolClient, userId: string): Promise<string> {
  const [row] = await drizzle(connection).select({ image: users.image }).from(users).where(eq(users.id, userId)).limit(1);
  return avatarSeedFromImage(row?.image, userId);
}
