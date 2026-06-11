import { useMemo } from "react";
import { ThemeData } from "@/data/themeData";
import { Trophy } from "lucide-react";

interface Props {
  themes: ThemeData[];
  onThemeClick?: (theme: ThemeData) => void;
}

function colorFor(pct: number): string {
  if (pct >= 2) return "text-gain-medium";
  if (pct > 0) return "text-gain-medium/80";
  if (pct === 0) return "text-muted-foreground";
  if (pct > -2) return "text-destructive/80";
  return "text-destructive";
}

function fmt(n: number | undefined | null) {
  if (n === undefined || n === null || isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export default function OverallBestThemesList({ themes, onThemeClick }: Props) {
  const ranked = useMemo(() => {
    return [...themes]
      .filter((t) => t.tickers.length > 0)
      .sort((a, b) => b.performance_pct - a.performance_pct);
  }, [themes]);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border bg-secondary/30 px-4 py-2.5">
        <Trophy size={14} className="text-[hsl(40,90%,55%)]" />
        <h2 className="text-sm font-bold tracking-tight text-foreground">Overall Best Themes</h2>
        <span className="text-[10px] text-muted-foreground">
          weighted score · 50% Today + 30% 1W + 20% 1M
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b border-border bg-secondary/20 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Theme</th>
              <th className="px-3 py-2 text-right">Overall</th>
              <th className="px-3 py-2 text-right">Today</th>
              <th className="px-3 py-2 text-right">1W</th>
              <th className="px-3 py-2 text-right">1M</th>
              <th className="px-3 py-2 text-right">Stocks</th>
              <th className="px-3 py-2 text-left">Top Performers</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((t, idx) => {
              const topPicks = [...t.tickers]
                .filter((tk) => !tk.skipped)
                .sort((a, b) => b.pct - a.pct)
                .slice(0, 2);
              return (
                <tr
                  key={t.theme_name}
                  className="border-b border-border/40 transition-colors hover:bg-accent/40 cursor-pointer"
                  onClick={() => onThemeClick?.(t)}
                >
                  <td className="px-3 py-2 text-muted-foreground font-mono">{idx + 1}</td>
                  <td className="px-3 py-2 font-semibold text-foreground">{t.theme_name}</td>
                  <td className={`px-3 py-2 text-right font-mono font-bold ${colorFor(t.performance_pct)}`}>
                    {fmt(t.performance_pct)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${colorFor(t.perf_today ?? 0)}`}>
                    {fmt(t.perf_today)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${colorFor(t.perf_1w ?? 0)}`}>
                    {fmt(t.perf_1w)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${colorFor(t.perf_1m ?? 0)}`}>
                    {fmt(t.perf_1m)}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground font-mono">
                    {t.valid_count ?? t.tickers.length}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      {topPicks.map((p) => (
                        <span
                          key={p.symbol}
                          className="inline-flex items-center gap-1 rounded border border-border bg-secondary/50 px-1.5 py-0.5"
                        >
                          <span className="font-semibold text-foreground">{p.symbol}</span>
                          <span className={`font-mono ${colorFor(p.pct)}`}>{fmt(p.pct)}</span>
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
            {ranked.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  No themes yet — run a scan to populate Overall Best.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
