import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, RefreshCw, Loader2, TrendingUp, Calendar, Copy, Download, Sparkles,
  Filter as FilterIcon, Building2, Clock,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import EarningsAnalysisPanel, { type EarningsAnalysisContext } from "@/components/earnings/EarningsAnalysisPanel";

// ────────────────────────────────────────────────────────────────────
// Types matching the two edge functions
// ────────────────────────────────────────────────────────────────────
interface TodayRow {
  symbol: string;
  company: string | null;
  marketCap: number | null;
  reportTime: "BMO" | "AMC" | "DMH" | null;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
  currentPrice: number | null;
  previousClose: number | null;
  gapPct: number | null;
  date: string;
}

interface GapperRow {
  symbol: string;
  company: string | null;
  reportDate: string;
  reportTime: "BMO" | "AMC" | "DMH" | null;
  gapPct: number;
  prevClose: number;
  openPrice: number;
  marketCap: number | null;
  sector: string | null;
  epsEstimate: number | null;
  epsActual: number | null;
  epsSurprisePct: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
  revenueSurprisePct: number | null;
  rsRating: number | null;
  aiAnalysis?: string | null;
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────
const fmtMcap = (m: number | null) => {
  if (m === null) return "—";
  if (m >= 1e12) return `${(m / 1e12).toFixed(2)}T`;
  if (m >= 1e9) return `${(m / 1e9).toFixed(1)}B`;
  if (m >= 1e6) return `${(m / 1e6).toFixed(0)}M`;
  return m.toFixed(0);
};
const fmtRev = (r: number | null) => {
  if (r === null) return "—";
  if (r >= 1e9) return `$${(r / 1e9).toFixed(2)}B`;
  if (r >= 1e6) return `$${(r / 1e6).toFixed(1)}M`;
  return `$${r.toFixed(0)}`;
};
const fmtPct = (n: number | null, dp = 2) => n === null || n === undefined ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(dp)}%`;
const gapColor = (g: number | null) => {
  if (g === null) return "text-muted-foreground";
  if (g >= 5) return "text-[hsl(160,80%,55%)]";
  if (g > 0) return "text-[hsl(160,60%,55%)]";
  if (g <= -5) return "text-destructive";
  if (g < 0) return "text-[hsl(0,70%,60%)]";
  return "text-muted-foreground";
};
const reportTimeBadge = (t: TodayRow["reportTime"]) => {
  if (t === "BMO") return <span className="rounded border border-[hsl(40,80%,55%)]/40 bg-[hsl(40,80%,55%)]/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[hsl(40,90%,60%)]" title="Before Market Open">BMO</span>;
  if (t === "AMC") return <span className="rounded border border-[hsl(280,70%,60%)]/40 bg-[hsl(280,70%,60%)]/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[hsl(280,80%,70%)]" title="After Market Close">AMC</span>;
  if (t === "DMH") return <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground" title="During Market Hours">DMH</span>;
  return <span className="text-[10px] text-muted-foreground">—</span>;
};

// ────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────
type Scope = "qualified" | "all";

export default function Earnings() {
  // shared filters
  const [scope, setScope] = useState<Scope>("qualified");
  const [minMcap, setMinMcap] = useState<number>(1_000_000_000);
  const [reportTimeFilter, setReportTimeFilter] = useState<"all" | "BMO" | "AMC" | "DMH">("all");

  // today
  const [today, setToday] = useState<TodayRow[]>([]);
  const [todayLoading, setTodayLoading] = useState(false);
  const [todayDate, setTodayDate] = useState<string | null>(null);

  // historical
  const [lookbackDays, setLookbackDays] = useState<number>(60);
  const [minGap, setMinGap] = useState<number>(10);
  const [enableAi, setEnableAi] = useState<boolean>(true);
  const [gappers, setGappers] = useState<GapperRow[]>([]);
  const [gappersLoading, setGappersLoading] = useState(false);

  // AI panel
  const [analysisCtx, setAnalysisCtx] = useState<EarningsAnalysisContext | null>(null);

  // Build the universe array when scope = qualified
  const fetchUniverse = useCallback(async (): Promise<string[] | null> => {
    if (scope !== "qualified") return null;
    const { data, error } = await supabase
      .from("qualified_rs_universe")
      .select("symbol")
      .limit(2000);
    if (error || !data) return null;
    return data.map((r: any) => String(r.symbol).toUpperCase());
  }, [scope]);

  const loadToday = useCallback(async () => {
    setTodayLoading(true);
    try {
      const universe = await fetchUniverse();
      const { data, error } = await supabase.functions.invoke("earnings-calendar", {
        body: { minMarketCap: minMcap, universe },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setToday(Array.isArray(data?.rows) ? data.rows : []);
      setTodayDate(data?.date ?? null);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load today's earnings");
    } finally {
      setTodayLoading(false);
    }
  }, [fetchUniverse, minMcap]);

  const loadGappers = useCallback(async () => {
    setGappersLoading(true);
    try {
      const universe = await fetchUniverse();
      const { data, error } = await supabase.functions.invoke("earnings-historical-gappers", {
        body: {
          lookbackDays,
          minGapPct: minGap,
          minMarketCap: minMcap,
          universe,
          enableAi,
          maxAiRows: 10,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setGappers(Array.isArray(data?.rows) ? data.rows : []);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load historical gappers");
    } finally {
      setGappersLoading(false);
    }
  }, [fetchUniverse, lookbackDays, minGap, minMcap, enableAi]);

  // Cost-saving: load once on mount; no 5-minute auto-refresh.
  useEffect(() => {
    loadToday();
  }, [loadToday]);

  // Filtered today rows by reportTime
  const filteredToday = useMemo(() => {
    if (reportTimeFilter === "all") return today;
    return today.filter(r => r.reportTime === reportTimeFilter);
  }, [today, reportTimeFilter]);

  // ── Export helpers ──
  const exportSymbols = (symbols: string[], fileLabel: string) => {
    if (symbols.length === 0) {
      toast.info("Nothing to export.");
      return;
    }
    navigator.clipboard?.writeText(symbols.join(",")).catch(() => {});
    const blob = new Blob([symbols.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Earnings_${fileLabel}_${symbols.length}tickers.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Copied ${symbols.length} symbols & downloaded .txt — ready for TradingView import.`);
  };

  // ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Back to Dashboard"
            >
              <ArrowLeft size={16} />
            </Link>
            <div>
              <h1 className="font-['Syne',sans-serif] text-xl font-bold tracking-tight text-foreground">
                Earnings Gappers
              </h1>
              <p className="text-xs text-muted-foreground">
                Today's earnings reporters & recent post-earnings winners
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Scope toggle */}
            <div className="flex items-center gap-0 rounded-md border border-border bg-muted/30 p-0.5">
              <button
                onClick={() => setScope("qualified")}
                className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${scope === "qualified" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                title="Only stocks in your qualified RS universe"
              >
                RS Universe
              </button>
              <button
                onClick={() => setScope("all")}
                className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${scope === "all" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                title="All US stocks above min market cap"
              >
                Full Market
              </button>
            </div>

            {/* Min mcap */}
            <label className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 text-[11px]">
              <Building2 size={11} className="text-muted-foreground" />
              <span className="text-muted-foreground">Min Mcap</span>
              <select
                value={minMcap}
                onChange={(e) => setMinMcap(Number(e.target.value))}
                className="bg-transparent font-mono font-semibold text-foreground focus:outline-none"
              >
                <option value={500_000_000}>$500M</option>
                <option value={1_000_000_000}>$1B</option>
                <option value={2_000_000_000}>$2B</option>
                <option value={5_000_000_000}>$5B</option>
                <option value={10_000_000_000}>$10B</option>
              </select>
            </label>
          </div>
        </div>
      </header>

      <main className="container space-y-6 py-6">
        {/* ──────────────── TODAY'S EARNINGS ──────────────── */}
        <section className="rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Calendar size={15} className="text-primary" />
              <h2 className="font-['Syne',sans-serif] text-base font-semibold text-foreground">
                Today's Earnings
              </h2>
              <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                {filteredToday.length} {todayDate ? `· ${todayDate}` : ""}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Report time filter */}
              <div className="flex items-center gap-0 rounded-md border border-border bg-muted/30 p-0.5">
                {(["all", "BMO", "AMC", "DMH"] as const).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setReportTimeFilter(opt)}
                    className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${reportTimeFilter === opt ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {opt === "all" ? "All" : opt}
                  </button>
                ))}
              </div>

              <button
                onClick={() => exportSymbols(filteredToday.map(r => r.symbol), `Today_${todayDate ?? ""}`)}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/50 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20"
                title="Copy symbols & download .txt for TradingView"
              >
                <Copy size={11} /> Export to TradingView
              </button>

              <button
                onClick={loadToday}
                disabled={todayLoading}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                {todayLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                Refresh
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-border bg-muted/20 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Ticker</th>
                  <th className="px-3 py-2 text-left">Company</th>
                  <th className="px-3 py-2 text-right">Mcap</th>
                  <th className="px-3 py-2 text-center">Time</th>
                  <th className="px-3 py-2 text-right">EPS Est</th>
                  <th className="px-3 py-2 text-right">Rev Est</th>
                  <th className="px-3 py-2 text-right">Gap %</th>
                </tr>
              </thead>
              <tbody>
                {todayLoading ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                    <Loader2 size={14} className="mx-auto mb-2 animate-spin" />
                    Loading today's earnings…
                  </td></tr>
                ) : filteredToday.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                    No earnings found for today's filters.
                  </td></tr>
                ) : (
                  filteredToday.map((r) => (
                    <tr
                      key={`${r.symbol}-${r.date}`}
                      onClick={() => setAnalysisCtx({
                        symbol: r.symbol, company: r.company,
                        gapPct: r.gapPct,
                        epsSurprisePct: r.epsActual !== null && r.epsEstimate ? ((r.epsActual - r.epsEstimate) / Math.abs(r.epsEstimate)) * 100 : null,
                        revenueSurprisePct: r.revenueActual !== null && r.revenueEstimate ? ((r.revenueActual - r.revenueEstimate) / Math.abs(r.revenueEstimate)) * 100 : null,
                        reportDate: r.date, reportTime: r.reportTime,
                      })}
                      className="cursor-pointer border-b border-border/50 transition-colors hover:bg-accent/40"
                    >
                      <td className="px-3 py-1.5 font-mono font-bold text-foreground">{r.symbol}</td>
                      <td className="px-3 py-1.5 text-foreground/90 truncate max-w-[200px]">{r.company ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{fmtMcap(r.marketCap)}</td>
                      <td className="px-3 py-1.5 text-center">{reportTimeBadge(r.reportTime)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{r.epsEstimate !== null ? r.epsEstimate.toFixed(2) : "—"}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{fmtRev(r.revenueEstimate)}</td>
                      <td className={`px-3 py-1.5 text-right font-mono font-semibold ${gapColor(r.gapPct)}`}>
                        {fmtPct(r.gapPct)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ──────────────── HISTORICAL BIG GAPPERS ──────────────── */}
        <section className="rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <TrendingUp size={15} className="text-[hsl(160,70%,50%)]" />
              <h2 className="font-['Syne',sans-serif] text-base font-semibold text-foreground">
                Recent Big Earnings Winners
              </h2>
              <span className="rounded bg-[hsl(160,70%,50%)]/10 px-1.5 py-0.5 font-mono text-[10px] text-[hsl(160,70%,50%)]">
                {gappers.length}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock size={11} /> Lookback
                <select value={lookbackDays} onChange={(e) => setLookbackDays(Number(e.target.value))} className="rounded border border-border bg-background px-1.5 py-0.5 font-mono">
                  <option value={30}>30d</option>
                  <option value={60}>60d</option>
                  <option value={90}>90d</option>
                </select>
              </label>
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <FilterIcon size={11} /> Min Gap
                <select value={minGap} onChange={(e) => setMinGap(Number(e.target.value))} className="rounded border border-border bg-background px-1.5 py-0.5 font-mono">
                  <option value={5}>+5%</option>
                  <option value={10}>+10%</option>
                  <option value={15}>+15%</option>
                  <option value={20}>+20%</option>
                </select>
              </label>
              <label className="flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2 py-0.5 text-[11px] cursor-pointer">
                <input type="checkbox" checked={enableAi} onChange={(e) => setEnableAi(e.target.checked)} className="accent-primary" />
                <Sparkles size={11} className="text-primary" />
                <span className="text-foreground">Groq Analysis</span>
              </label>

              <button
                onClick={loadGappers}
                disabled={gappersLoading}
                className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(160,70%,50%)]/50 bg-[hsl(160,70%,50%)]/10 px-2.5 py-1 text-[11px] font-semibold text-[hsl(160,70%,50%)] hover:bg-[hsl(160,70%,50%)]/20 disabled:opacity-50"
              >
                {gappersLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                {gappers.length === 0 ? "Scan Now" : "Rescan"}
              </button>

              <button
                onClick={() => exportSymbols(gappers.map(r => r.symbol), `Winners_${lookbackDays}d`)}
                disabled={gappers.length === 0}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/50 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20 disabled:opacity-50"
              >
                <Download size={11} /> Export
              </button>
            </div>
          </div>

          {gappersLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 size={16} className="mr-2 animate-spin" />
              Scanning earnings history… this can take 30-60s for 60-day window.
            </div>
          ) : gappers.length === 0 ? (
            <div className="px-4 py-12 text-center text-xs text-muted-foreground">
              Click "Scan Now" to find stocks that gapped ≥ {minGap}% the day after earnings in the last {lookbackDays} days.
            </div>
          ) : (
            (() => {
              const sorted = [...gappers].sort((a, b) => {
                const d = (b.reportDate || "").localeCompare(a.reportDate || "");
                if (d !== 0) return d;
                return (b.gapPct ?? 0) - (a.gapPct ?? 0);
              });
              const groups: { date: string; rows: typeof sorted }[] = [];
              for (const g of sorted) {
                const last = groups[groups.length - 1];
                if (last && last.date === g.reportDate) last.rows.push(g);
                else groups.push({ date: g.reportDate, rows: [g] });
              }
              const dateLabel = (iso: string) => {
                try {
                  const d = new Date(iso + "T00:00:00");
                  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
                } catch { return iso; }
              };
              return (
                <div className="divide-y divide-border/70">
                  {groups.map((grp) => (
                    <div key={grp.date}>
                      <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 border-b border-border/60 bg-muted/40 px-4 py-1.5 backdrop-blur">
                        <div className="flex items-center gap-2">
                          <span className="font-['Syne',sans-serif] text-[11px] font-semibold uppercase tracking-wider text-foreground">{dateLabel(grp.date)}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">{grp.date}</span>
                        </div>
                        <span className="rounded bg-background/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{grp.rows.length}</span>
                      </div>
                      <div className="divide-y divide-border/40">
                        {grp.rows.map((g) => (
                          <div
                            key={`${g.symbol}-${g.reportDate}`}
                            onClick={() => setAnalysisCtx({
                              symbol: g.symbol, company: g.company, sector: g.sector,
                              gapPct: g.gapPct, epsSurprisePct: g.epsSurprisePct, revenueSurprisePct: g.revenueSurprisePct,
                              reportDate: g.reportDate, reportTime: g.reportTime,
                            })}
                            className="cursor-pointer px-4 py-3 transition-colors hover:bg-accent/30"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="font-mono text-sm font-bold text-foreground">{g.symbol}</span>
                                {reportTimeBadge(g.reportTime)}
                                <span className="truncate max-w-[280px] text-xs text-muted-foreground">{g.company ?? ""}</span>
                                {g.sector && <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">{g.sector}</span>}
                              </div>
                              <div className={`font-mono text-base font-bold ${gapColor(g.gapPct)}`}>
                                {fmtPct(g.gapPct, 1)}
                              </div>
                            </div>

                            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                              <div className="rounded border border-border/60 bg-muted/20 px-2 py-1">
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Mcap</div>
                                <div className="font-mono font-semibold text-foreground">{fmtMcap(g.marketCap)}</div>
                              </div>
                              <div className="rounded border border-border/60 bg-muted/20 px-2 py-1">
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">EPS Surprise</div>
                                <div className={`font-mono font-semibold ${g.epsSurprisePct !== null && g.epsSurprisePct >= 0 ? "text-[hsl(160,70%,50%)]" : g.epsSurprisePct !== null ? "text-destructive" : "text-muted-foreground"}`}>
                                  {g.epsSurprisePct !== null ? `${g.epsSurprisePct >= 0 ? "+" : ""}${g.epsSurprisePct.toFixed(1)}%` : "—"}
                                </div>
                              </div>
                              <div className="rounded border border-border/60 bg-muted/20 px-2 py-1">
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Rev Surprise</div>
                                <div className={`font-mono font-semibold ${g.revenueSurprisePct !== null && g.revenueSurprisePct >= 0 ? "text-[hsl(160,70%,50%)]" : g.revenueSurprisePct !== null ? "text-destructive" : "text-muted-foreground"}`}>
                                  {g.revenueSurprisePct !== null ? `${g.revenueSurprisePct >= 0 ? "+" : ""}${g.revenueSurprisePct.toFixed(1)}%` : "—"}
                                </div>
                              </div>
                              <div className="rounded border border-border/60 bg-muted/20 px-2 py-1">
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Open / Prev Close</div>
                                <div className="font-mono font-semibold text-foreground">{g.openPrice.toFixed(2)} / {g.prevClose.toFixed(2)}</div>
                              </div>
                            </div>

                            {g.aiAnalysis && (
                              <div className="mt-2 flex items-start gap-2 rounded-md border border-primary/30 bg-primary/[0.04] px-2.5 py-2 text-[12px] leading-relaxed text-foreground/90">
                                <Sparkles size={12} className="mt-0.5 shrink-0 text-primary" />
                                <span>{g.aiAnalysis}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()
          )}
        </section>
      </main>
      <EarningsAnalysisPanel ctx={analysisCtx} onClose={() => setAnalysisCtx(null)} />
    </div>
  );
}
