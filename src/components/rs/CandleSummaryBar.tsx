import { Loader2 } from "lucide-react";

interface Props {
  green: number;
  red: number;
  known: number;
  total: number;
  loading?: boolean;
  /** Compact (inline) variant for tighter spaces. */
  compact?: boolean;
}

/**
 * Summary bar showing today's green vs red candle counts (Close > Open / Close < Open).
 * Used at the top of list summary/preview areas.
 */
export default function CandleSummaryBar({ green, red, known, total, loading, compact }: Props) {
  const pct = (n: number) => (known > 0 ? (n / known) * 100 : 0);
  const gPct = pct(green);
  const rPct = pct(red);
  const showSubtle = known === 0 && !loading;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-card text-xs ${
        compact ? "px-2.5 py-1.5" : "px-3 py-2"
      }`}
    >
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Today's Candle</span>

      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-[hsl(140,70%,50%)]" />
        <span className="font-semibold text-[hsl(140,70%,55%)]">
          Green: {green}/{known || 0}
        </span>
        <span className="font-mono text-[hsl(140,70%,55%)]">({gPct.toFixed(0)}%)</span>
      </span>

      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-destructive" />
        <span className="font-semibold text-destructive">
          Red: {red}/{known || 0}
        </span>
        <span className="font-mono text-destructive">({rPct.toFixed(0)}%)</span>
      </span>

      {known < total && (
        <span className="text-[10px] text-muted-foreground">
          {loading ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" /> loading candles… ({known}/{total})
            </span>
          ) : (
            <>covers {known}/{total}</>
          )}
        </span>
      )}

      {showSubtle && (
        <span className="text-[10px] italic text-muted-foreground">no candle data yet</span>
      )}
    </div>
  );
}
