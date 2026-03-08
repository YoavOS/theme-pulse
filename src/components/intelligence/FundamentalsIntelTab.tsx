import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { ThemeIntelData } from "@/hooks/useThemeIntelligence";
import { FundamentalsData, getScoreLabel, getStockTypeInfo, getScoreBadgeColor, getSmartMoneyColor } from "@/hooks/useFundamentals";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { ArrowUpDown, ChevronDown, ChevronRight, Loader2 } from "lucide-react";

const DM_MONO = "'DM Mono', monospace";

interface ThemeFundamentals {
  themeName: string;
  avgScore: number | null;
  avgRevenueGrowth: number | null;
  avgNetMargin: number | null;
  avgDebtToEquity: number | null;
  dominantStockType: string;
  analystConsensus: string;
  tickerCount: number;
  dataCount: number;
  tickers: { symbol: string; score: number | null; stockType: string | null }[];
  momentumScore: number;
  avgInstitutionalPct: number | null;
  avgSmartMoneyScore: number | null;
  insiderNetBuying: number;
  insiderNetBuyingTotal: number;
}

type SortKey = "rank" | "name" | "score" | "growth" | "margin" | "debt" | "type" | "smartMoney" | "instPct";
type SortDir = "asc" | "desc";

function sanitize(value: number | null, min: number, max: number): number | null {
  if (value === null || value < min || value > max) return null;
  return value;
}

function safeAvg(values: (number | null)[], min: number, max: number): number | null {
  const clean = values.map(v => sanitize(v, min, max)).filter((v): v is number => v !== null);
  if (clean.length === 0) return null;
  return Math.round(clean.reduce((a, b) => a + b, 0) / clean.length * 10) / 10;
}

function mostCommon(arr: string[]): string {
  const counts: Record<string, number> = {};
  for (const v of arr) counts[v] = (counts[v] || 0) + 1;
  let best = "blend", bestCount = 0;
  for (const [k, c] of Object.entries(counts)) {
    if (c > bestCount) { best = k; bestCount = c; }
  }
  return best;
}

function avgRating(ratings: (string | null)[]): string {
  const valid = ratings.filter((r): r is string => r !== null);
  if (valid.length === 0) return "N/A";
  const map: Record<string, number> = { "Strong Buy": 1, Buy: 2, Hold: 3, Sell: 4, "Strong Sell": 5 };
  const reverseMap = ["", "Strong Buy", "Buy", "Hold", "Sell", "Strong Sell"];
  const avg = valid.reduce((s, r) => s + (map[r] ?? 3), 0) / valid.length;
  return reverseMap[Math.round(avg)] || "Hold";
}

