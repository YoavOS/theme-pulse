import { ThemeData } from "@/data/themeData";

function getPctColor(pct: number): string {
  if (pct > 7) return "text-gain-strong";
  if (pct > 2) return "text-gain-medium";
  if (pct >= 0) return "text-gain-mild";
  if (pct > -3) return "text-loss-mild";
  return "text-loss-strong";
}

function getBarColors(ratio: number): { green: string; red: string; gradient: string } {
  const greenW = Math.round(ratio * 100);
  const redW = 100 - greenW;

  if (ratio >= 0.8) return { green: "hsl(var(--bar-green))", red: "transparent", gradient: `hsl(var(--bar-green)) ${greenW}%, hsl(var(--bar-track)) ${greenW}%` };
  if (ratio >= 0.5) return { green: "hsl(var(--bar-green))", red: "hsl(var(--bar-track))", gradient: `hsl(var(--bar-green)) ${greenW}%, hsl(var(--bar-red) / 0.4) ${greenW}%` };
  if (ratio >= 0.3) return { green: "hsl(var(--bar-green))", red: "hsl(var(--bar-red))", gradient: `hsl(var(--bar-green)) ${greenW}%, hsl(var(--bar-red)) ${greenW}%` };
  return { green: "transparent", red: "hsl(var(--bar-red))", gradient: `hsl(var(--bar-red) / 0.5) ${greenW}%, hsl(var(--bar-red)) ${greenW}%` };
}

function TickerChip({ symbol, pct }: { symbol: string; pct: number }) {
  const color = pct >= 0 ? "text-gain-medium" : "text-loss-mild";
  const sign = pct >= 0 ? "+" : "";
  return (
    <a
      href={`https://www.tradingview.com/symbols/${symbol}/`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded bg-secondary/60 px-2 py-0.5 font-mono text-[0.8rem] transition-colors hover:bg-accent"
    >
      <span className="font-semibold text-foreground">{symbol}</span>
      <span className={color}>{sign}{pct.toFixed(2)}%</span>
    </a>
  );
}

export default function ThemeCard({ theme, index }: { theme: ThemeData; index: number }) {
  const total = theme.up_count + theme.down_count;
  const ratio = total > 0 ? theme.up_count / total : 0;
  const bar = getBarColors(ratio);
  const sign = theme.performance_pct >= 0 ? "+" : "";
  const sortedTickers = [...theme.tickers].sort((a, b) => b.pct - a.pct).slice(0, 8);
  const isEmpty = total === 0 && theme.tickers.length === 0;

  return (
    <div
      className="group rounded-lg border border-border bg-card p-4 transition-all hover:border-muted-foreground/30 hover:bg-surface-hover"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {/* Row 1: Name + Percentage */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[1.15rem] font-bold leading-tight text-foreground">
            {theme.theme_name}
          </h3>
          {theme.notes && (
            <span className="mt-0.5 inline-block text-xs text-muted-foreground italic">
              {theme.notes}
            </span>
          )}
        </div>
        <span className={`shrink-0 font-mono text-[2.2rem] font-bold leading-none tracking-tight ${getPctColor(theme.performance_pct)}`}>
          {sign}{theme.performance_pct.toFixed(2)}%
        </span>
      </div>

      {isEmpty ? (
        <p className="mt-3 text-xs text-muted-foreground">No data — placeholder theme</p>
      ) : (
        <>
          {/* Row 2: Progress bar */}
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-bar-track">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.round(ratio * 100)}%`,
                background: ratio >= 0.5 ? "hsl(var(--bar-green))" : `linear-gradient(90deg, ${bar.gradient})`,
              }}
            />
          </div>

          {/* Row 3: Up/Down counts */}
          <div className="mt-1.5 flex items-center gap-4 text-xs font-medium">
            <span className="text-gain-medium">{theme.up_count} up ↑</span>
            <span className="text-loss-mild">{theme.down_count} down ↓</span>
            <span className="ml-auto text-muted-foreground">{Math.round(ratio * 100)}% advancing</span>
          </div>

          {/* Row 4: Tickers */}
          {sortedTickers.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {sortedTickers.map((t) => (
                <TickerChip key={t.symbol} symbol={t.symbol} pct={t.pct} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
