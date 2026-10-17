import { useMemo, useState } from "react";
import { Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  STAGE_COLORS, SUBSTAGE_TIPS, downloadTradingViewList, type StageNum, type StockStage,
} from "@/lib/stageAnalysis";

export function StageBadge({ r, compact = false }: { r: Pick<StockStage, "stage" | "substage">; compact?: boolean }) {
  const color = STAGE_COLORS[r.stage as StageNum];
  const label = r.stage === 0 ? "T" : compact ? r.substage.replace("-", "−") : `Stage ${r.substage.replace("-", "−")}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-block rounded px-1.5 py-[1px] font-mono text-[10px] font-medium"
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
    : r.event_kind === "RESUMPTION" ? "resumption" : r.event_kind === "FAILED_BASE" ? "failed base" : "";
  const when = r.event_weeks_ago === 0 ? "this week" : r.event_weeks_ago === 1 ? "1w ago" : `${r.event_weeks_ago}w ago`;
  return `${r.event.replace("T→", "→")}${kind ? ` ${kind}` : ""} · ${when}`;
};

type SortKey = "stage" | "confidence" | "symbol" | "weeks" | "high";

/**
 * Stock list with stage details + TradingView export.
 * `groupOf` optionally shows each stock's group (industry, etc.).
 */
export default function StageStockTable({
  rows, exportName, groupOf, maxHeight = 420,
}: {
  rows: StockStage[];
  exportName: string;
  groupOf?: (symbol: string) => string;
  maxHeight?: number;
}) {
  const [sort, setSort] = useState<SortKey>("stage");
  const sorted = useMemo(() => {
    const order = (s: number) => (s === 2 ? 0 : s === 1 ? 1 : s === 3 ? 2 : s === 4 ? 3 : 4);
    const out = [...rows];
    out.sort((a, b) => {
      switch (sort) {
        case "symbol": return a.symbol.localeCompare(b.symbol);
        case "confidence": return b.confidence - a.confidence;
        case "weeks": return (a.weeks_in_stage ?? 999) - (b.weeks_in_stage ?? 999);
        case "high": return (b.features?.pctFrom52wHigh ?? -999) - (a.features?.pctFrom52wHigh ?? -999);
        default: return order(a.stage) - order(b.stage) || a.substage.localeCompare(b.substage) || b.confidence - a.confidence;
      }
    });
    return out;
  }, [rows, sort]);

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
              {th("stage", "Stage", "text-left")}
              {th("confidence", "Conf.")}
              {th("weeks", "Weeks")}
              {th("high", "From 52w high")}
              <th className="px-2 py-1.5 text-left text-[10px] font-medium text-muted-foreground">Last change</th>
              {groupOf && <th className="px-2 py-1.5 text-left text-[10px] font-medium text-muted-foreground">Group</th>}
              <th className="px-2 py-1.5 text-left text-[10px] font-medium text-muted-foreground">Why</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.symbol} className="border-b border-border/30 hover:bg-accent/30">
                <td className="px-2 py-1 font-mono font-medium">{r.symbol}</td>
                <td className="px-2 py-1">
                  <span className="inline-flex items-center gap-1">
                    <StageBadge r={r} />
                    {r.quality && (
                      <span
                        className={`text-[9px] ${r.quality === "HIGH" ? "text-gain-medium" : r.quality === "LOW" ? "text-amber-400" : "text-muted-foreground"}`}
                        title="Breakout quality: volume (≥2× avg), relative strength and nearby overhead supply"
                      >
                        {r.quality === "HIGH" ? "● quality" : r.quality === "LOW" ? "⚠ weak" : "◐ mixed"}
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-2 py-1 text-right font-mono">{r.confidence}</td>
                <td className="px-2 py-1 text-right font-mono">{r.weeks_in_stage ?? "—"}</td>
                <td className="px-2 py-1 text-right font-mono">{r.features ? `${r.features.pctFrom52wHigh.toFixed(0)}%` : "—"}</td>
                <td className="whitespace-nowrap px-2 py-1 text-[11px] text-muted-foreground">{eventLabel(r)}</td>
                {groupOf && <td className="max-w-[160px] truncate px-2 py-1 text-[11px] text-muted-foreground">{groupOf(r.symbol)}</td>}
                <td className="max-w-[320px] truncate px-2 py-1 text-[11px] text-muted-foreground" title={(r.reasons ?? []).join(" · ")}>
                  {(r.reasons ?? []).join(" · ")}
                </td>
              </tr>
            ))}
            {!sorted.length && (
              <tr><td colSpan={8} className="px-2 py-6 text-center text-muted-foreground">No stocks match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
