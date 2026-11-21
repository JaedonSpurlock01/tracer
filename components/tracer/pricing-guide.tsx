/**
 * -------------------------------------------------------------------------
 * @file   pricing-guide.tsx
 * @brief  Renders the Operator-only Pricing guide.
 *
 * @description
 *  Lists every rate in the maintained table with its unit and what it
 *  pays for, works a two-hour connected Call line by line to its total,
 *  and explains how a Workspace's monthly cost categories and a Deal's
 *  projected revenue are computed. It is a reading page built from the
 *  shared PageHeader and Panels; below md each rate's explanation sits
 *  under its name instead of in its own column, so the table never
 *  scrolls sideways on a phone.
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
import { formatCallDate } from "@/components/tracer/call-format";
import { PageHeader, Panel } from "@/components/tracer/page-parts";
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <PageHeader title="Pricing" description={`The rates behind every cost Tracer projects, maintained by hand and last checked on ${formatCallDate(`${pricingCheckedOn}T12:00:00Z`, "UTC")}.`} />
      <Panel title="Rates">
        <table aria-label="Rates" className="w-full text-sm">
          <caption className="sr-only">Rates</caption>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-2 pl-4 font-medium">Rate</th>
              <th scope="col" className="px-2 py-2 font-medium">Price</th>
              <th scope="col" className="px-2 py-2 font-medium">Unit</th>
              <th scope="col" className="hidden py-2 pr-4 pl-2 font-medium md:table-cell">What it pays for</th>
            </tr>
          </thead>
          <tbody>
            {pricingGuide.map((entry) => (
              <tr key={entry.key} className="border-b align-top last:border-0">
                <td className="py-2 pr-2 pl-4">
                  <span className="font-medium">{entry.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground md:hidden">{entry.explanation}</span>
                </td>
                <td className="px-2 py-2 tabular-nums">{formatUsd(entry.rate)}</td>
                <td className="px-2 py-2 text-muted-foreground">{entry.unit}</td>
                <td className="hidden py-2 pr-4 pl-2 text-muted-foreground md:table-cell">{entry.explanation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Panel title="A two-hour Call">
          <div className="flex flex-col gap-3 p-4">
            <p className="text-xs text-muted-foreground">A connected, recorded, transcribed, and assessed Call of {example.seconds / 60} minutes.</p>
            <ul className="flex flex-col divide-y divide-border text-sm">
              {example.lines.map((line) => (
                <li key={line.label} className="flex items-center justify-between gap-3 py-1.5">
                  <span>{line.label}</span>
                  <span className="tabular-nums">{formatUsd(line.usd)}</span>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 py-1.5 font-medium">
                <span>Total</span>
                <span className="tabular-nums">{formatUsd(example.totalCents / 100)}</span>
              </li>
            </ul>
            <p className="text-xs text-muted-foreground">Storing its Recording adds well under a cent per month, and the number rental is shared by every Call in the month.</p>
          </div>
        </Panel>
        <Panel title="Monthly cost and revenue">
          <dl className="flex flex-col gap-2 p-4 text-sm">
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
        </Panel>
      </div>
    </div>
  );
}
