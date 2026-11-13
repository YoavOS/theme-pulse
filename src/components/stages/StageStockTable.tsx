import { Fragment, useEffect, useMemo, useState } from "react";
import { Copy, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  STAGE_COLORS, SUBSTAGE_TIPS, downloadTradingViewList, loadStageChart, type StageChartData, type StageNum, type StockStage,
} from "@/lib/stageAnalysis";
import WeeklyChart from "@/components/stages/WeeklyChart";
import { tint } from "@/lib/colorTint";
import { toneBox } from "@/lib/moveTint";

export function StageBadge({ r, compact = false }: { r: Pick<StockStage, "stage" | "substage">; compact?: boolean }) {
  const color = STAGE_COLORS[r.stage as StageNum];
  const label = r.stage === 0 ? "T" : compact ? r.substage.replace("-", "−") : `Stage ${r.substage.replace("-", "−")}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-block whitespace-nowrap rounded-md border px-1.5 py-[1px] font-mono text-[10.5px] font-semibold"
          style={{ background: tint(color, 0.14), borderColor: tint(color, 0.4), color }}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{SUBSTAGE_TIPS[r.substage] ?? ""}</TooltipContent>
    </Tooltip>
  );
}

const KIND: Record<string, string> = {
  BREAKOUT: "breakout", BREAKDOWN: "breakdown", RESUMPTION: "resumption", CONTINUATION: "continuation", FAILED_BASE: "failed base",
  FAILED_BREAKDOWN: "failed breakdown", FAILED_BREAKOUT: "failed breakout", TREND: "trend", RANGE: "range",
};
const whenOf = (w: number | null) => (w === null ? "" : w === 0 ? "this week" : w === 1 ? "1w ago" : `${w}w ago`);
const eventLabel = (r: StockStage) => {
  if (!r.event) return "—";
  const kind = r.event_kind ? KIND[r.event_kind] ?? "" : "";
  return `${r.event.replace("T→", "→")}${kind ? ` ${kind}` : ""} · ${whenOf(r.event_weeks_ago)}`;
};
const QUALITY_TIP = "Breakout checklist (StageAnalysis.net): weekly volume ≥ 2× the prior 4 weeks, RS line above its 52-week average and rising, within 15% of the 52-week high. All four = strong. Strong volume tends to raise the payoff of the winners, not the share of winners.";
const QUALITY_TEXT = { HIGH: "Strong volume & RS", MIXED: "Mixed volume / RS", LOW: "Light volume / weak RS" } as const;

type SortKey = "stage" | "confidence" | "symbol" | "weeks" | "high" | "rs" | "event";

/**
 * Compact stock list (Deepvue style): ticker, 40-week spark, stage, RS, distance from the high and the
 * last stage change — each row edged in its stage color. Click a row for the details (confidence,
 * weeks in stage, group, breakout quality, the reasons) and the weekly chart.
 */
export default function StageStockTable({
  rows, exportName, groupOf, rsOf, nameOf, maxHeight = 420,
}: {
  rows: StockStage[];
  exportName: string;
  groupOf?: (symbol: string) => string;
  /** 1–99 relative-strength rank (from the stage scan's own RS vs SPY). */
  rsOf?: (symbol: string) => number | null;
  nameOf?: (symbol: string) => string | null | undefined;
  maxHeight?: number;
}) {
  const [sort, setSort] = useState<SortKey>("stage");
  const [open, setOpen] = useState<string | null>(null);
  const sorted = useMemo(() => {
    const order = (s: number) => (s === 2 ? 0 : s === 1 ? 1 : s === 3 ? 2 : s === 4 ? 3 : 4);
    const out = [...rows];
    out.sort((a, b) => {
      switch (sort) {
        case "symbol": return a.symbol.localeCompare(b.symbol);
        case "confidence": return b.confidence - a.confidence;
        case "weeks": return (a.weeks_in_stage ?? 999) - (b.weeks_in_stage ?? 999);
        case "event": return (a.event_weeks_ago ?? 999) - (b.event_weeks_ago ?? 999);
        case "high": return (b.features?.pctFrom52wHigh ?? -999) - (a.features?.pctFrom52wHigh ?? -999);
        case "rs": return (rsOf?.(b.symbol) ?? -1) - (rsOf?.(a.symbol) ?? -1);
        default: return order(a.stage) - order(b.stage) || a.substage.localeCompare(b.substage) || b.confidence - a.confidence;
      }
    });
    return out;
  }, [rows, sort, rsOf]);
  // The group column only earns its space when the list mixes groups.
  const showGroup = !!groupOf && new Set(rows.map((r) => groupOf(r.symbol))).size > 1;

  const symbols = sorted.map((r) => r.symbol);
  const th = (key: SortKey, label: string, align = "text-right", tip?: string, cls = "") => (
    <th onClick={() => setSort(key)} title={tip}
      className={`cursor-pointer select-none whitespace-nowrap px-2 py-2 text-[11px] font-semibold ${align} ${cls} ${sort === key ? "text-primary" : "text-muted-foreground"}`}>
      {label}{sort === key ? " ↓" : ""}
    </th>
  );

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">{rows.length.toLocaleString("en-US")} stocks · click a row for details</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { navigator.clipboard.writeText(symbols.join(",")); toast.success(`${symbols.length} symbols copied.`); }}
            disabled={!symbols.length} title="Copy the tickers"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <Copy size={11} /> Copy
          </button>
          <button
            onClick={() => { downloadTradingViewList(symbols, exportName); toast.success(`Downloaded ${symbols.length} symbols.`, { description: "One ticker per line — ready for TradingView import." }); }}
            disabled={!symbols.length}
            className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 disabled:opacity-40"
          >
            <Download size={11} /> TradingView
          </button>
        </div>
      </div>
      <div className="overflow-auto rounded-lg border border-border/60" style={{ maxHeight }}>
        <table className="w-full border-collapse text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border">
              {th("symbol", "Ticker", "text-left", undefined, "pl-3")}
              <th className="hidden px-2 py-2 text-left text-[11px] font-semibold text-muted-foreground sm:table-cell" title="Last 40 weekly closes">40w</th>
              {th("stage", "Stage", "text-left")}
              {rsOf && th("rs", "RS", "text-right", "Relative-strength rank 1–99 vs SPY (52 weeks)")}
              {th("high", "Off high", "text-right", "Distance from the 52-week high")}
              {th("event", "Last change", "text-left", "The last confirmed stage change", "hidden md:table-cell")}
              {showGroup && <th className="hidden px-2 py-2 text-left text-[11px] font-semibold text-muted-foreground lg:table-cell">Group</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const c = STAGE_COLORS[(r.stage as StageNum) || 0];
              const isOpen = open === r.symbol;
              const rs = rsOf?.(r.symbol) ?? null;
              const off = r.features?.pctFrom52wHigh ?? null;
              const tt = r.features?.tt?.pass && (!rsOf || (rs ?? 0) >= 70);
              return (
                <Fragment key={r.symbol}>
                  <tr onClick={() => setOpen(isOpen ? null : r.symbol)}
                    className="cursor-pointer border-b border-border/25 transition-colors hover:bg-accent/30"
                    style={{ boxShadow: `inset 3px 0 0 ${c}`, background: isOpen ? tint(c, 0.08) : undefined }}>
                    <td className="whitespace-nowrap py-1.5 pl-3 pr-2">
                      <a onClick={(e) => e.stopPropagation()} href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(r.symbol)}`}
                        target="_blank" rel="noopener noreferrer" className="font-mono font-bold hover:text-primary hover:underline"
                        title={`${nameOf?.(r.symbol) ?? r.symbol} — open chart in TradingView`}>
                        {r.symbol}
                      </a>
                    </td>
                    <td className="hidden px-2 py-1.5 sm:table-cell"><WeekSpark r={r} /></td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span className="inline-flex items-center gap-1">
                        <StageBadge r={r} compact />
                        {tt && <span className="rounded bg-primary/15 px-1 text-[9.5px] font-semibold text-primary" title={`Minervini Trend Template: all 7 price rules${rsOf ? " + RS rank ≥ 70" : " (RS rule not checked here)"} (weekly proxies of the 50/150/200-day MAs)`}>TT</span>}
                        {r.quality === "HIGH" && <span className="text-[11px] text-up" title={`${QUALITY_TEXT.HIGH} — ${QUALITY_TIP}`}>★</span>}
                        {r.quality === "LOW" && <span className="text-[9px] text-warn" title={`${QUALITY_TEXT.LOW} — ${QUALITY_TIP}`}>●</span>}
                      </span>
                    </td>
                    {rsOf && (
                      <td className="px-2 py-1.5 text-right">
                        <span className="inline-block min-w-[30px] rounded px-1.5 py-[1px] text-center font-mono text-[11.5px] font-semibold"
                          style={rs === null ? undefined : rs >= 80 ? { ...toneBox("good", 0.7), color: "hsl(var(--up))" } : rs < 30 ? { ...toneBox("bad", 0.5), color: "hsl(var(--down))" } : undefined}>
                          {rs ?? "—"}
                        </span>
                      </td>
                    )}
                    <td className={`px-2 py-1.5 text-right font-mono ${off === null ? "text-muted-foreground" : off >= -8 ? "text-up" : off <= -30 ? "text-down" : ""}`}>
                      {off === null ? "—" : `${off.toFixed(0)}%`}
                    </td>
                    <td className="hidden whitespace-nowrap px-2 py-1.5 text-[11.5px] text-muted-foreground md:table-cell" title={eventLabel(r)}>
                      {r.event ? (
                        <>
                          <span className="font-mono" style={{ color: STAGE_COLORS[(Number(r.event.slice(-1)) || 0) as StageNum] }}>{r.event.replace("T→", "→")}</span>
                          <span> · {whenOf(r.event_weeks_ago)}</span>
                        </>
                      ) : "—"}
                    </td>
                    {showGroup && <td className="hidden max-w-[170px] truncate px-2 py-1.5 text-[11.5px] text-muted-foreground lg:table-cell">{groupOf!(r.symbol)}</td>}
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-border/30" style={{ background: tint(c, 0.04) }}>
                      <td colSpan={7} className="px-3 py-2.5">
                        <StockDetails r={r} group={groupOf?.(r.symbol)} name={nameOf?.(r.symbol) ?? null} />
                        <div className="mt-2"><StageChartPanel r={r} /></div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!sorted.length && (
              <tr><td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">No stocks match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The details that used to take a column each: shown when a row is opened. */
function StockDetails({ r, group, name }: { r: StockStage; group?: string; name: string | null }) {
  const chip = (label: string, value: React.ReactNode, title?: string) => (
    <span className="inline-flex items-baseline gap-1 rounded-md border border-border/60 bg-background/40 px-2 py-0.5" title={title}>
      <span className="text-[10px] text-muted-foreground">{label}</span><span className="font-mono text-[11.5px]">{value}</span>
    </span>
  );
  return (
    <div className="space-y-1.5 text-[11.5px]">
      <div className="flex flex-wrap items-center gap-1.5">
        {name && <span className="mr-1 font-semibold">{name}</span>}
        {chip("Confidence", r.confidence, "How clearly the weekly chart fits this stage (0–100)")}
        {chip("In stage", `${r.weeks_in_stage ?? "—"}w`)}
        {chip("Last change", eventLabel(r))}
        {group && chip("Group", group)}
        {r.quality && (
          <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px]" title={QUALITY_TIP}
            style={toneBox(r.quality === "HIGH" ? "good" : r.quality === "LOW" ? "warn" : "neutral", 0.5)}>
            {QUALITY_TEXT[r.quality]}
          </span>
        )}
      </div>
      {(r.reasons ?? []).length > 0 && <p className="leading-relaxed text-muted-foreground">{(r.reasons ?? []).join(" · ")}</p>}
    </div>
  );
}

