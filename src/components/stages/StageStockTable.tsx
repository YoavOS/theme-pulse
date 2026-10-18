import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  STAGE_COLORS, SUBSTAGE_TIPS, downloadTradingViewList, loadStageChart, type StageChartData, type StageNum, type StockStage,
} from "@/lib/stageAnalysis";
import WeeklyChart from "@/components/stages/WeeklyChart";

export function StageBadge({ r, compact = false }: { r: Pick<StockStage, "stage" | "substage">; compact?: boolean }) {
  const color = STAGE_COLORS[r.stage as StageNum];
  const label = r.stage === 0 ? "T" : compact ? r.substage.replace("-", "−") : `Stage ${r.substage.replace("-", "−")}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-block whitespace-nowrap rounded px-1.5 py-[1px] font-mono text-[10px] font-medium"
          style={{ background: `${color.replace(")", ", 0.2)").replace("hsl(", "hsla(")}`, color }}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{SUBSTAGE_TIPS[r.substage] ?? ""}</TooltipContent>
    </Tooltip>
  );
}

const eventLabel = (r: StockStage) => {
  if (!r.event) return "—";
  const kind = r.event_kind === "BREAKOUT" ? "breakout" : r.event_kind === "BREAKDOWN" ? "breakdown"
    : r.event_kind === "RESUMPTION" ? "resumption" : r.event_kind === "CONTINUATION" ? "continuation" : r.event_kind === "FAILED_BASE" ? "failed base"
    : r.event_kind === "FAILED_BREAKDOWN" ? "failed breakdown" : r.event_kind === "FAILED_BREAKOUT" ? "failed breakout" : "";
  const when = r.event_weeks_ago === 0 ? "this week" : r.event_weeks_ago === 1 ? "1w ago" : `${r.event_weeks_ago}w ago`;
  return `${r.event.replace("T→", "→")}${kind ? ` ${kind}` : ""} · ${when}`;
};

type SortKey = "stage" | "confidence" | "symbol" | "weeks" | "high" | "rs";

/**
 * Stock list with stage details + TradingView export.
 * `groupOf` optionally shows each stock's group (industry, etc.).
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
        case "high": return (b.features?.pctFrom52wHigh ?? -999) - (a.features?.pctFrom52wHigh ?? -999);
        case "rs": return (rsOf?.(b.symbol) ?? -1) - (rsOf?.(a.symbol) ?? -1);
        default: return order(a.stage) - order(b.stage) || a.substage.localeCompare(b.substage) || b.confidence - a.confidence;
      }
    });
    return out;
  }, [rows, sort, rsOf]);

  const symbols = sorted.map((r) => r.symbol);
  const th = (key: SortKey, label: string, align = "text-right") => (
    <th
      onClick={() => setSort(key)}
      className={`cursor-pointer select-none whitespace-nowrap px-2 py-1.5 text-[10px] font-medium ${align} ${sort === key ? "text-primary" : "text-muted-foreground"}`}
    >
      {label}{sort === key ? " ▾" : ""}
    </th>
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">{rows.length.toLocaleString("en-US")} stocks</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => { navigator.clipboard.writeText(symbols.join(",")); toast.success(`${symbols.length} symbols copied.`); }}
            disabled={!symbols.length}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-foreground/80 hover:bg-accent disabled:opacity-40"
          >
            <Copy size={10} /> Copy
          </button>
          <button
            onClick={() => { downloadTradingViewList(symbols, exportName); toast.success(`Downloaded ${symbols.length} symbols.`, { description: "One ticker per line — ready for TradingView import." }); }}
            disabled={!symbols.length}
            className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/20 disabled:opacity-40"
          >
            <Download size={10} /> TradingView .txt
          </button>
        </div>
      </div>
      <div className="overflow-auto rounded border border-border/60" style={{ maxHeight }}>
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b border-border">
              {th("symbol", "Ticker", "text-left")}
              <th className="px-2 py-1.5 text-left text-[10px] font-medium text-muted-foreground" title="Last 40 weekly closes">40 weeks</th>
              {th("stage", "Stage", "text-left")}
              {th("confidence", "Conf.")}
              {rsOf && th("rs", "RS")}
              {th("weeks", "Weeks")}
              {th("high", "From 52w high")}
              <th className="px-2 py-1.5 text-left text-[10px] font-medium text-muted-foreground">Last change</th>
              {groupOf && <th className="px-2 py-1.5 text-left text-[10px] font-medium text-muted-foreground">Group</th>}
              <th className="px-2 py-1.5 text-left text-[10px] font-medium text-muted-foreground">Why</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <Fragment key={r.symbol}>
              <tr onClick={() => setOpen(open === r.symbol ? null : r.symbol)} className="cursor-pointer border-b border-border/30 hover:bg-accent/30" title="Click for the weekly chart">
                <td className="whitespace-nowrap px-2 py-1 font-mono font-medium">
                  {open === r.symbol ? <ChevronDown size={10} className="mr-0.5 inline" /> : <ChevronRight size={10} className="mr-0.5 inline text-muted-foreground" />}
                  <a
                    onClick={(e) => e.stopPropagation()}
                    href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(r.symbol)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="hover:text-primary hover:underline"
                    title={`${nameOf?.(r.symbol) ?? r.symbol} — open chart in TradingView`}
                  >
                    {r.symbol}
                  </a>
                </td>
                <td className="px-2 py-1"><WeekSpark r={r} /></td>
                <td className="whitespace-nowrap px-2 py-1">
                  <span className="inline-flex items-center gap-1">
                    <StageBadge r={r} />
                    {r.features?.tt?.pass && (!rsOf || (rsOf(r.symbol) ?? 0) >= 70) && (
                      <span className="rounded bg-emerald-500/15 px-1 text-[9px] font-medium text-emerald-400" title={`Minervini Trend Template: all 7 price rules${rsOf ? " + RS rank ≥ 70" : " (RS rule not checked here)"} (weekly proxies of the 50/150/200-day MAs)`}>TT</span>
                    )}
                    {r.quality && (
                      <span
                        className={`text-[9px] ${r.quality === "HIGH" ? "text-gain-medium" : r.quality === "LOW" ? "text-amber-400" : "text-muted-foreground"}`}
                        title="Breakout checklist (StageAnalysis.net): weekly volume ≥ 2× the prior 4 weeks, RS line above its 52-week average and rising, within 15% of the 52-week high. All four = strong. Strong volume tends to raise the payoff of the winners, not the share of winners."
                      >
                        {r.quality === "HIGH" ? "★ strong volume & RS" : r.quality === "LOW" ? "light volume / weak RS" : "mixed"}
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-2 py-1 text-right font-mono">{r.confidence}</td>
                {rsOf && (() => {
                  const v = rsOf(r.symbol);
                  return <td className={`px-2 py-1 text-right font-mono ${v !== null && v >= 80 ? "text-gain-medium" : v !== null && v < 30 ? "text-loss-strong" : ""}`}>{v ?? "—"}</td>;
                })()}
                <td className="px-2 py-1 text-right font-mono">{r.weeks_in_stage ?? "—"}</td>
                <td className="px-2 py-1 text-right font-mono">{r.features ? `${r.features.pctFrom52wHigh.toFixed(0)}%` : "—"}</td>
                <td className="whitespace-nowrap px-2 py-1 text-[11px] text-muted-foreground">{eventLabel(r)}</td>
                {groupOf && <td className="max-w-[160px] truncate px-2 py-1 text-[11px] text-muted-foreground">{groupOf(r.symbol)}</td>}
                <td className="max-w-[320px] truncate px-2 py-1 text-[11px] text-muted-foreground" title={(r.reasons ?? []).join(" · ")}>
                  {(r.reasons ?? []).join(" · ")}
                </td>
              </tr>
              {open === r.symbol && (
                <tr className="border-b border-border/30 bg-background/40">
                  <td colSpan={10} className="px-3 py-2"><StageChartPanel r={r} /></td>
                </tr>
              )}
              </Fragment>
            ))}
            {!sorted.length && (
              <tr><td colSpan={10} className="px-2 py-6 text-center text-muted-foreground">No stocks match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
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
function StageChartPanel({ r }: { r: StockStage }) {
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
    ...(f?.rangeLow ? [{ y: f.rangeLow, color: "hsl(344,80%,65%)", dash: "2 3" }] : []),
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
        {levels.length > 0 && <span><span className="text-[hsl(40,95%,55%)]">— range high</span> · <span className="text-[hsl(344,80%,65%)]">range low</span></span>}
        <span>strip = stage each week (
          {([1, 2, 3, 4] as StageNum[]).map((st) => <span key={st} style={{ color: STAGE_COLORS[st] }}> S{st}</span>)} )</span>
      </div>
    </div>
  );
}
