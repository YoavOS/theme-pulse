import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, ChevronDown, ChevronRight, ExternalLink, Loader2 } from "lucide-react";

interface DriverRow { symbol: string; name: string; weightedContribution: number | null; pctChange: number | null; }
interface DriversPayload {
  index: string;
  indexPct: number | null;
  rows: DriverRow[];
  top5ContributionPct: number | null;
}

function pct(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}
function pctColor(v: number | null | undefined) {
  if (v === null || v === undefined) return "text-muted-foreground";
  return v >= 0 ? "text-[hsl(160,70%,55%)]" : "text-destructive/80";
}
function concColor(p: number | null | undefined) {
  if (p === null || p === undefined) return "text-muted-foreground";
  if (p > 60) return "text-destructive";
  if (p > 40) return "text-amber-400";
  return "text-[hsl(160,70%,55%)]";
}

export default function MarketDriversWidget() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);
  const [qqq, setQqq] = useState<DriversPayload | null>(null);
  const [spy, setSpy] = useState<DriversPayload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      try {
        const headers = { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` };
        const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/index-drivers`;
        const [q, s] = await Promise.all([
          fetch(`${base}?index=QQQ&timeframe=today`, { headers }).then((r) => r.json()),
          fetch(`${base}?index=SPY&timeframe=today`, { headers }).then((r) => r.json()),
        ]);
        setQqq(q as DriversPayload);
        setSpy(s as DriversPayload);
      } catch { /* ignore */ } finally { setLoading(false); }
    };
    void run();
    const t = setInterval(run, 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="rounded-lg border border-border bg-card">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs">
        <span className="inline-flex items-center gap-2 font-semibold">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <BarChart3 size={14} className="text-[hsl(200,80%,55%)]" /> Market Drivers Today
        </span>
        <div className="inline-flex items-center gap-3">
          <span className="font-mono"><span className="text-muted-foreground">QQQ</span> <span className={pctColor(qqq?.indexPct)}>{pct(qqq?.indexPct)}</span></span>
          <span className="font-mono"><span className="text-muted-foreground">SPY</span> <span className={pctColor(spy?.indexPct)}>{pct(spy?.indexPct)}</span></span>
          {loading && <Loader2 size={11} className="animate-spin" />}
        </div>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-3 py-2 text-xs">
          {qqq && (
            <>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Top 5 explain</span>
                <span className={`font-mono font-semibold ${concColor(qqq.top5ContributionPct)}`}>
                  {qqq.top5ContributionPct ?? "—"}% of QQQ move
                </span>
              </div>
              <table className="w-full">
                <tbody>
                  {qqq.rows.slice(0, 5).map((r) => (
                    <tr key={r.symbol} className="border-t border-border/40">
                      <td className="py-1 font-mono font-semibold">{r.symbol}</td>
                      <td className={`py-1 text-right font-mono ${pctColor(r.pctChange)}`}>{pct(r.pctChange)}</td>
                      <td className={`py-1 pl-3 text-right font-mono font-semibold ${pctColor(r.weightedContribution)}`}>
                        {r.weightedContribution !== null ? `${r.weightedContribution >= 0 ? "+" : ""}${r.weightedContribution.toFixed(3)}pp` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <button onClick={() => navigate("/market-drivers")}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary/10 px-2 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/20">
            <ExternalLink size={11} /> Open Full Market Drivers
          </button>
        </div>
      )}
    </div>
  );
}
