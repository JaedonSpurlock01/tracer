/**
 * -------------------------------------------------------------------------
 * @file   identity-administration.ts
 * @brief  Exposes transactional identity administration operations.
 *
 * @description
 *  Disables a user and revokes every existing session in one transaction.
 *
 * @remarks
 *  This interface is intentionally ordinary application surface for later
 *  Operator administration flows.
 *
 * @see
 *  CONTEXT.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Database } from "@/data/database";

export interface IdentityAdministration {
  disable(userId: string): Promise<void>;
}

export function createIdentityAdministration(connection: Database): IdentityAdministration {
  return {
    async disable(userId) {
      await connection.transaction(async (client) => {
        await client.query(`update "user" set state = 'Disabled', updated_at = now() where id = $1`, [userId]);
        await client.query(`delete from session where user_id = $1`, [userId]);
      });
    },
  };
}
