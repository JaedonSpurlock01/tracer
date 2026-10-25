/**
 * -------------------------------------------------------------------------
 * @file   cost-revenue.ts
 * @brief  Computes each Workspace's monthly cost, revenue, and profit.
 *
 * @description
 *  One query service backs the Home Money row, the Workspace Overview
 *  scorecard, and the Site Deal and cost panel. For a calendar month it
 *  prices each Workspace from persisted rows and the rate table:
 *  Telephony (number rental prorated by the Number Assignment days active
 *  in the month, inbound minutes rounded up per Call, forwarded minutes
 *  rounded up from the connected duration, and Recording minutes),
 *  Processing (the cost stored with each Transcript and Lead Assessment,
 *  or the usage times the rate when none was stored), Hosting (Workers
 *  Paid plus the R2 estimate from stored Recording bytes, split evenly
 *  across the Organization's Active Workspaces), Search (rank lookups
 *  for the linked Site's Keywords in the month), and Domain (the Site's
 *  annual renewal over twelve). Revenue projects the open Deal: Monthly
 *  is its amount, Weekly is the amount times 52 over 12, and Per Lead is
 *  the amount times the month's Good Leads with Lead Review precedence.
 *  Profit is revenue minus cost and Cost per Good Lead is cost over Good
 *  Leads.
 *
 * @remarks
 *  Calls belong to the month they started in the Workspace's reporting
 *  timezone, like the Call analytics; rank days are UTC calendar days.
 *  Every category rounds to cents once so the parts add up to the total.
 *  Only Operators may read cost; the service refuses any other actor and
 *  silently drops Workspace ids outside the actor's Organization.
 *
 * @see
 *  data/pricing.ts
 *  data/deals.ts
 *  data/analytics.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Database } from "@/data/database";

import { AuthorizationError, type Actor } from "@/data/authorization";
import { connectedSecondsSql, totalSecondsSql } from "@/data/call-details";
import { callSource, effectiveClassificationSql } from "@/data/calls";
import { formGoodLeadSql, formSubmissionSource } from "@/data/form-submissions";
import type { DealRecord } from "@/data/deals";
import { projectedMonthlyRevenueCents, rates, telephonyCents, usdToCents, yearlyCents, type DealKind } from "@/data/pricing";
import { canManageWorkspaces } from "@/data/workspace-authorization";

export interface CalendarMonth {
  year: number;
  month: number;
}

export interface WorkspaceCostRevenue {
  workspaceId: string;
  telephonyCents: number;
  processingCents: number;
  hostingCents: number;
  searchCents: number;
  domainCents: number;
  costCents: number;
  revenueCents: number;
  profitCents: number;
  goodLeads: number;
  costPerGoodLeadCents: number | null;
  deal: DealRecord | null;
}

export interface CostRevenueTotals {
  costCents: number;
  yearlyCostCents: number;
  revenueCents: number;
  profitCents: number;
}

export interface CostRevenue {
  monthly(workspaceIds: string[], month: CalendarMonth): Promise<Record<string, WorkspaceCostRevenue>>;
}

const monthNames = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });

export function calendarMonth(date: Date, timeZone: string): CalendarMonth {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric" }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month") };
}

export function monthLabel(month: CalendarMonth): string {
  return monthNames.format(new Date(Date.UTC(month.year, month.month - 1, 1)));
}

function monthBounds(month: CalendarMonth): { from: string; to: string; days: number } {
  const from = new Date(Date.UTC(month.year, month.month - 1, 1));
  const to = new Date(Date.UTC(month.year, month.month, 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), days: Math.round((to.getTime() - from.getTime()) / 86_400_000) };
}

export function costRevenueTotals(rows: WorkspaceCostRevenue[]): CostRevenueTotals {
  const costCents = rows.reduce((total, row) => total + row.costCents, 0);
  const revenueCents = rows.reduce((total, row) => total + row.revenueCents, 0);
  return { costCents, yearlyCostCents: yearlyCents(costCents), revenueCents, profitCents: revenueCents - costCents };
}

type WorkspaceRow = { id: string; state: string };
type TelephonyRow = { workspace_id: string; rental_days: number; inbound_minutes: number; forwarded_minutes: number; recording_minutes: number };
type ProcessingRow = { workspace_id: string; processing_usd: string };
type LeadRow = { workspace_id: string; good_leads: number };
type SearchRow = { workspace_id: string; lookups: number; domain_renewal_cents: number | null };
type DealRow = { id: string; workspace_id: string; kind: DealKind; amount_cents: number; started_on: string; ended_on: string | null; created_at: Date; updated_at: Date };

const localMonthStart = "($2::date)::timestamp at time zone w.reporting_timezone";
const localMonthEnd = "($3::date)::timestamp at time zone w.reporting_timezone";
const callInMonth = `c.started_at >= ${localMonthStart} and c.started_at < ${localMonthEnd}`;

export function createCostRevenue(database: Database, actor: Actor): CostRevenue {
  if (!canManageWorkspaces(actor)) throw new AuthorizationError(403);
  const organizationId = actor.organizationId;

  return {
    async monthly(workspaceIds, month) {
      if (workspaceIds.length === 0) return {};
      const bounds = monthBounds(month);
      const values = [organizationId, bounds.from, bounds.to, workspaceIds];
      const [workspaces, telephony, processing, leads, search, deals, hosting] = await Promise.all([
        database.query<WorkspaceRow>("select w.id, w.state from workspace w where w.organization_id = $1 and w.id = any($2::text[])", [organizationId, workspaceIds]),
        database.query<TelephonyRow>(
          `select w.id as workspace_id,
                  coalesce((select sum(least($5::int, greatest(0,
                             ((least(coalesce(na.ended_at, ${localMonthEnd}), ${localMonthEnd}) - interval '1 second') at time zone w.reporting_timezone)::date
                             - (greatest(na.started_at, ${localMonthStart}) at time zone w.reporting_timezone)::date + 1)))
                              from number_assignment na
                             where na.workspace_id = w.id and na.organization_id = w.organization_id
                               and na.started_at < ${localMonthEnd} and (na.ended_at is null or na.ended_at > ${localMonthStart})), 0)::int as rental_days,
                  coalesce((select sum(ceil(greatest(${totalSecondsSql}, 0) / 60.0)) from call c where c.workspace_id = w.id and c.organization_id = w.organization_id and ${callInMonth}), 0)::int as inbound_minutes,
                  coalesce((select sum(ceil(greatest(${connectedSecondsSql}, 0) / 60.0)) from call c where c.workspace_id = w.id and c.organization_id = w.organization_id and ${callInMonth}), 0)::int as forwarded_minutes,
                  coalesce((select sum(ceil(greatest(r.duration_seconds, 0) / 60.0)) from recording r join call c on c.id = r.call_id and c.organization_id = r.organization_id
                             where r.workspace_id = w.id and r.organization_id = w.organization_id and ${callInMonth}), 0)::int as recording_minutes
             from workspace w
            where w.organization_id = $1 and w.id = any($4::text[])`,
          [...values, bounds.days],
        ),
        database.query<ProcessingRow>(
          `select w.id as workspace_id,
                  coalesce(sum(case when r.transcript_state = 'Completed' then coalesce(r.transcript_cost_usd, coalesce(r.transcript_audio_ms, 0) / 60000.0 * $5::numeric) else 0 end), 0)
                  + coalesce(sum(coalesce(la.cost_usd, (la.input_tokens * $6::numeric + la.output_tokens * $7::numeric) / 1000000.0)), 0) as processing_usd
             from workspace w
             join recording r on r.workspace_id = w.id and r.organization_id = w.organization_id
             join call c on c.id = r.call_id and c.organization_id = r.organization_id
             left join lead_assessment la on la.recording_id = r.id and la.organization_id = r.organization_id
            where w.organization_id = $1 and w.id = any($4::text[]) and ${callInMonth}
            group by w.id`,
          [...values, rates.openaiWhisperPerMinuteUsd, rates.openaiGpt5MiniInputPerMillionTokensUsd, rates.openaiGpt5MiniOutputPerMillionTokensUsd],
        ),
        database.query<LeadRow>(
          `select workspace_id, sum(good_leads)::int as good_leads from (
             select c.workspace_id, count(*)::int as good_leads
               from ${callSource}
              where w.organization_id = $1 and c.workspace_id = any($4::text[]) and ${callInMonth} and ${effectiveClassificationSql} = 'Good Lead'
              group by c.workspace_id
             union all
             select fs.workspace_id, count(*)::int as good_leads
               from ${formSubmissionSource}
              where w.organization_id = $1 and fs.workspace_id = any($4::text[]) and ${formGoodLeadSql}
                and fs.received_at >= ${localMonthStart} and fs.received_at < ${localMonthEnd}
              group by fs.workspace_id
           ) leads group by workspace_id`,
          values,
        ),
        database.query<SearchRow>(
          `select l.workspace_id, s.domain_renewal_cents,
                  (select count(*) from keyword_rank_day d join site_keyword k on k.id = d.site_keyword_id where k.site_id = s.id and d.day >= $2::date and d.day < $3::date)::int as lookups
             from site_link l
             join site s on s.id = l.site_id
            where l.organization_id = $1 and l.workspace_id = any($4::text[]) and l.ended_at is null`,
          values,
        ),
        database.query<DealRow>(
          "select id, workspace_id, kind, amount_cents, started_on::text as started_on, ended_on::text as ended_on, created_at, updated_at from deal where organization_id = $1 and workspace_id = any($2::text[]) and ended_on is null",
          [organizationId, workspaceIds],
        ),
        database.query<{ active_workspaces: number; stored_bytes: string }>(
          `select (select count(*) from workspace where organization_id = $1 and state = 'Active')::int as active_workspaces,
                  coalesce((select sum(coalesce(size_bytes, 0) + coalesce(mp3_size_bytes, 0)) from recording where organization_id = $1 and media_deleted_at is null and media_purged_at is null), 0)::text as stored_bytes`,
          [organizationId],
        ),
      ]);
      const activeWorkspaces = hosting.rows[0].active_workspaces;
      const hostingShareCents = activeWorkspaces > 0 ? usdToCents((rates.workersPaidMonthlyUsd + (Number(hosting.rows[0].stored_bytes) / 1e9) * rates.r2StoragePerGbMonthUsd) / activeWorkspaces) : 0;
      const telephonyByWorkspace = new Map(telephony.rows.map((row) => [row.workspace_id, row]));
      const processingByWorkspace = new Map(processing.rows.map((row) => [row.workspace_id, Number(row.processing_usd)]));
      const leadsByWorkspace = new Map(leads.rows.map((row) => [row.workspace_id, row.good_leads]));
      const searchByWorkspace = new Map(search.rows.map((row) => [row.workspace_id, row]));
      const dealsByWorkspace = new Map(deals.rows.map((row): [string, DealRecord] => [row.workspace_id, {
        id: row.id,
        workspaceId: row.workspace_id,
        kind: row.kind,
        amountCents: row.amount_cents,
        startedOn: row.started_on,
        endedOn: row.ended_on,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      }]));
      return Object.fromEntries(workspaces.rows.map((workspace): [string, WorkspaceCostRevenue] => {
        const usage = telephonyByWorkspace.get(workspace.id);
        const site = searchByWorkspace.get(workspace.id);
        const deal = dealsByWorkspace.get(workspace.id) ?? null;
        const goodLeads = leadsByWorkspace.get(workspace.id) ?? 0;
        const telephony = usage ? telephonyCents({ rentalDays: usage.rental_days, daysInMonth: bounds.days, inboundMinutes: usage.inbound_minutes, forwardedMinutes: usage.forwarded_minutes, recordingMinutes: usage.recording_minutes }) : 0;
        const processingCents = usdToCents(processingByWorkspace.get(workspace.id) ?? 0);
        const hostingCents = workspace.state === "Active" ? hostingShareCents : 0;
        const searchCents = usdToCents((site?.lookups ?? 0) * rates.dataforseoPerLookupUsd);
        const domainCents = site?.domain_renewal_cents ? Math.round(site.domain_renewal_cents / 12) : 0;
        const costCents = telephony + processingCents + hostingCents + searchCents + domainCents;
        const revenueCents = projectedMonthlyRevenueCents(deal, goodLeads);
        return [workspace.id, {
          workspaceId: workspace.id,
          telephonyCents: telephony,
          processingCents,
          hostingCents,
          searchCents,
          domainCents,
          costCents,
          revenueCents,
          profitCents: revenueCents - costCents,
          goodLeads,
          costPerGoodLeadCents: goodLeads > 0 ? Math.round(costCents / goodLeads) : null,
          deal,
        }];
      }));
    },
  };
}
