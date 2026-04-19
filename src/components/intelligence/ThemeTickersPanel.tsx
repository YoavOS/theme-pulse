import { useMemo } from "react";
import { ThemeIntelData } from "@/hooks/useThemeIntelligence";
import { useSpyBenchmark } from "@/hooks/useSpyBenchmark";

const DM_MONO = "'DM Mono', monospace";

interface Props {
  /** Pass either the full ThemeIntelData (preferred) or just the name + a lookup */
  theme: ThemeIntelData;
  /** Compact mode trims columns for narrow contexts */
  compact?: boolean;
}

function perfClass(v: number): string {
  return v > 0 ? "text-[#00f5c4]" : v < 0 ? "text-[#f5a623]" : "text-muted-foreground";
}

function fmt(v: number | null | undefined, suffix = "%"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "--";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}${suffix}`;
}

export default function ThemeTickersPanel({ theme, compact = false }: Props) {
  const { spy } = useSpyBenchmark();

  const rows = useMemo(() => {
    // Show ALL tickers belonging to the theme. Sort done tickers by 1D perf (desc),
    // then append any pending/error tickers at the bottom so nothing is hidden.
    const done = theme.tickers
      .filter(tk => tk.status === "done")
      .sort((a, b) => b.perf_1d - a.perf_1d);
    const others = theme.tickers.filter(tk => tk.status !== "done");
    return [...done, ...others];
  }, [theme.tickers]);

  if (rows.length === 0) {
    return (
      <div className="rounded-md py-3 px-3 text-center text-[11px] text-muted-foreground"
        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
        No ticker performance data available for this theme yet.
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-md"
      style={{
        background: "rgba(0,0,0,0.25)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="max-h-[480px] overflow-auto">
        <div className="px-2.5 py-1 text-[10px] text-muted-foreground border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]" style={{ fontFamily: DM_MONO }}>
          {rows.length} ticker{rows.length === 1 ? "" : "s"}
        </div>
        <table className="w-full text-[11px]" style={{ fontFamily: DM_MONO }}>
          <thead className="sticky top-0 z-10" style={{ background: "rgba(15,18,25,0.95)" }}>
            <tr className="text-[10px] text-muted-foreground border-b border-[rgba(255,255,255,0.06)]">
              <th className="px-2.5 py-1.5 text-left font-medium">Ticker</th>
              <th className="px-2.5 py-1.5 text-right font-medium">Price</th>
              <th className="px-2.5 py-1.5 text-right font-medium">1D</th>
              <th className="px-2.5 py-1.5 text-right font-medium">vs SPY</th>
              {!compact && <th className="px-2.5 py-1.5 text-right font-medium">1W</th>}
              {!compact && <th className="px-2.5 py-1.5 text-right font-medium">1M</th>}
              {!compact && <th className="px-2.5 py-1.5 text-right font-medium">3M</th>}
              {!compact && <th className="px-2.5 py-1.5 text-right font-medium">YTD</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(tk => {
              const isDone = tk.status === "done";
              const rs = isDone && spy.perf_1d !== null
                ? Math.round((tk.perf_1d - spy.perf_1d) * 100) / 100
                : null;
              return (
                <tr
                  key={tk.symbol}
                  className={`border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.03)] ${isDone ? "" : "opacity-60"}`}
                >
                  <td className="px-2.5 py-1.5 font-semibold text-foreground">
                    {tk.symbol}
                    {!isDone && <span className="ml-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">{tk.status}</span>}
                  </td>
                  <td className="px-2.5 py-1.5 text-right text-muted-foreground">
                    {tk.price > 0 ? `$${tk.price.toFixed(2)}` : "--"}
                  </td>
                  <td className={`px-2.5 py-1.5 text-right ${isDone ? perfClass(tk.perf_1d) : "text-muted-foreground"}`}>
                    {isDone ? fmt(tk.perf_1d) : "--"}
                  </td>
                  <td className={`px-2.5 py-1.5 text-right ${rs === null ? "text-muted-foreground" : perfClass(rs)}`}>
                    {rs === null ? "--" : fmt(rs)}
                  </td>
                  {!compact && <td className={`px-2.5 py-1.5 text-right ${isDone ? perfClass(tk.perf_1w) : "text-muted-foreground"}`}>{isDone ? fmt(tk.perf_1w) : "--"}</td>}
                  {!compact && <td className={`px-2.5 py-1.5 text-right ${isDone ? perfClass(tk.perf_1m) : "text-muted-foreground"}`}>{isDone ? fmt(tk.perf_1m) : "--"}</td>}
                  {!compact && <td className={`px-2.5 py-1.5 text-right ${isDone ? perfClass(tk.perf_3m) : "text-muted-foreground"}`}>{isDone ? fmt(tk.perf_3m) : "--"}</td>}
                  {!compact && <td className={`px-2.5 py-1.5 text-right ${isDone ? perfClass(tk.perf_ytd) : "text-muted-foreground"}`}>{isDone ? fmt(tk.perf_ytd) : "--"}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
