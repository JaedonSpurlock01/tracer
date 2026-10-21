/**
 * -------------------------------------------------------------------------
 * @file   site-health.ts
 * @brief  Derives a Site's health from its stored sync rows.
 *
 * @description
 *  Exposes the Site Health values and the derivation that every Site read
 *  uses: Unknown before the first sync or without an uptime check, Down
 *  after two consecutive failed checks, Warning when a hostname has no
 *  active certificate, Worker errors exceed 5 percent of requests over the
 *  last 24 hours, or a Site that had visits in the prior 7 days has had
 *  none for 48 hours, and Healthy otherwise. The description also carries
 *  the one-sentence reason shown next to a Warning or Down Badge.
 *
 * @remarks
 *  The derivation is pure so the same rules serve the Workspaces grid, the
 *  Site page, Workspace Overview, and the Cloudflare card. Checks arrive
 *  newest first and only the two newest decide Down, so one failed probe
 *  never flips a Site. Callers pass only hostnames that still belong to the
 *  Site: discovery marks a hostname that left Cloudflare as disabled instead
 *  of deleting it, so a disabled row means gone rather than inactive.
 *  Down wins over every Warning, and the certificate reason wins over
 *  errors and visits because it is the one an Operator can fix directly.
 *
 * @see
 *  docs/IMPLEMENTATION_ROADMAP.md
 *  data/site-health-query.ts
 *  data/sites.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export const siteHealthValues = ["Healthy", "Warning", "Down", "Unknown"] as const;

export type SiteHealth = (typeof siteHealthValues)[number];

export interface SiteHealthCheck {
  checkedAt: string;
  ok: boolean;
}

export interface SiteHealthHostname {
  enabled: boolean;
  certificateId: string | null;
}

export interface SiteHealthInput {
  lastSyncedAt: string | null;
  checks: SiteHealthCheck[];
  hostnames: SiteHealthHostname[];
  requests24h: number;
  errors24h: number;
  visitsPrior7d: number;
  visitsLast48h: number;
}

export interface SiteHealthDescription {
  health: SiteHealth;
  reason: string | null;
}

export const siteHealthErrorRateThreshold = 0.05;

export function describeSiteHealth(input: SiteHealthInput): SiteHealthDescription {
  if (input.lastSyncedAt === null || input.checks.length === 0) return { health: "Unknown", reason: null };
  if (input.checks.length >= 2 && !input.checks[0].ok && !input.checks[1].ok) return { health: "Down", reason: "Two consecutive checks failed" };
  if (input.hostnames.some((hostname) => !hostname.enabled || hostname.certificateId === null)) {
    return { health: "Warning", reason: "A hostname has no active certificate" };
  }
  if (input.requests24h > 0 && input.errors24h / input.requests24h > siteHealthErrorRateThreshold) {
    return { health: "Warning", reason: "Worker errors above 5% in the last 24 hours" };
  }
  if (input.visitsPrior7d > 0 && input.visitsLast48h === 0) return { health: "Warning", reason: "No visits for 48 hours" };
  return { health: "Healthy", reason: null };
}

export function siteHealth(input: SiteHealthInput): SiteHealth {
  return describeSiteHealth(input).health;
}
