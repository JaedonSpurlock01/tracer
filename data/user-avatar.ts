/**
 * -------------------------------------------------------------------------
 * @file   user-avatar.ts
 * @brief  Reads the avatar seed for a user.
 *
 * @description
 *  Looks up the user's stored image and derives the avatar seed the
 *  Sidebar shows, falling back to the user id when no image is stored.
 *
 * @see
 *  data/avatar.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Queryable } from "@/data/database";

import { avatarSeedFromImage } from "@/data/avatar";

export async function findUserAvatarSeed(connection: Queryable, userId: string): Promise<string> {
  const { rows } = await connection.query<{ image: string | null }>(`select image from "user" where id = $1 limit 1`, [userId]);
  return avatarSeedFromImage(rows[0]?.image ?? undefined, userId);
}
