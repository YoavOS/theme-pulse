import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowUp, ArrowDown, BarChart3, Loader2, Sparkles, Copy, RefreshCw, Zap } from "lucide-react";
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
  lastUpdated?: string;
}

const TIMEFRAMES: Array<{ id: "today" | "1w" | "1m"; label: string }> = [
  { id: "today", label: "Today" },
  { id: "1w", label: "1 Week" },
  { id: "1m", label: "1 Month" },
];

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

function pct(v: number | null | undefined, d = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
}
function pctColor(v: number | null | undefined) {
  if (v === null || v === undefined) return "text-muted-foreground";
  return v >= 0 ? "text-[hsl(150,75%,55%)]" : "text-[hsl(0,80%,65%)]";
}
// Color intensity by absolute weighted contribution (pp)
function contribClasses(v: number | null | undefined) {
  if (v === null || v === undefined) return "text-muted-foreground bg-transparent";
  const a = Math.abs(v);
  const positive = v >= 0;
  // intensity tiers
  if (a >= 0.20) return positive
    ? "text-[hsl(150,90%,60%)] bg-[hsl(150,80%,40%)]/15 ring-1 ring-[hsl(150,80%,45%)]/30"
    : "text-[hsl(0,90%,70%)] bg-[hsl(0,80%,50%)]/15 ring-1 ring-[hsl(0,80%,55%)]/30";
  if (a >= 0.08) return positive
    ? "text-[hsl(150,80%,60%)] bg-[hsl(150,70%,40%)]/10"
    : "text-[hsl(0,85%,68%)] bg-[hsl(0,75%,55%)]/10";
  if (a >= 0.02) return positive ? "text-[hsl(150,65%,60%)]" : "text-[hsl(0,70%,68%)]";
  return "text-muted-foreground";
}
function concentrationColor(p: number | null) {
  if (p === null) return "text-muted-foreground";
  if (p > 60) return "text-[hsl(0,80%,68%)]";
  if (p > 40) return "text-[hsl(40,90%,60%)]";
  return "text-[hsl(150,75%,55%)]";
}
function fmtTimeAgo(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return d.toLocaleTimeString();
}