export default function FundamentalsIntelTab({
  themes,
  isLoading: dataLoading,
}: {
  themes: ThemeIntelData[];
  isLoading: boolean;
}) {
  const [allFundamentals, setAllFundamentals] = useState<Record<string, FundamentalsData>>({});
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedTheme, setExpandedTheme] = useState<string | null>(null);
  const [prefetchState, setPrefetchState] = useState<{ active: boolean; completed: number; total: number; done: boolean }>({ active: false, completed: 0, total: 0, done: false });
  const prefetchCompletedRef = useRef(false);

  // Fetch all fundamentals from cache
  const loadFromCache = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("fundamentals_cache")
        .select("*");
      
      if (data) {
        const map: Record<string, FundamentalsData> = {};
        for (const row of data) {
          map[row.symbol] = row as unknown as FundamentalsData;
        }
        setAllFundamentals(map);
        return Object.keys(map).length;
      }
      return 0;
    } catch (e) {
      console.error("Failed to load fundamentals:", e);
      return 0;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFromCache();
  }, [loadFromCache]);

  const themeFundamentals = useMemo(() => {
    return themes.map(t => {
      const tickerData = t.symbols.map(s => allFundamentals[s]).filter(Boolean);
      const scores = tickerData.map(d => d.fundamental_score).filter((s): s is number => s !== null);
      const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

      const types = tickerData.map(d => d.stock_type).filter((v): v is string => v !== null);
      const ratings = tickerData.map(d => d.analyst_rating);

      // Smart money aggregation
      const instPcts = tickerData.map(d => d.institutional_ownership_pct).filter((v): v is number => v !== null);
      const smScores = tickerData.map(d => d.smart_money_score).filter((v): v is number => v !== null);
      let insiderNetBuying = 0;
      let insiderNetBuyingTotal = 0;
      for (const d of tickerData) {
        const buys = d.recent_insider_buys ?? 0;
        const sells = d.recent_insider_sells ?? 0;
        if (buys > 0 || sells > 0) {
          insiderNetBuyingTotal++;
          if (buys > sells) insiderNetBuying++;
        }
      }

      return {
        themeName: t.themeName,
        avgScore,
        avgRevenueGrowth: safeAvg(tickerData.map(d => d.revenue_growth_1y), -100, 500),
        avgNetMargin: safeAvg(tickerData.map(d => d.net_margin), -200, 100),
        avgDebtToEquity: (() => {
          const clean = tickerData.map(d => sanitize(d.debt_to_equity, 0, 20)).filter((v): v is number => v !== null);
          return clean.length > 0 ? Math.round(clean.reduce((a, b) => a + b, 0) / clean.length * 100) / 100 : null;
        })(),
        dominantStockType: mostCommon(types),
        analystConsensus: avgRating(ratings),
        tickerCount: t.symbols.length,
        dataCount: tickerData.length,
        tickers: t.symbols.map(s => ({
          symbol: s,
          score: allFundamentals[s]?.fundamental_score ?? null,
          stockType: allFundamentals[s]?.stock_type ?? null,
        })),
        momentumScore: t.momentumScore,
        avgInstitutionalPct: instPcts.length > 0 ? Math.round(instPcts.reduce((a, b) => a + b, 0) / instPcts.length * 10) / 10 : null,
        avgSmartMoneyScore: smScores.length > 0 ? Math.round(smScores.reduce((a, b) => a + b, 0) / smScores.length) : null,
        insiderNetBuying,
        insiderNetBuyingTotal,
      } as ThemeFundamentals;
    });
  }, [themes, allFundamentals]);

  const sorted = useMemo(() => {
    const items = [...themeFundamentals];
    items.sort((a, b) => {
      let av: number | string, bv: number | string;
      switch (sortKey) {
        case "name": return sortDir === "asc" ? a.themeName.localeCompare(b.themeName) : b.themeName.localeCompare(a.themeName);
        case "score": av = a.avgScore ?? -1; bv = b.avgScore ?? -1; break;
        case "growth": av = a.avgRevenueGrowth ?? -999; bv = b.avgRevenueGrowth ?? -999; break;
        case "margin": av = a.avgNetMargin ?? -999; bv = b.avgNetMargin ?? -999; break;
        case "debt": av = a.avgDebtToEquity ?? 999; bv = b.avgDebtToEquity ?? 999; break;
        case "type": return sortDir === "asc" ? a.dominantStockType.localeCompare(b.dominantStockType) : b.dominantStockType.localeCompare(a.dominantStockType);
        case "smartMoney": av = a.avgSmartMoneyScore ?? -1; bv = b.avgSmartMoneyScore ?? -1; break;
        case "instPct": av = a.avgInstitutionalPct ?? -1; bv = b.avgInstitutionalPct ?? -1; break;
        default: av = a.avgScore ?? -1; bv = b.avgScore ?? -1;
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return items;
  }, [themeFundamentals, sortKey, sortDir]);

  // Fundamental vs Momentum Matrix
  const matrix = useMemo(() => {
    const strong: ThemeFundamentals[] = [];
    const value: ThemeFundamentals[] = [];
    const momentum: ThemeFundamentals[] = [];
    const avoid: ThemeFundamentals[] = [];

    for (const t of themeFundamentals) {
      if (t.avgScore === null) { avoid.push(t); continue; }
      const strongFund = t.avgScore >= 55;
      const strongMom = t.momentumScore >= 55;

      if (strongFund && strongMom) strong.push(t);
      else if (strongFund && !strongMom) value.push(t);
      else if (!strongFund && strongMom) momentum.push(t);
      else avoid.push(t);
    }
    return { strong, value, momentum, avoid };
  }, [themeFundamentals]);

  const hasData = Object.keys(allFundamentals).length > 0;

  // Check if smart money data is missing from cached fundamentals
  const smartMoneyMissing = useMemo(() => {
    if (!hasData) return false;
    const entries = Object.values(allFundamentals);
    if (entries.length === 0) return false;
    // If >80% of entries have null smart_money_score, consider it missing
    const nullCount = entries.filter(e => e.smart_money_score === null).length;
    return nullCount / entries.length > 0.8;
  }, [allFundamentals, hasData]);

  // Check localStorage for today's prefetch
  const alreadyPrefetchedToday = useMemo(() => {
    try {
      const stored = localStorage.getItem("fundamentalsPrefetched");
      if (!stored) return false;
      const today = new Date().toISOString().slice(0, 10);
      return stored === today;
    } catch { return false; }
  }, []);

  // Auto-prefetch top 10 themes — runs once on mount only
  useEffect(() => {
    if (prefetchCompletedRef.current) return;
    // Skip if already prefetched today AND smart money data exists
    if (alreadyPrefetchedToday && !smartMoneyMissing) return;
    if (dataLoading || themes.length === 0) return;

    // Wait for initial cache load to finish
    if (loading) return;
    // If data exists and smart money is present, skip
    if (hasData && !smartMoneyMissing) {
      prefetchCompletedRef.current = true;
      return;
    }

    prefetchCompletedRef.current = true; // mark immediately to prevent re-trigger

    const topThemes = [...themes]
      .sort((a, b) => b.momentumScore - a.momentumScore)
      .slice(0, 10);

    const total = topThemes.length;
    setPrefetchState({ active: true, completed: 0, total, done: false });

    (async () => {
      for (let i = 0; i < topThemes.length; i++) {
        const theme = topThemes[i];
        try {
          await supabase.functions.invoke("fetch-fundamentals", {
            body: { symbols: theme.symbols },
          });
        } catch (e) {
          console.error(`Prefetch failed for ${theme.themeName}:`, e);
        }
        setPrefetchState({ active: true, completed: i + 1, total, done: false });
      }

      // Mark done in localStorage
      try {
        localStorage.setItem("fundamentalsPrefetched", new Date().toISOString().slice(0, 10));
      } catch {}

      // Show completion message briefly
      setPrefetchState({ active: false, completed: total, total, done: true });

      // Reload cache
      await loadFromCache();

      // After 2 seconds, clear the done state to show the actual data
      setTimeout(() => {
        setPrefetchState(prev => ({ ...prev, done: false }));
      }, 2000);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, dataLoading, themes.length]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  if (dataLoading || loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
    );
  }

  if (prefetchState.done) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg py-16 text-center gap-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <span className="text-2xl">✓</span>
        <h3 className="font-['Syne',sans-serif] text-lg font-semibold text-foreground">
          Fundamentals loaded — showing top {prefetchState.total} themes
        </h3>
      </div>
    );
  }

  if (!hasData && !prefetchState.active) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg py-16 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <h3 className="font-['Syne',sans-serif] text-lg font-semibold text-foreground mb-1">No Fundamental Data Yet</h3>
        <p className="text-sm text-muted-foreground">Open any theme's drill-down modal and click the Fundamentals tab to start fetching data.</p>
        <p className="text-xs text-muted-foreground mt-1">Data will be cached for 24 hours once fetched.</p>
      </div>
    );
  }

  if (prefetchState.active) {
    const pct = prefetchState.total > 0 ? Math.round((prefetchState.completed / prefetchState.total) * 100) : 0;
    return (
      <div className="flex flex-col items-center justify-center rounded-lg py-16 text-center gap-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <h3 className="font-['Syne',sans-serif] text-lg font-semibold text-foreground">
          Fetching fundamentals for top themes…
        </h3>
        <p className="text-sm text-muted-foreground" style={{ fontFamily: "'DM Mono', monospace" }}>
          {prefetchState.completed}/{prefetchState.total} complete
        </p>
        <div className="w-64">
          <Progress value={pct} className="h-2" />
        </div>
        <p className="text-xs text-muted-foreground">This may take a few minutes due to API rate limits</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Ranked Table */}
      <div className="rounded-lg overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="px-4 py-3">
          <h4 className="font-['Syne',sans-serif] text-xs font-semibold uppercase tracking-widest text-primary">
            Theme Fundamental Rankings
          </h4>
        </div>
        <div className="max-h-[400px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10" style={{ background: "rgba(15,18,25,0.95)" }}>
              <tr className="border-b border-border">
                {([
                  ["rank", "#"],
                  ["name", "Theme"],
                  ["score", "Avg Score"],
                  ["type", "Type"],
                  ["growth", "Avg Growth"],
                  ["margin", "Avg Margin"],
                  ["debt", "Avg D/E"],
                  ["instPct", "Inst %"],
                  ["smartMoney", "Smart $"],
                ] as [SortKey, string][]).map(([key, label]) => (
                  <th
                    key={key}
                    onClick={() => toggleSort(key)}
                    className="cursor-pointer select-none px-3 py-2 text-left font-medium text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
                  >
                    <span className="inline-flex items-center gap-1">
                      {label}
                      {sortKey === key && <ArrowUpDown size={10} className="text-primary" />}
                    </span>
                  </th>
                ))}
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Insider</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t, i) => {
                const typeInfo = getStockTypeInfo(t.dominantStockType);
                const scoreLabel = t.avgScore !== null ? getScoreLabel(t.avgScore) : null;
                const isExpanded = expandedTheme === t.themeName;
                const smColor = getSmartMoneyColor(t.avgSmartMoneyScore);

                return (
                  <>
                    <tr
                      key={t.themeName}
                      onClick={() => setExpandedTheme(isExpanded ? null : t.themeName)}
                      className="border-b border-border/50 hover:bg-accent/30 transition-colors cursor-pointer"
                    >
                      <td className="px-3 py-2 text-muted-foreground" style={{ fontFamily: DM_MONO }}>{i + 1}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                          <span className="font-['Syne',sans-serif] font-medium text-foreground">{t.themeName}</span>
                          {t.dataCount < t.tickerCount && (
                            <span className="text-[9px] text-muted-foreground">{t.dataCount}/{t.tickerCount}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {t.avgScore !== null ? (
                          <div className="flex items-center gap-2">
                            <div className="w-12 h-1.5 rounded-full bg-secondary/60 overflow-hidden">
                              <div className="h-full rounded-full" style={{
                                width: `${t.avgScore}%`,
                                background: t.avgScore >= 70 ? "hsl(var(--primary))" : t.avgScore >= 50 ? "hsl(152,100%,50%)" : t.avgScore >= 30 ? "#facc15" : "hsl(var(--destructive))"
                              }} />
                            </div>
                            <span className={`font-semibold ${scoreLabel!.color}`} style={{ fontFamily: DM_MONO }}>{t.avgScore}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground" style={{ fontFamily: DM_MONO }}>—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-[10px] font-semibold ${typeInfo.color}`}>
                          {typeInfo.emoji} {typeInfo.label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`font-mono ${t.avgRevenueGrowth != null ? (t.avgRevenueGrowth >= 0 ? "text-gain-medium" : "text-loss-mild") : "text-muted-foreground"}`} style={{ fontFamily: DM_MONO }}>
                          {t.avgRevenueGrowth != null ? `${t.avgRevenueGrowth >= 0 ? "+" : ""}${t.avgRevenueGrowth.toFixed(1)}%` : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`font-mono ${t.avgNetMargin != null ? (t.avgNetMargin >= 0 ? "text-gain-medium" : "text-loss-mild") : "text-muted-foreground"}`} style={{ fontFamily: DM_MONO }}>
                          {t.avgNetMargin != null ? `${t.avgNetMargin.toFixed(1)}%` : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-muted-foreground" style={{ fontFamily: DM_MONO }}>
                          {t.avgDebtToEquity != null ? t.avgDebtToEquity.toFixed(2) : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-muted-foreground" style={{ fontFamily: DM_MONO }}>
                          {t.avgInstitutionalPct != null ? `${t.avgInstitutionalPct.toFixed(0)}%` : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`font-semibold ${smColor}`} style={{ fontFamily: DM_MONO }}>
                          {t.avgSmartMoneyScore != null ? t.avgSmartMoneyScore : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {t.insiderNetBuyingTotal > 0 ? (
                          <span className={`text-[10px] ${t.insiderNetBuying > t.insiderNetBuyingTotal / 2 ? "text-[#00f5c4]" : "text-[#f5a623]"}`}>
                            {t.insiderNetBuying}/{t.insiderNetBuyingTotal} buying
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-[10px]">—</span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${t.themeName}-expand`}>
                        <td colSpan={11} className="px-8 py-2" style={{ background: "rgba(255,255,255,0.02)" }}>
                          <div className="flex flex-wrap gap-2">
                            {t.tickers.map(tk => {
                              const ti = getStockTypeInfo(tk.stockType);
                              return (
                                <div key={tk.symbol} className="inline-flex items-center gap-1.5 rounded-md bg-secondary/40 px-2 py-1 text-[10px]">
                                  <span className="font-bold text-foreground" style={{ fontFamily: DM_MONO }}>{tk.symbol}</span>
                                  {tk.score != null && (
                                    <span className={`font-semibold ${getScoreLabel(tk.score).color}`} style={{ fontFamily: DM_MONO }}>F:{tk.score}</span>
                                  )}
                                  {tk.stockType && (
                                    <span className="text-muted-foreground">{ti.emoji}</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Fundamental vs Momentum Matrix */}
      <div className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <h4 className="font-['Syne',sans-serif] text-xs font-semibold uppercase tracking-widest text-primary mb-4">
          Fundamental vs Momentum Matrix
        </h4>
        <div className="grid grid-cols-2 gap-3">
          {([
            { key: "strong", title: "🏆 Strong Fund + Strong Mom", subtitle: "High conviction — fundamentals and price agree", themes: matrix.strong, color: "#00f5c4" },
            { key: "momentum", title: "⚠️ Weak Fund + Strong Mom", subtitle: "Momentum trade only — fundamentals don't support the move", themes: matrix.momentum, color: "#f5a623" },
            { key: "value", title: "💎 Strong Fund + Weak Mom", subtitle: "Potential value opportunity — good company, bad price action", themes: matrix.value, color: "#60a5fa" },
            { key: "avoid", title: "🚫 Weak Fund + Weak Mom", subtitle: "Avoid — both price and fundamentals are weak", themes: matrix.avoid, color: "#ef4444" },
          ] as const).map(q => (
            <div key={q.key} className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${q.color}20` }}>
              <h5 className="text-[11px] font-semibold text-foreground mb-0.5">{q.title}</h5>
              <p className="text-[10px] text-muted-foreground mb-2">{q.subtitle}</p>
              <div className="flex flex-wrap gap-1">
                {q.themes.slice(0, 8).map(t => (
                  <span key={t.themeName} className="rounded bg-secondary/50 px-1.5 py-0.5 text-[10px] text-foreground" style={{ fontFamily: DM_MONO }}>
                    {t.themeName}
                    <span className="ml-1 text-muted-foreground">F:{t.avgScore ?? "—"}</span>
                  </span>
                ))}
                {q.themes.length > 8 && (
                  <span className="text-[10px] text-muted-foreground">+{q.themes.length - 8} more</span>
                )}
                {q.themes.length === 0 && (
                  <span className="text-[10px] text-muted-foreground italic">None</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Smart Money Leaders */}
      {(() => {
        const smLeaders = [...themeFundamentals]
          .filter(t => t.avgSmartMoneyScore != null && t.avgSmartMoneyScore > 0)
          .sort((a, b) => (b.avgSmartMoneyScore ?? 0) - (a.avgSmartMoneyScore ?? 0))
          .slice(0, 5);
        if (smLeaders.length === 0) return null;
        return (
          <div className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <h4 className="font-['Syne',sans-serif] text-xs font-semibold uppercase tracking-widest text-[#00f5c4] mb-3">
              🏛️ Highest Institutional Backing
            </h4>
            <div className="space-y-2">
              {smLeaders.map(t => {
                const smScore = t.avgSmartMoneyScore ?? 0;
                const barColor = smScore > 75 ? "hsl(var(--primary))" : smScore > 50 ? "hsl(152,100%,50%)" : "#facc15";
                return (
                  <div key={t.themeName} className="flex items-center gap-3 text-xs">
                    <span className="font-['Syne',sans-serif] font-medium text-foreground w-32 truncate">{t.themeName}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-secondary/60 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${smScore}%`, background: barColor }} />
                    </div>
                    <span className={`font-semibold w-8 text-right ${getSmartMoneyColor(smScore)}`} style={{ fontFamily: DM_MONO }}>{smScore}</span>
                    <span className="text-muted-foreground w-12 text-right" style={{ fontFamily: DM_MONO }}>
                      {t.avgInstitutionalPct != null ? `${t.avgInstitutionalPct.toFixed(0)}%` : "—"}
                    </span>
                    {t.insiderNetBuyingTotal > 0 && (
                      <span className={`text-[10px] w-20 ${t.insiderNetBuying > t.insiderNetBuyingTotal / 2 ? "text-[#00f5c4]" : "text-[#f5a623]"}`}>
                        {t.insiderNetBuying}/{t.insiderNetBuyingTotal} buying
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
