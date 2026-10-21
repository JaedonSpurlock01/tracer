/**
 * -------------------------------------------------------------------------
 * @file   site-health.test.ts
 * @brief  Verifies the Site Health derivation from stored sync rows.
 *
 * @description
 *  Covers Unknown before the first sync or without checks, Down after two
 *  consecutive failed checks, each Warning rule with its reason sentence,
 *  the precedence between them, and Healthy otherwise.
 *
 * @see
 *  data/site-health.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { describeSiteHealth, siteHealth, type SiteHealthInput } from "@/data/site-health";

const healthy: SiteHealthInput = {
  lastSyncedAt: "2026-10-20T12:17:00.000Z",
  checks: [
    { checkedAt: "2026-10-20T12:17:00.000Z", ok: true },
    { checkedAt: "2026-10-20T11:17:00.000Z", ok: true },
  ],
  hostnames: [
    { enabled: true, certificateId: "cert-apex" },
    { enabled: true, certificateId: "cert-www" },
  ],
  requests24h: 1000,
  errors24h: 10,
  visitsPrior7d: 140,
  visitsLast48h: 38,
};

describe("Site Health", () => {
  it("is Unknown before the first sync or without any uptime check", () => {
    expect(describeSiteHealth({ ...healthy, lastSyncedAt: null })).toEqual({ health: "Unknown", reason: null });
    expect(describeSiteHealth({ ...healthy, checks: [] })).toEqual({ health: "Unknown", reason: null });
    expect(siteHealth({ ...healthy, checks: [] })).toBe("Unknown");
  });

  it("is Healthy when checks pass, certificates are active, errors are low, and visits continue", () => {
    expect(describeSiteHealth(healthy)).toEqual({ health: "Healthy", reason: null });
    expect(siteHealth(healthy)).toBe("Healthy");
  });

  it("is Down after two consecutive failed checks and not after one", () => {
    const twoFailed = { ...healthy, checks: [{ checkedAt: "2026-10-20T12:17:00.000Z", ok: false }, { checkedAt: "2026-10-20T11:17:00.000Z", ok: false }] };
    expect(describeSiteHealth(twoFailed)).toEqual({ health: "Down", reason: "Two consecutive checks failed" });
    const oneFailed = { ...healthy, checks: [{ checkedAt: "2026-10-20T12:17:00.000Z", ok: false }, { checkedAt: "2026-10-20T11:17:00.000Z", ok: true }] };
    expect(describeSiteHealth(oneFailed).health).toBe("Healthy");
    const recovered = { ...healthy, checks: [{ checkedAt: "2026-10-20T12:17:00.000Z", ok: true }, { checkedAt: "2026-10-20T11:17:00.000Z", ok: false }, { checkedAt: "2026-10-20T10:17:00.000Z", ok: false }] };
    expect(describeSiteHealth(recovered).health).toBe("Healthy");
    const single = { ...healthy, checks: [{ checkedAt: "2026-10-20T12:17:00.000Z", ok: false }] };
    expect(describeSiteHealth(single).health).toBe("Healthy");
  });

  it("warns when a hostname is enabled without a certificate or is not enabled", () => {
    expect(describeSiteHealth({ ...healthy, hostnames: [{ enabled: true, certificateId: null }] })).toEqual({ health: "Warning", reason: "A hostname has no active certificate" });
    expect(describeSiteHealth({ ...healthy, hostnames: [{ enabled: true, certificateId: "cert" }, { enabled: false, certificateId: "cert" }] })).toEqual({ health: "Warning", reason: "A hostname has no active certificate" });
    expect(describeSiteHealth({ ...healthy, hostnames: [] }).health).toBe("Healthy");
  });

  it("warns when Worker errors exceed 5 percent of requests over the last 24 hours", () => {
    expect(describeSiteHealth({ ...healthy, requests24h: 100, errors24h: 6 })).toEqual({ health: "Warning", reason: "Worker errors above 5% in the last 24 hours" });
    expect(describeSiteHealth({ ...healthy, requests24h: 100, errors24h: 5 }).health).toBe("Healthy");
    expect(describeSiteHealth({ ...healthy, requests24h: 0, errors24h: 0 }).health).toBe("Healthy");
  });

  it("warns when a Site that had visits in the prior 7 days has none for 48 hours", () => {
    expect(describeSiteHealth({ ...healthy, visitsPrior7d: 12, visitsLast48h: 0 })).toEqual({ health: "Warning", reason: "No visits for 48 hours" });
    expect(describeSiteHealth({ ...healthy, visitsPrior7d: 0, visitsLast48h: 0 }).health).toBe("Healthy");
  });

  it("reports Down ahead of any Warning and the certificate reason ahead of errors and visits", () => {
    const everything = {
      ...healthy,
      checks: [{ checkedAt: "2026-10-20T12:17:00.000Z", ok: false }, { checkedAt: "2026-10-20T11:17:00.000Z", ok: false }],
      hostnames: [{ enabled: true, certificateId: null }],
      requests24h: 10,
      errors24h: 9,
      visitsPrior7d: 5,
      visitsLast48h: 0,
    };
    expect(describeSiteHealth(everything)).toEqual({ health: "Down", reason: "Two consecutive checks failed" });
    expect(describeSiteHealth({ ...everything, checks: healthy.checks })).toEqual({ health: "Warning", reason: "A hostname has no active certificate" });
    expect(describeSiteHealth({ ...everything, checks: healthy.checks, hostnames: healthy.hostnames })).toEqual({ health: "Warning", reason: "Worker errors above 5% in the last 24 hours" });
  });
});