async function fetchDrivers(idx: "QQQ" | "SPY", tf: string): Promise<DriversPayload> {
  const url = `${SUPABASE_URL}/functions/v1/index-drivers?index=${idx}&timeframe=${tf}&_=${Date.now()}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      apikey: SUPABASE_KEY,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as DriversPayload;
}

export default function MarketDrivers() {
  const [indexSel, setIndexSel] = useState<"QQQ" | "SPY">("QQQ");
  const [timeframe, setTimeframe] = useState<"today" | "1w" | "1m">("today");
  const [data, setData] = useState<DriversPayload | null>(null);
  const [alt, setAlt] = useState<DriversPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [insight, setInsight] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [simZero, setSimZero] = useState<Set<string>>(new Set());
  const [lastFetched, setLastFetched] = useState<number>(0);
  const reqRef = useRef(0);

  type SortKey = "rank" | "symbol" | "name" | "weight" | "pctChange" | "weightedContribution" | "cumulativeShare";
  const [sortKey, setSortKey] = useState<SortKey>("weightedContribution");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(k); setSortDir(k === "symbol" || k === "name" || k === "rank" ? "asc" : "desc"); }
  };

  const load = useCallback(async (manual = false) => {
    const myReq = ++reqRef.current;
    setLoading(true);
    if (manual) setInsight(null);
    try {
      const [a, b] = await Promise.all([
        fetchDrivers(indexSel, timeframe),
        fetchDrivers(indexSel === "QQQ" ? "SPY" : "QQQ", timeframe),
      ]);
      if (myReq !== reqRef.current) return; // stale
      setData(a);
      setAlt(b);
      setLastFetched(Date.now());
    } catch (e) {
      toast.error("Failed to load drivers", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      if (myReq === reqRef.current) setLoading(false);
    }
  }, [indexSel, timeframe]);

  // Cost-saving: load once on mount / on filter change; no auto-refresh.
  useEffect(() => {
    void load(false);
  }, [load, timeframe]);

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
    if (!data || data.indexPct === null) return null;
    let adj = data.indexPct;
    for (const r of data.rows) {
      if (simZero.has(r.symbol) && r.weightedContribution !== null) adj -= r.weightedContribution;
    }
    return adj;
  }, [data, simZero]);

  const exportTV = () => {
    if (!data) return;
    const syms = data.rows.slice(0, 20).map((r) => r.symbol).join(",");
    void navigator.clipboard.writeText(syms);
    toast.success(`Top 20 ${data.index} drivers copied`, { description: "Paste into TradingView." });
  };

  const maxAbsContrib = useMemo(() => {
    if (!data) return 1;
    return Math.max(...data.rows.map((r) => Math.abs(r.weightedContribution ?? 0)), 0.01);
  }, [data]);

  const sortedRows = useMemo(() => {
    if (!data) return [];
    const arr = [...data.rows];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      const va = a[sortKey] as number | string | null;
      const vb = b[sortKey] as number | string | null;
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir;
    });
    return arr;
  }, [data, sortKey, sortDir]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-6">
        {/* ── Header ── */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft size={14} /> Home
            </Link>
            <h1 className="font-syne text-2xl font-semibold tracking-tight inline-flex items-center gap-2">
              <BarChart3 size={20} className="text-[hsl(200,80%,55%)]" /> Market Drivers
            </h1>
            {lastFetched > 0 && (
              <span className="text-[11px] text-muted-foreground">
                Updated {fmtTimeAgo(new Date(lastFetched).toISOString())}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-md border border-border">
              {TIMEFRAMES.map((t) => (
                <button key={t.id} onClick={() => setTimeframe(t.id)}
                  className={`px-3 py-1.5 text-xs font-medium ${timeframe === t.id ? "bg-primary/15 text-primary" : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                  {t.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => void load(true)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
              title="Force refresh"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
            </button>
          </div>
        </div>

        {/* ── Index overview tiles ── */}
        <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          {[data, alt].filter(Boolean).map((d) => d && (
            <div key={d.index} className="rounded-xl border border-border bg-gradient-to-br from-card to-card/40 p-5 shadow-sm">
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-semibold tracking-wide text-muted-foreground">{d.index}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{timeframe}</div>
              </div>
              <div className={`mt-1 font-mono text-4xl font-bold leading-none ${pctColor(d.indexPct)}`}>{pct(d.indexPct)}</div>
              <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span>{d.indexPrice !== null ? `$${d.indexPrice?.toFixed(2)}` : "—"}</span>
                <span>·</span>
                <span><span className="text-[hsl(150,70%,55%)]">{d.breadth.advancers}↑</span> / <span className="text-[hsl(0,75%,65%)]">{d.breadth.decliners}↓</span></span>
              </div>
            </div>
          ))}
          {data && (
            <div className="rounded-xl border border-border bg-gradient-to-br from-card to-card/40 p-5 shadow-sm">
              <div className="text-sm font-semibold tracking-wide text-muted-foreground">Concentration</div>
              <div className={`mt-1 font-mono text-4xl font-bold leading-none ${concentrationColor(data.top5ContributionPct)}`}>
                {data.top5ContributionPct ?? "—"}%
              </div>
              <div className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Top 5 explain <span className="font-semibold text-foreground">{data.top5ContributionPct ?? "—"}%</span> · Top 10: {data.top10ContributionPct ?? "—"}%
              </div>
            </div>
          )}
        </div>

        {/* ── Index toggle + actions ── */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            {(["QQQ", "SPY"] as const).map((i) => (
              <button key={i} onClick={() => setIndexSel(i)}
                className={`px-5 py-2 text-sm font-bold tracking-wide ${indexSel === i ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                {i}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchInsight} disabled={!data || insightLoading}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/15 disabled:opacity-50">
              {insightLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              AI Commentary
            </button>
            <button onClick={exportTV} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent">
              <Copy size={12} /> Export Top 20 → TV
            </button>
          </div>
        </div>

        {insight && (
          <div className="mb-4 rounded-lg border border-primary/30 bg-primary/[0.06] p-4 text-sm leading-relaxed text-foreground/95">
            <div className="mb-1 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <Sparkles size={11} /> AI Commentary
            </div>
            {insight}
          </div>
        )}

        {/* ── Simulator (premium box) ── */}
        {data && (
          <div className="mb-5 rounded-xl border-2 border-[hsl(200,80%,55%)]/30 bg-gradient-to-r from-[hsl(200,80%,15%)]/40 via-card to-card p-4 shadow-md">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-[hsl(200,80%,55%)]/15 p-1.5"><Zap size={14} className="text-[hsl(200,85%,65%)]" /></div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(200,85%,65%)]">What-If Simulator</div>
                  <div className="text-xs text-muted-foreground">
                    {simZero.size === 0
                      ? "Tick rows below to see how the index would move if those stocks were flat"
                      : <>If <span className="font-semibold text-foreground">{simZero.size}</span> stock{simZero.size > 1 ? "s" : ""} were flat {timeframe === "today" ? "today" : "in this period"}:</>}
                  </div>
                </div>
              </div>
              <div className="flex items-baseline gap-3">
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Actual</div>
                  <div className={`font-mono text-xl font-bold ${pctColor(data.indexPct)}`}>{pct(data.indexPct)}</div>
                </div>
                <div className="text-muted-foreground">→</div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Projected</div>
                  <div className={`font-mono text-2xl font-bold ${pctColor(projectedPct)}`}>{pct(projectedPct)}</div>
                </div>
                {simZero.size > 0 && (
                  <button onClick={() => setSimZero(new Set())}
                    className="ml-2 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Drivers table ── */}
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border bg-muted/20 px-4 py-2.5">
            <div className="text-sm font-semibold text-foreground">{indexSel} Top Drivers</div>
          </div>
          <div className="max-h-[62vh] overflow-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm">
                <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                  {(() => {
                    const SortableTh = ({ k, label, align = "left", className = "" }: { k: SortKey; label: string; align?: "left" | "right" | "center"; className?: string }) => {
                      const active = sortKey === k;
                      const justify = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
                      return (
                        <th className={`px-3 py-2.5 ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"} ${className}`}>
                          <button onClick={() => toggleSort(k)}
                            className={`inline-flex items-center gap-1 ${justify} w-full hover:text-foreground transition-colors ${active ? "text-foreground font-semibold" : ""}`}>
                            <span>{label}</span>
                            {active && (sortDir === "desc" ? <ArrowDown size={10} /> : <ArrowUp size={10} />)}
                          </button>
                        </th>
                      );
                    };
                    return (<>
                      <SortableTh k="rank" label="#" />
                      <SortableTh k="symbol" label="Ticker" />
                      <SortableTh k="name" label="Company" />
                      <SortableTh k="weight" label="Weight" align="right" />
                      <SortableTh k="pctChange" label="% Change" align="right" />
                      <SortableTh k="weightedContribution" label="Contribution (pp)" align="right" className="bg-primary/5" />
                      <SortableTh k="cumulativeShare" label="Cumul." align="right" />
                      <th className="px-3 py-2.5 text-center">Sim flat</th>
                    </>);
                  })()}
                </tr>
              </thead>
              <tbody>
                {loading && !data && (
                  <tr><td colSpan={8} className="px-2 py-12 text-center text-muted-foreground">
                    <Loader2 size={16} className="inline-block animate-spin" /> Loading drivers…
                  </td></tr>
                )}
                {sortedRows.map((r) => {
                  const isTop5 = r.rank <= 5;
                  const barWidth = Math.min(100, (Math.abs(r.weightedContribution ?? 0) / maxAbsContrib) * 100);
                  const barPositive = (r.weightedContribution ?? 0) >= 0;
                  return (
                    <tr key={r.symbol}
                      className={`group relative border-b border-border/30 transition-colors hover:bg-accent/30 ${isTop5 ? "bg-primary/[0.04]" : ""}`}>
                      <td className={`px-3 py-2 ${isTop5 ? "font-bold text-primary" : "text-muted-foreground"}`}>{r.rank}</td>
                      <td className="px-3 py-2 font-mono text-[14px] font-bold text-foreground">{r.symbol}</td>
                      <td className="px-3 py-2 max-w-[280px] truncate text-foreground/80">{r.name}</td>
                      <td className="px-3 py-2 text-right font-mono text-foreground/70">{r.weight.toFixed(2)}%</td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold ${pctColor(r.pctChange)}`}>{pct(r.pctChange)}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="relative h-1.5 w-14 overflow-hidden rounded-full bg-muted/30">
                            <div
                              className={`absolute inset-y-0 ${barPositive ? "left-0 bg-[hsl(150,75%,50%)]" : "right-0 bg-[hsl(0,75%,55%)]"}`}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                          <span className={`inline-block min-w-[58px] rounded px-1.5 py-0.5 text-right font-mono text-[13px] font-bold ${contribClasses(r.weightedContribution)}`}>
                            {r.weightedContribution !== null ? `${r.weightedContribution >= 0 ? "+" : ""}${r.weightedContribution.toFixed(3)}` : "—"}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[12px] text-muted-foreground">{r.cumulativeShare ?? "—"}%</td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 cursor-pointer accent-primary"
                          checked={simZero.has(r.symbol)}
                          onChange={(e) => {
                            const next = new Set(simZero);
                            if (e.target.checked) next.add(r.symbol); else next.delete(r.symbol);
                            setSimZero(next);
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-3 text-[10px] text-muted-foreground">
          {data && <>Full constituents: <span className="font-semibold text-foreground">{data.rows.length}</span> {data.index} holdings · </>}Live quotes via Yahoo Finance · auto-refresh every 60s on Today · click any column header to sort.
        </p>
      </div>
    </div>
  );
}