/** Last 40 weekly closes, colored by the current stage. */
export function WeekSpark({ r }: { r: StockStage }) {
  const c = r.features?.wc ?? [];
  if (c.length < 8) return <span className="text-muted-foreground">—</span>;
  const lo = Math.min(...c), hi = Math.max(...c), W = 72, H = 20;
  const d = c.map((v, k) => `${k ? "L" : "M"}${((k / (c.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - lo) / (hi - lo || 1)) * (H - 4)).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-5 w-[72px]" aria-label="Last 40 weekly closes">
      <path d={d} fill="none" stroke={STAGE_COLORS[(r.stage as StageNum) || 0]} strokeWidth={1.3} />
    </svg>
  );
}

/** Weekly chart for one stock with its confirmed stage history as a colored strip. */
export function StageChartPanel({ r }: { r: StockStage }) {
  const [data, setData] = useState<StageChartData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(null); setErr(null);
    loadStageChart(r.symbol).then((d) => { if (live) setData(d); }).catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [r.symbol]);
  if (err) return <p className="text-[11px] text-muted-foreground">Chart unavailable: {err}</p>;
  if (!data) return <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 size={11} className="animate-spin" /> Loading chart…</p>;
  const f = r.features;
  const levels = [
    ...(f?.rangeHigh ? [{ y: f.rangeHigh, color: "hsl(40,95%,55%)" }] : []),
    ...(f?.rangeLow ? [{ y: f.rangeLow, color: "hsl(330,72%,61%)", dash: "2 3" }] : []),
  ];
  // the history strip covers the last ≤52 confirmed weeks of the scan, which ends at r.as_of (a Friday)
  const friday = (t: number) => new Date((t + 4 * 86400) * 1000).toISOString().slice(0, 10);
  const stripEnd = data.t.findIndex((t) => friday(t) === r.as_of);
  return (
    <div className="max-w-[720px]">
      <WeeklyChart s={data} strip={r.history} stripEnd={stripEnd} levels={levels} height={150} label={`${r.symbol} weekly chart with stage history`} />
      <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-muted-foreground">
        <span>weekly · last {data.c.length} weeks</span>
        <span className="text-[hsl(280,60%,72%)]">— 30w MA</span>
        {levels.length > 0 && <span><span className="text-[hsl(40,95%,55%)]">— range high</span> · <span className="text-[hsl(330,72%,61%)]">range low</span></span>}
        <span>strip = stage each week (
          {([1, 2, 3, 4] as StageNum[]).map((st) => <span key={st} style={{ color: STAGE_COLORS[st] }}> S{st}</span>)} )</span>
      </div>
    </div>
  );
}
