/**
 * -------------------------------------------------------------------------
 * @file   runtime-role.ts
 * @brief  Applies least-privilege PostgreSQL runtime grants.
 *
 * @description
 *  Creates or rotates Tracer's application role and limits it to the
 *  authentication and Organization operations required at runtime.
 *
 * @remarks
 *  The password format is validated before it is interpolated into role SQL.
 *
 * @see
 *  data/organization-repository.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Client, Pool } from "pg";

export const runtimeRole = "tracer_app";

export async function provisionRuntimeRole(
  connection: Client | Pool,
  password: string,
): Promise<void> {
  if (!/^[A-F0-9]{64}$/.test(password)) {
    throw new Error("Runtime role password must be a 32-byte hexadecimal value");
  }

  await connection.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await connection.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${runtimeRole}') THEN
        CREATE ROLE ${runtimeRole} LOGIN;
      END IF;
    END
    $$
  `);
  await connection.query(`ALTER ROLE ${runtimeRole} PASSWORD '${password}'`);

  const result = await connection.query<{ database: string }>(
    "select current_database() as database",
  );
  const database = result.rows[0]?.database;

  if (!database || !/^[a-zA-Z0-9_]+$/.test(database)) {
    throw new Error("Current database name cannot be used in a role grant");
  }

  await connection.query(`GRANT CONNECT ON DATABASE "${database}" TO ${runtimeRole}`);
  await connection.query(`GRANT USAGE ON SCHEMA public TO ${runtimeRole}`);
  await connection.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${runtimeRole}`);
  await connection.query(`GRANT SELECT, INSERT, UPDATE ON TABLE public.organization TO ${runtimeRole}`);
  await connection.query(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public.session,
      public.account,
      public.verification,
      public.member,
      public.invitation,
      public.twilio_connection,
      public.twilio_number,
      public.cloudflare_connection,
      public.dataforseo_connection
    TO ${runtimeRole}
  `);
  await connection.query(`
    GRANT SELECT, INSERT, UPDATE ON TABLE
      public.site,
      public.site_hostname,
      public.site_link,
      public.site_metric_day,
      public.site_deployment,
      public.site_check,
      public.site_preview,
      public.site_keyword,
      public.keyword_rank_day,
      public.deal
    TO ${runtimeRole}
  `);
  await connection.query(`GRANT SELECT, INSERT, UPDATE ON TABLE public.workspace TO ${runtimeRole}`);
  await connection.query(`GRANT SELECT, INSERT, UPDATE ON TABLE public.number_assignment, public.flow_version TO ${runtimeRole}`);
  await connection.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.call_flow_draft TO ${runtimeRole}`);
  await connection.query(`GRANT SELECT, INSERT, DELETE ON TABLE public.access_grant TO ${runtimeRole}`);
  await connection.query(`GRANT SELECT, INSERT, UPDATE ON TABLE public.call TO ${runtimeRole}`);
  await connection.query(`GRANT SELECT, INSERT ON TABLE public.provider_event TO ${runtimeRole}`);
  await connection.query(`GRANT SELECT, INSERT, UPDATE ON TABLE public.recording TO ${runtimeRole}`);
  await connection.query(`GRANT SELECT, INSERT, DELETE ON TABLE public.transcript, public.lead_assessment_evidence TO ${runtimeRole}`);
  await connection.query(`GRANT SELECT, INSERT ON TABLE public.lead_assessment TO ${runtimeRole}`);
  await connection.query(`GRANT UPDATE (rationale) ON TABLE public.lead_assessment TO ${runtimeRole}`);
  await connection.query(`GRANT SELECT, INSERT, UPDATE ON TABLE public.lead_review TO ${runtimeRole}`);
  await connection.query(`GRANT SELECT, INSERT ON TABLE public.call_event TO ${runtimeRole}`);
  await connection.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.report_job TO ${runtimeRole}`);
  await connection.query(`GRANT SELECT, INSERT ON TABLE public.report_artifact TO ${runtimeRole}`);
  await connection.query(`GRANT SELECT, INSERT, UPDATE ON TABLE public.form_submission TO ${runtimeRole}`);
  await connection.query(`GRANT SELECT, INSERT, UPDATE ON TABLE public."user" TO ${runtimeRole}`);
  await connection.query(`REVOKE CREATE ON SCHEMA public FROM ${runtimeRole}`);
}
