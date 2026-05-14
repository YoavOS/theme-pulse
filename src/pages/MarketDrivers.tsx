import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, BarChart3, Loader2, Sparkles, Copy } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface DriverRow {
  rank: number;
  symbol: string;
  name: string;
  weight: number;
  pctChange: number | null;
  weightedContribution: number | null;
  cumulative: number;
  cumulativeShare: number | null;
}
interface DriversPayload {
  index: string;
  timeframe: string;
  indexPct: number | null;
  indexPrice: number | null;
  rows: DriverRow[];
  top5ContributionPct: number | null;
  top10ContributionPct: number | null;
  breadth: { advancers: number; decliners: number; total: number };
}

const TIMEFRAMES: Array<{ id: "today" | "1w" | "1m"; label: string }> = [
  { id: "today", label: "Today" },
  { id: "1w", label: "1 Week" },
  { id: "1m", label: "1 Month" },
];

function pct(v: number | null | undefined, d = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
}
function pctColor(v: number | null | undefined) {
  if (v === null || v === undefined) return "text-muted-foreground";
  return v >= 0 ? "text-[hsl(160,70%,55%)]" : "text-destructive/80";
}
function concentrationColor(p: number | null) {
  if (p === null) return "text-muted-foreground";
  if (p > 60) return "text-destructive";
  if (p > 40) return "text-amber-400";
  return "text-[hsl(160,70%,55%)]";
}

