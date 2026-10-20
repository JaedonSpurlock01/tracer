/**
 * -------------------------------------------------------------------------
 * @file   report-pdf.tsx
 * @brief  Renders the report document model to a branded PDF.
 *
 * @description
 *  Draws the report with `@react-pdf/renderer`: a deep slate cover with the
 *  Tracer orb and wordmark lockup, the generated time, report period,
 *  timezone, and Workspace scope, then the summary section and, for a
 *  multi-Workspace report, the Workspace comparison and one section per
 *  Workspace, each starting on its own page under a Workspace heading.
 *  Each section shows the five KPIs, a three-series trend chart, the Call
 *  Outcome and effective Lead classification distributions, and the
 *  notable Good Leads, with the estimate note under the classifications.
 *
 * @remarks
 *  Rendering runs in Node inside Trigger.dev, with no headless browser.
 *  Geist Regular and SemiBold are embedded from the `geist` package's TTF
 *  files, read from `node_modules/geist` under the working directory; the
 *  Trigger.dev build copies those two files to the same relative path in
 *  the deployed image. The orb is the sidebar's radial gradient from Ice to
 *  Steel blue drawn as an SVG circle, and the wordmark is Geist SemiBold
 *  text, so nothing is rasterized. The chart is drawn from SVG lines and
 *  markers rather than a charting library, and its series differ by color,
 *  dash pattern, and marker shape. Content pages are light for printing;
 *  the cover is the isolated brand moment in the dark palette.
 *
 * @see
 *  data/report-document.ts
 *  data/report-fonts.ts
 *  components/tracer/app-sidebar.tsx
 *  trigger.config.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import path from "node:path";

import { Circle, Defs, Document, Font, Line, Page, Polyline, RadialGradient, Rect, renderToBuffer, Stop, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";

import type { ReportDocument, ReportSection, ReportTrend } from "@/data/report-document";
import { reportFontPaths } from "@/data/report-fonts";

Font.register({
  family: "Geist",
  fonts: [
    { src: path.join(process.cwd(), reportFontPaths.regular), fontWeight: 400 },
    { src: path.join(process.cwd(), reportFontPaths.semibold), fontWeight: 600 },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

const color = {
  deepSlate: "#253237",
  slate: "#5c6b73",
  steelBlue: "#9db4c0",
  paleBlue: "#c2dfe3",
  ice: "#e0fbfc",
  paper: "#ffffff",
  rule: "#d5dee2",
  band: "#f2f7f8",
};

const series = [
  { key: "totalCalls", label: "Total Calls", stroke: color.deepSlate, dash: undefined, marker: "circle" },
  { key: "answeredCalls", label: "Answered Calls", stroke: color.slate, dash: "6 4", marker: "square" },
  { key: "goodLeads", label: "Good Leads", stroke: color.steelBlue, dash: "2 3", marker: "diamond" },
] as const;

const styles = StyleSheet.create({
  cover: { backgroundColor: color.deepSlate, color: color.ice, fontFamily: "Geist", padding: 56, justifyContent: "space-between" },
  page: { backgroundColor: color.paper, color: color.deepSlate, fontFamily: "Geist", fontSize: 9, paddingTop: 64, paddingBottom: 48, paddingHorizontal: 48 },
  lockup: { flexDirection: "row", alignItems: "center", gap: 8 },
  wordmark: { fontWeight: 600 },
  header: { position: "absolute", top: 24, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 0.5, borderBottomColor: color.rule, paddingBottom: 8 },
  footer: { position: "absolute", bottom: 24, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between", color: color.slate, fontSize: 8 },
  muted: { color: color.slate },
  eyebrow: { color: color.slate, fontSize: 8, textTransform: "uppercase", letterSpacing: 0.6 },
  sectionTitle: { fontSize: 18, fontWeight: 600, marginTop: 4, marginBottom: 14 },
  heading: { fontSize: 11, fontWeight: 600, marginTop: 18, marginBottom: 6 },
  kpis: { flexDirection: "row", gap: 8 },
  kpi: { flex: 1, borderWidth: 0.5, borderColor: color.rule, borderRadius: 4, padding: 8, gap: 3 },
  kpiValue: { fontSize: 15, fontWeight: 600, fontFeatureSettings: ["tnum"] },
  table: { borderTopWidth: 0.5, borderTopColor: color.rule },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: color.rule, paddingVertical: 4 },
  headRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: color.slate, paddingVertical: 4, color: color.slate, fontSize: 8 },
  cell: { flex: 1, paddingRight: 6 },
  number: { flex: 1, paddingRight: 6, textAlign: "right", fontFeatureSettings: ["tnum"] },
  note: { color: color.slate, fontSize: 8, marginTop: 6 },
  legend: { flexDirection: "row", gap: 14, marginTop: 6, color: color.slate, fontSize: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
});

function Orb({ size, id }: { size: number; id: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id={id} cx="30%" cy="30%" r="75%">
          <Stop offset="0" stopColor={color.ice} />
          <Stop offset="1" stopColor={color.steelBlue} />
        </RadialGradient>
      </Defs>
      <Circle cx={50} cy={50} r={49} fill={`url(#${id})`} />
    </Svg>
  );
}

function Lockup({ size, id }: { size: number; id: string }) {
  return (
    <View style={styles.lockup}>
      <Orb size={size} id={id} />
      <Text style={[styles.wordmark, { fontSize: size * 0.9 }]}>Tracer</Text>
    </View>
  );
}

function Cover({ document }: { document: ReportDocument }) {
  const { cover } = document;
  const facts: [string, string][] = [
    ["Generated", cover.generatedAt],
    ["Report period", cover.period],
    ["Dates", cover.dates],
    ["Timezone", cover.timeZone],
    ["Workspace scope", cover.scope],
  ];
  return (
    <Page size="LETTER" style={styles.cover}>
      <Lockup size={28} id="cover-lockup" />
      <View style={{ gap: 28 }}>
        <Orb size={168} id="cover-orb" />
        <Text style={{ fontSize: 34, fontWeight: 600 }}>{cover.title}</Text>
        <View style={{ gap: 8 }}>
          {facts.map(([label, value]) => (
            <View key={label} style={{ flexDirection: "row" }}>
              <Text style={{ width: 120, color: color.steelBlue, fontSize: 10 }}>{label}</Text>
              <Text style={{ fontSize: 10 }}>{value}</Text>
            </View>
          ))}
          <View style={{ flexDirection: "row" }}>
            <Text style={{ width: 120, color: color.steelBlue, fontSize: 10 }}>Workspaces</Text>
            <View style={{ gap: 3 }}>
              {cover.workspaces.map((name) => (
                <Text key={name} style={{ fontSize: 10 }}>
                  {name}
                </Text>
              ))}
            </View>
          </View>
        </View>
      </View>
      <Text style={{ color: color.steelBlue, fontSize: 8 }}>{document.estimateNote}</Text>
    </Page>
  );
}

function Marker({ shape, x, y, stroke }: { shape: (typeof series)[number]["marker"]; x: number; y: number; stroke: string }) {
  if (shape === "circle") return <Circle cx={x} cy={y} r={2.2} fill={stroke} />;
  if (shape === "square") return <Rect x={x - 2} y={y - 2} width={4} height={4} fill={stroke} />;
  return <Polyline points={`${x},${y - 2.8} ${x + 2.8},${y} ${x},${y + 2.8} ${x - 2.8},${y} ${x},${y - 2.8}`} fill={stroke} stroke={stroke} strokeWidth={0.5} />;
}

function niceMaximum(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value / 4)! * magnitude;
  return Math.ceil(value / step) * step;
}

function TrendChart({ trend }: { trend: ReportTrend }) {
  const width = 516;
  const height = 150;
  const left = 30;
  const bottom = 18;
  const plotWidth = width - left - 6;
  const plotHeight = height - bottom - 6;
  const maximum = niceMaximum(Math.max(0, ...trend.points.map((point) => point.totalCalls)));
  const x = (index: number) => left + (trend.points.length === 1 ? plotWidth / 2 : (index * plotWidth) / (trend.points.length - 1));
  const y = (value: number) => 6 + plotHeight - (value / maximum) * plotHeight;
  const ticks = [0, maximum / 2, maximum];
  const labelled = [...new Set([0, Math.floor((trend.points.length - 1) / 2), trend.points.length - 1])];
  return (
    <View wrap={false}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {ticks.map((tick) => (
          <Line key={tick} x1={left} x2={width - 6} y1={y(tick)} y2={y(tick)} stroke={color.rule} strokeWidth={0.5} />
        ))}
        {ticks.map((tick) => (
          <Text key={`label-${tick}`} x={left - 4} y={y(tick) + 2.5} textAnchor="end" style={{ fontFamily: "Geist", fontSize: 7, fill: color.slate }}>
            {String(tick)}
          </Text>
        ))}
        {labelled.map((index) => (
          <Text key={`x-${index}`} x={x(index)} y={height - 4} textAnchor={index === 0 ? "start" : index === trend.points.length - 1 ? "end" : "middle"} style={{ fontFamily: "Geist", fontSize: 7, fill: color.slate }}>
            {trend.points[index].label}
          </Text>
        ))}
        {series.map((item) => (
          <Polyline
            key={item.key}
            points={trend.points.map((point, index) => `${x(index)},${y(point[item.key])}`).join(" ")}
            fill="none"
            stroke={item.stroke}
            strokeWidth={1.2}
            strokeDasharray={item.dash}
          />
        ))}
        {series.flatMap((item) => trend.points.map((point, index) => <Marker key={`${item.key}-${index}`} shape={item.marker} x={x(index)} y={y(point[item.key])} stroke={item.stroke} />))}
      </Svg>
      <View style={styles.legend}>
        {series.map((item) => (
          <View key={item.key} style={styles.legendItem}>
            <Svg width={18} height={6} viewBox="0 0 18 6">
              <Line x1={0} x2={18} y1={3} y2={3} stroke={item.stroke} strokeWidth={1.2} strokeDasharray={item.dash} />
              <Marker shape={item.marker} x={9} y={3} stroke={item.stroke} />
            </Svg>
            <Text>{item.label}</Text>
          </View>
        ))}
        <Text>{trend.interval} points</Text>
      </View>
    </View>
  );
}

function Table({ columns, rows, numeric, widths }: { columns: string[]; rows: string[][]; numeric: boolean[]; widths?: number[] }) {
  const style = (index: number) => [numeric[index] ? styles.number : styles.cell, widths ? { flex: widths[index] } : {}];
  return (
    <View style={styles.table}>
      <View style={styles.headRow} fixed>
        {columns.map((column, index) => (
          <Text key={column} style={style(index)}>
            {column}
          </Text>
        ))}
      </View>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row} wrap={false}>
          {row.map((value, index) => (
            <Text key={index} style={style(index)}>
              {value}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function Section({ section, document, workspace }: { section: ReportSection; document: ReportDocument; workspace: boolean }) {
  return (
    <View break={workspace}>
      <Text style={styles.eyebrow}>{workspace ? "Workspace" : document.comparison ? "All selected Workspaces" : "Workspace"}</Text>
      <Text style={styles.sectionTitle}>{section.title}</Text>
      <View style={styles.kpis}>
        {section.kpis.map((kpi) => (
          <View key={kpi.label} style={styles.kpi}>
            <Text style={styles.muted}>{kpi.label}</Text>
            <Text style={styles.kpiValue}>{kpi.value}</Text>
            {kpi.comparison ? <Text style={[styles.muted, { fontSize: 7 }]}>{kpi.comparison}</Text> : null}
          </View>
        ))}
      </View>
      <Text style={styles.heading}>Call trend</Text>
      <TrendChart trend={section.trend} />
      <View wrap={false}>
        <Text style={styles.heading}>Call Outcomes</Text>
        <Table columns={["Call Outcome", "Calls", "Share"]} numeric={[false, true, true]} rows={section.outcomes.map((row) => [row.outcome, row.calls, row.share])} />
      </View>
      <View wrap={false}>
        <Text style={styles.heading}>Lead classification</Text>
        <Table
          columns={["Classification", "Lead Review", "Lead Assessment (estimate)", "Total", "Share"]}
          numeric={[false, true, true, true, true]}
          widths={[1.4, 1, 1.6, 0.8, 0.8]}
          rows={section.classifications.map((row) => [row.classification, row.reviewed, row.estimated, row.total, row.share])}
        />
        <Text style={styles.note}>{document.estimateNote}</Text>
      </View>
      {!workspace && document.comparison ? (
        <View wrap={false}>
          <Text style={styles.heading}>Workspace comparison</Text>
          <Table
            columns={["Workspace", "Tracking Number", "Total Calls", "Answer Rate", "Good Leads", "Lead Rate"]}
            numeric={[false, false, true, true, true, true]}
            widths={[1.8, 1.3, 1, 1, 1, 1]}
            rows={document.comparison.map((row) => [row.workspace, row.trackingNumber, row.totalCalls, row.answerRate, row.goodLeads, row.leadRate])}
          />
        </View>
      ) : null}
      <Text style={styles.heading} minPresenceAhead={60}>
        Notable Good Leads
      </Text>
      {section.notableGoodLeads.length === 0 ? (
        <Text style={styles.muted}>No Good Leads in this period.</Text>
      ) : (
        <Table
          columns={["Started", ...(workspace ? [] : ["Workspace"]), "Caller", "Connected", "AI Lead Score", "Classified by", "Assessment summary (estimate)"]}
          numeric={[false, ...(workspace ? [] : [false]), false, true, true, false, false]}
          widths={[1.2, ...(workspace ? [] : [1.1]), 1.1, 0.7, 0.6, 1.5, 2.4]}
          rows={section.notableGoodLeads.map((lead) => [lead.startedAt, ...(workspace ? [] : [lead.workspace]), lead.callerNumber, lead.connectedDuration, lead.score, lead.basis, lead.summary ?? "-"])}
        />
      )}
    </View>
  );
}

export function ReportPdf({ document }: { document: ReportDocument }) {
  return (
    <Document title={`Tracer ${document.cover.title}`} author="Tracer" creator="Tracer" producer="Tracer">
      <Cover document={document} />
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header} fixed>
          <Lockup size={12} id="page-lockup" />
          <Text style={styles.muted}>
            {document.cover.period}, {document.cover.dates} ({document.cover.timeZone})
          </Text>
        </View>
        <Section section={document.summary} document={document} workspace={false} />
        {document.workspaceSections.map((section, index) => (
          <Section key={index} section={section} document={document} workspace />
        ))}
        <View style={styles.footer} fixed>
          <Text>Generated {document.cover.generatedAt}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderReportPdf(document: ReportDocument): Promise<Uint8Array> {
  return new Uint8Array(await renderToBuffer(<ReportPdf document={document} />));
}
