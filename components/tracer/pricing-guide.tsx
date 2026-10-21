/**
 * -------------------------------------------------------------------------
 * @file   pricing-guide.tsx
 * @brief  Renders the Operator-only Pricing guide.
 *
 * @description
 *  Lists every rate in the maintained table with its unit and what it
 *  pays for, works a two-hour connected Call line by line to its total,
 *  and explains how a Workspace's monthly cost categories and a Deal's
 *  projected revenue are computed.
 *
 * @remarks
 *  The page reads the rate table directly, so changing a rate in
 *  data/pricing.ts changes the guide without a second edit. It is linked
 *  from the Home Money row and the Site Deal and cost panel and listed
 *  nowhere in the Sidebar.
 *
 * @see
 *  data/pricing.ts
 *  app/(app)/pricing/page.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { Frame, FramePanel } from "@/components/reui/frame";
import { formatCallDate } from "@/components/tracer/call-format";
import { formatUsd, pricingCheckedOn, pricingGuide, workedTwoHourCall } from "@/data/pricing";

const categories: [string, string][] = [
  ["Telephony", "Tracking Number rental prorated by the days the Number Assignment was active, plus inbound, forwarded, and Recording minutes of the Calls started in the month, each rounded up per Call."],
  ["Processing", "The cost stored with each Transcript and Lead Assessment of the month's Calls, or the transcribed minutes and tokens times the rates when none was stored."],
  ["Hosting", "Workers Paid plus the stored Recording bytes times the R2 rate, split evenly across the Organization's Active Workspaces."],
  ["Search", "The rank lookups made for the linked Site's Keywords in the month."],
  ["Domain", "One twelfth of the Site's annual renewal price, when it has been entered in Site settings."],
];

export default function PricingGuide() {
  const example = workedTwoHourCall();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-2xl font-semibold tracking-tight">Pricing</h1>
        <p className="text-sm text-muted-foreground">The rates behind every cost Tracer projects, maintained by hand and last checked on {formatCallDate(`${pricingCheckedOn}T12:00:00Z`, "UTC")}.</p>
      </div>
      <Frame>
        <FramePanel className="overflow-x-auto">
          <table aria-label="Rates" className="w-full text-sm">
            <caption className="sr-only">Rates</caption>
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="py-1 pr-2 font-medium">Rate</th>
                <th scope="col" className="px-2 py-1 font-medium">Price</th>
                <th scope="col" className="px-2 py-1 font-medium">Unit</th>
                <th scope="col" className="py-1 pl-2 font-medium">What it pays for</th>
              </tr>
            </thead>
            <tbody>
              {pricingGuide.map((entry) => (
                <tr key={entry.key} className="border-b align-top">
                  <td className="py-2 pr-2 font-medium">{entry.label}</td>
                  <td className="px-2 py-2 font-mono tabular-nums">{formatUsd(entry.rate)}</td>
                  <td className="px-2 py-2 text-muted-foreground">{entry.unit}</td>
                  <td className="py-2 pl-2 text-muted-foreground">{entry.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </FramePanel>
      </Frame>
      <Frame className="grid gap-2 lg:grid-cols-2">
        <FramePanel role="region" aria-labelledby="worked-call-title" className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 id="worked-call-title" className="font-semibold">A two-hour Call</h2>
            <p className="text-xs text-muted-foreground">A connected, recorded, transcribed, and assessed Call of {example.seconds / 60} minutes.</p>
          </div>
          <ul className="flex flex-col divide-y divide-border text-sm">
            {example.lines.map((line) => (
              <li key={line.label} className="flex items-center justify-between gap-3 py-1.5">
                <span>{line.label}</span>
                <span className="font-mono tabular-nums">{formatUsd(line.usd)}</span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-3 py-1.5 font-medium">
              <span>Total</span>
              <span className="font-mono tabular-nums">{formatUsd(example.totalCents / 100)}</span>
            </li>
          </ul>
          <p className="text-xs text-muted-foreground">Storing its Recording adds well under a cent per month, and the number rental is shared by every Call in the month.</p>
        </FramePanel>
        <FramePanel role="region" aria-labelledby="monthly-title" className="flex flex-col gap-3">
          <h2 id="monthly-title" className="font-semibold">Monthly cost and revenue</h2>
          <dl className="flex flex-col gap-2 text-sm">
            {categories.map(([label, explanation]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <dt className="font-medium">{label}</dt>
                <dd className="text-muted-foreground">{explanation}</dd>
              </div>
            ))}
            <div className="flex flex-col gap-0.5">
              <dt className="font-medium">Revenue and profit</dt>
              <dd className="text-muted-foreground">A Monthly Deal projects its amount, a Weekly Deal its amount times 52 over 12, and a Per Lead Deal its amount times the month&apos;s Good Leads with Lead Review precedence. Profit is revenue minus cost, the yearly projection is twelve months, and Cost per Good Lead is cost divided by Good Leads.</dd>
            </div>
          </dl>
        </FramePanel>
      </Frame>
    </div>
  );
}