export default function MarketDrivers() {
  const [indexSel, setIndexSel] = useState<"QQQ" | "SPY">("QQQ");
  const [timeframe, setTimeframe] = useState<"today" | "1w" | "1m">("today");
  const [data, setData] = useState<DriversPayload | null>(null);
  const [spy, setSpy] = useState<DriversPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [insight, setInsight] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [simZero, setSimZero] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setInsight(null);
      try {
        const fetchOne = async (idx: "QQQ" | "SPY") => {
          const { data, error } = await supabase.functions.invoke("index-drivers", {
            body: null,
            method: "GET",
          } as never);
          // fall back to direct fetch via URL since invoke doesn't support GET query params cleanly:
          if (data && !error) return data as DriversPayload;
          const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/index-drivers?index=${idx}&timeframe=${timeframe}`;
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
          });
          return (await res.json()) as DriversPayload;
        };
        const [main, alt] = await Promise.all([
          fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/index-drivers?index=${indexSel}&timeframe=${timeframe}`, {
            headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
          }).then((r) => r.json()),
          fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/index-drivers?index=${indexSel === "QQQ" ? "SPY" : "QQQ"}&timeframe=${timeframe}`, {
            headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
          }).then((r) => r.json()),
        ]);
        if (cancelled) return;
        setData(main as DriversPayload);
        setSpy(alt as DriversPayload);
      } catch (e) {
        toast.error("Failed to load drivers", { description: e instanceof Error ? e.message : String(e) });
      } finally {
        setLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [indexSel, timeframe]);

  const fetchInsight = async () => {
    if (!data) return;
    setInsightLoading(true);
    try {
      const { data: resp } = await supabase.functions.invoke("market-drivers-insight", {
        body: {
          index: data.index,
          indexPct: data.indexPct,
          top: data.rows.slice(0, 8).map((r) => ({
            symbol: r.symbol, name: r.name,
            weightedContribution: r.weightedContribution, pctChange: r.pctChange,
          })),
          top5Pct: data.top5ContributionPct,
          timeframe: data.timeframe,
        },
      });
      setInsight((resp as { commentary?: string })?.commentary ?? "No commentary available.");
    } catch (e) {
      toast.error("AI commentary failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setInsightLoading(false);
    }
  };

  const projectedPct = useMemo(() => {
    if (!data || !data.indexPct) return null;
    let adj = data.indexPct;
    for (const r of data.rows) {
      if (simZero.has(r.symbol) && r.weightedContribution !== null) {
        adj -= r.weightedContribution;
      }
    }
    return adj;
  }, [data, simZero]);

  const exportTV = () => {
    if (!data) return;
    const syms = data.rows.slice(0, 20).map((r) => r.symbol).join(",");
    void navigator.clipboard.writeText(syms);
    toast.success(`Top 20 ${data.index} drivers copied`, { description: "Paste into TradingView." });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft size={14} /> Home
            </Link>
            <h1 className="font-syne text-2xl font-semibold tracking-tight inline-flex items-center gap-2">
              <BarChart3 size={20} className="text-[hsl(200,80%,55%)]" /> Market Drivers
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {TIMEFRAMES.map((t) => (
              <button key={t.id} onClick={() => setTimeframe(t.id)}
                className={`rounded-md border px-3 py-1.5 text-xs ${timeframe === t.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Index overview tiles */}
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {[data, spy].filter(Boolean).map((d) => d && (
            <div key={d.index} className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground">{d.index}</div>
              <div className={`font-mono text-3xl font-bold ${pctColor(d.indexPct)}`}>{pct(d.indexPct)}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {d.indexPrice !== null ? `$${d.indexPrice?.toFixed(2)}` : "—"} · A/D {d.breadth.advancers}/{d.breadth.decliners}
              </div>
            </div>
          ))}
          {data && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground">Concentration (Top 10)</div>
              <div className={`font-mono text-3xl font-bold ${concentrationColor(data.top10ContributionPct)}`}>
                {data.top10ContributionPct ?? "—"}%
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Top 10 explain {data.top10ContributionPct ?? "—"}% of {data.index}'s {timeframe} move ·
                Top 5: {data.top5ContributionPct ?? "—"}%
              </div>
            </div>
          )}
        </div>

        {/* Index toggle + AI insight */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            {(["QQQ", "SPY"] as const).map((i) => (
              <button key={i} onClick={() => setIndexSel(i)}
                className={`px-4 py-1.5 text-xs font-semibold ${indexSel === i ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}>
                {i} Drivers
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchInsight} disabled={!data || insightLoading}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50">
              {insightLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              AI Commentary
            </button>
            <button onClick={exportTV} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent">
              <Copy size={12} /> Export Top 20 → TV
            </button>
          </div>
        </div>

        {insight && (
          <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm leading-relaxed">
            {insight}
          </div>
        )}

        {/* Simulator */}
        {data && (
          <div className="mb-4 rounded-lg border border-border bg-muted/20 p-3 text-xs">
            <span className="font-semibold">Simulator: </span>
            If selected stocks were flat {timeframe === "today" ? "today" : "in this period"}, {data.index} would be{" "}
            <span className={`font-mono font-bold ${pctColor(projectedPct)}`}>{pct(projectedPct)}</span>{" "}
            instead of <span className={`font-mono ${pctColor(data.indexPct)}`}>{pct(data.indexPct)}</span>.
            {simZero.size > 0 && (
              <button onClick={() => setSimZero(new Set())} className="ml-2 underline text-muted-foreground hover:text-foreground">
                Clear ({simZero.size})
              </button>
            )}
          </div>
        )}

        {/* Drivers table */}
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/40 backdrop-blur">
                <tr className="border-b border-border">
                  <th className="px-2 py-2 text-left text-muted-foreground">#</th>
                  <th className="px-2 py-2 text-left text-muted-foreground">Ticker</th>
                  <th className="px-2 py-2 text-left text-muted-foreground">Company</th>
                  <th className="px-2 py-2 text-right text-muted-foreground">Weight %</th>
                  <th className="px-2 py-2 text-right text-muted-foreground">% Change</th>
                  <th className="px-2 py-2 text-right text-muted-foreground">Weighted Contrib (pp)</th>
                  <th className="px-2 py-2 text-right text-muted-foreground">Cumulative %</th>
                  <th className="px-2 py-2 text-center text-muted-foreground">Sim flat</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={8} className="px-2 py-8 text-center text-muted-foreground">
                    <Loader2 size={14} className="inline-block animate-spin" /> Loading drivers…
                  </td></tr>
                )}
                {!loading && data?.rows.map((r) => (
                  <tr key={r.symbol} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-2 py-1.5 text-muted-foreground">{r.rank}</td>
                    <td className="px-2 py-1.5 font-mono font-semibold">{r.symbol}</td>
                    <td className="px-2 py-1.5 max-w-[260px] truncate text-muted-foreground">{r.name}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{r.weight.toFixed(2)}</td>
                    <td className={`px-2 py-1.5 text-right font-mono ${pctColor(r.pctChange)}`}>{pct(r.pctChange)}</td>
                    <td className={`px-2 py-1.5 text-right font-mono font-semibold ${pctColor(r.weightedContribution)}`}>
                      {r.weightedContribution !== null ? `${r.weightedContribution >= 0 ? "+" : ""}${r.weightedContribution.toFixed(3)}` : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{r.cumulativeShare ?? "—"}%</td>
                    <td className="px-2 py-1.5 text-center">
                      <input type="checkbox" checked={simZero.has(r.symbol)}
                        onChange={(e) => {
                          const next = new Set(simZero);
                          if (e.target.checked) next.add(r.symbol); else next.delete(r.symbol);
                          setSimZero(next);
                        }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-3 text-[10px] text-muted-foreground">
          Weights based on top-50 constituents (approximate, refresh periodically). Live quotes via Yahoo Finance.
        </p>
      </div>
    </div>
  );
}
