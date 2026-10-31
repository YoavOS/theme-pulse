import { useState, useMemo, useEffect } from "react";
import { ThemeData } from "@/data/themeData";
import { supabase } from "@/integrations/supabase/client";
import { ExternalLink, ArrowDown, ArrowUp, Newspaper, BarChart3, List, Sparkles, Trophy } from "lucide-react";
import { NewsArticle, SentimentData } from "@/hooks/useThemeNews";
import { NewsTabContent } from "@/components/NewsPanel";
import { FundamentalsData } from "@/hooks/useFundamentals";
import FundamentalsTab from "@/components/FundamentalsTab";
import type { TickerVolume } from "@/hooks/useVolumeData";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  groupVolume, readBreadth, tickerVolumeRatio, volumeBasisFor, volumeWords,
  BREADTH_LABEL, BREADTH_HELP, type VolumeStrength,
} from "@/lib/groupSignals";

const MONO = "'DM Mono', monospace";
const TF_COL: Record<string, string> = { Today: "Today", "1W": "1W", "1M": "1M", "3M": "3M", Overall: "Score" };

type SortKey = "symbol" | "pct" | "perf_1w" | "perf_1m" | "vol";
type SortDir = "asc" | "desc";
type Tab = "stocks" | "news" | "fundamentals";

interface TickerExtra {
  perf_1d: number | null;
  perf_1w: number | null;
  perf_1m: number | null;
  perf_3m: number | null;
  price: number | null;
}

export interface AiRead {
  summary: string | null;
  sentiment: SentimentData | null;
  headlines: number;
}

const fmtPct = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`;
const pctClass = (v: number | null | undefined) =>
  v === null || v === undefined ? "text-muted-foreground" : v > 0.005 ? "text-gain-medium" : v < -0.005 ? "text-loss-mild" : "text-muted-foreground";

function firstSentences(text: string, n: number): { head: string; rest: boolean } {
  // Split after . ! or ? (plus any closing quote) when a capitalised word follows, so
  // "$1.5 billion" or "U.S. onshoring" stay in one sentence.
  const parts = text.trim().split(/(?<=[.!?]["'\u201d)\]]*)\s+(?=["'\u201c([{]?[A-Z0-9$])/);
  if (parts.length <= n) return { head: text.trim(), rest: false };
  return { head: parts.slice(0, n).join(" ").trim(), rest: true };
}

/** The summarizer marks tickers as {SYM}; show them as symbols instead of braces. */
function withTickers(text: string) {
  return text.split(/\{([A-Z][A-Z0-9.-]{0,6})\}/g).map((part, i) =>
    i % 2 === 1
      ? <span key={i} className="font-semibold text-foreground" style={{ fontFamily: MONO }}>{part}</span>
      : <span key={i}>{part}</span>,
  );
}

/** Tiny horizontal meter used in the stat tiles and the volume column. */
function Meter({ value, max, tick, tone }: { value: number; max: number; tick?: number; tone: "gain" | "loss" | "neutral" | "brand" }) {
  const w = Math.max(0, Math.min(value, max)) / max * 100;
  const bg = tone === "gain" ? "hsl(var(--bar-green))" : tone === "loss" ? "hsl(var(--bar-red))" : tone === "brand" ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))";
  return (
    <div className="relative h-1.5 w-full rounded-full bg-bar-track">
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${w}%`, background: bg }} />
      {tick !== undefined && <div className="absolute -top-[3px] h-3 w-px bg-foreground/50" style={{ left: `${tick / max * 100}%` }} />}
    </div>
  );
}

function Stat({ label, children, foot }: { label: string; children: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-background/40 px-3 py-2.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
      {foot && <span className="text-[11px] leading-snug text-muted-foreground">{foot}</span>}
    </div>
  );
}

export default function ThemeDrilldownModal({
  theme,
  open,
  onOpenChange,
  defaultSortKey,
  newsArticles,
  fetchNewsForTheme,
  fundamentals,
  fetchFundamentals,
  isFundamentalsLoading,
  defaultTab,
  timeframe = "Today",
  volumeMap,
  loadAiRead,
  leaders,
}: {
  theme: ThemeData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultSortKey?: SortKey | "relVol";
  newsArticles?: NewsArticle[];
  fetchNewsForTheme?: (symbols: string[]) => Promise<NewsArticle[]>;
  fundamentals?: Record<string, FundamentalsData> | null;
  fetchFundamentals?: (symbols: string[]) => Promise<Record<string, FundamentalsData>>;
  isFundamentalsLoading?: boolean;
  defaultTab?: "tickers" | "news" | "fundamentals";
  timeframe?: string;
  volumeMap?: Record<string, TickerVolume>;
  /** News headlines → short AI summary for this group (the summary that used to live in Intelligence → Money Flow). */
  loadAiRead?: (theme: ThemeData) => Promise<AiRead>;
  /** Superperformance stocks (upper-case symbols) — marked with a trophy. */
  leaders?: Set<string>;
}) {
  const [sortKey, setSortKey] = useState<SortKey>(defaultSortKey === "relVol" ? "vol" : (defaultSortKey as SortKey) || "pct");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [extras, setExtras] = useState<Record<string, TickerExtra>>({});
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab === "news" ? "news" : defaultTab === "fundamentals" ? "fundamentals" : "stocks");
  const [localNews, setLocalNews] = useState<NewsArticle[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [localFundamentals, setLocalFundamentals] = useState<Record<string, FundamentalsData> | null>(null);
  const [fundLoading, setFundLoading] = useState(false);
  const [ai, setAi] = useState<AiRead | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  // Reset per group.
  useEffect(() => {
    setExtras({}); setLocalNews([]); setLocalFundamentals(null); setAi(null); setAiOpen(false);
    setActiveTab(defaultTab === "news" ? "news" : defaultTab === "fundamentals" ? "fundamentals" : "stocks");
  }, [theme?.theme_name, defaultTab]);

  // Longer-timeframe numbers for each stock (from the Dashboard's Full Scan snapshot).
  useEffect(() => {
    if (!theme || !open) return;
    const symbols = theme.tickers.map(t => t.symbol);
    if (symbols.length === 0) return;
    let cancelled = false;
    (async () => {
      const map: Record<string, TickerExtra> = {};
      for (let i = 0; i < symbols.length; i += 200) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types
        const { data } = await (supabase as any)
          .from("ticker_performance")
          .select("symbol, perf_1d, perf_1w, perf_1m, perf_3m, price")
          .in("symbol", symbols.slice(i, i + 200));
        for (const p of data ?? []) map[p.symbol] = { perf_1d: p.perf_1d, perf_1w: p.perf_1w, perf_1m: p.perf_1m, perf_3m: p.perf_3m, price: p.price };
      }
      if (!cancelled) setExtras(map);
    })();
    return () => { cancelled = true; };
  }, [theme, open]);

  // AI read of the news — loads on open, cached by the news hook.
  useEffect(() => {
    if (!theme || !open || !loadAiRead) return;
    let cancelled = false;
    setAiLoading(true);
    loadAiRead(theme)
      .then(r => { if (!cancelled) setAi(r); })
      .catch(() => { if (!cancelled) setAi({ summary: null, sentiment: null, headlines: 0 }); })
      .finally(() => { if (!cancelled) setAiLoading(false); });
    return () => { cancelled = true; };
  }, [theme, open, loadAiRead]);

  const valid = useMemo(() => (theme ? theme.tickers.filter(t => !t.skipped) : []), [theme]);
  const breadth = useMemo(() => readBreadth(valid.map(t => t.pct), theme?.performance_pct ?? 0), [valid, theme]);
  const vol: VolumeStrength | null = useMemo(
    () => groupVolume(valid.map(t => t.symbol), volumeMap, timeframe),
    [valid, volumeMap, timeframe],
  );
  const basis = volumeBasisFor(timeframe);
  const tickerVol = (sym: string) => tickerVolumeRatio(volumeMap?.[sym] ?? volumeMap?.[sym.toUpperCase()], basis);

  const leader = useMemo(() => {
    if (!valid.length || !theme) return null;
    const s = [...valid].sort((a, b) => (theme.performance_pct >= 0 ? b.pct - a.pct : a.pct - b.pct));
    return s[0];
  }, [valid, theme]);

  // % of the group's stocks rising over each timeframe — is participation growing or shrinking?
  const participation = useMemo(() => {
    const rows: { label: string; pct: number | null }[] = [];
    const share = (f: keyof TickerExtra) => {
      const v = valid.map(t => extras[t.symbol]?.[f]).filter((x): x is number => typeof x === "number");
      return v.length >= Math.max(2, valid.length * 0.6) ? Math.round(v.filter(x => x > 0).length / v.length * 100) : null;
    };
    rows.push({ label: "Today", pct: timeframe === "Today" ? breadth.pctUp : share("perf_1d") });
    rows.push({ label: "1W", pct: share("perf_1w") });
    rows.push({ label: "1M", pct: share("perf_1m") });
    rows.push({ label: "3M", pct: share("perf_3m") });
    return rows;
  }, [valid, extras, timeframe, breadth.pctUp]);
  const trendWord = useMemo(() => {
    const today = participation[0].pct, month = participation[2].pct;
    if (today === null || month === null) return null;
    if (today - month >= 15) return "Participation is widening: more stocks are joining in than over the past month.";
    if (month - today >= 15) return "Participation is shrinking: fewer stocks are rising now than over the past month.";
    return "Participation is steady compared with the past month.";
  }, [participation]);

  const sorted = useMemo(() => {
    const items = [...(theme?.tickers || [])];
    const val = (t: ThemeData["tickers"][number]): number => {
      switch (sortKey) {
        case "pct": return t.skipped ? -999 : t.pct;
        case "perf_1w": return extras[t.symbol]?.perf_1w ?? -999;
        case "perf_1m": return extras[t.symbol]?.perf_1m ?? -999;
        case "vol": return tickerVol(t.symbol) ?? -999;
        default: return 0;
      }
    };
    items.sort((a, b) => {
      if (sortKey === "symbol") return sortDir === "asc" ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol);
      return sortDir === "asc" ? val(a) - val(b) : val(b) - val(a);
    });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, sortKey, sortDir, extras, volumeMap, basis]);

  if (!theme) return null;

  const tfCol = TF_COL[timeframe] ?? timeframe;
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  // Plain-language read built from the numbers (no AI involved).
  const leaderShare = breadth.topTwoShare !== null && breadth.kind === "narrow-up" ? Math.round(breadth.topTwoShare * 100) : null;
  const dataRead = [
    `${breadth.up} of ${breadth.total} stocks ${timeframe === "Today" ? "rose today" : `are up over ${tfCol}`}`,
    breadth.medianPct !== null ? `; the typical stock is ${fmtPct(breadth.medianPct)}` : "",
    ". ",
    leader ? `${leader.symbol} ${theme.performance_pct >= 0 ? "led" : "fell most"} (${fmtPct(leader.pct)})` : "",
    leaderShare !== null ? `, and the top two stocks make up ${leaderShare}% of the gains` : "",
    leader ? ". " : "",
    vol ? `${volumeWords(vol).charAt(0).toUpperCase()}${volumeWords(vol).slice(1)}.` : "",
  ].join("");

  const leaderSyms = leaders ? valid.map(t => t.symbol).filter(sym => leaders.has(sym.toUpperCase())) : [];

  const aiText = ai?.summary ? firstSentences(ai.summary, 2) : null;
  const articles = newsArticles && newsArticles.length > 0 ? newsArticles : localNews;

  const openNews = async () => {
    setActiveTab("news");
    if ((!newsArticles || newsArticles.length === 0) && localNews.length === 0 && fetchNewsForTheme && !newsLoading) {
      setNewsLoading(true);
      setLocalNews(await fetchNewsForTheme(theme.tickers.map(t => t.symbol)));
      setNewsLoading(false);
    }
  };
  const openFundamentals = async () => {
    setActiveTab("fundamentals");
    if (!fundamentals && !localFundamentals && fetchFundamentals && !fundLoading) {
      setFundLoading(true);
      setLocalFundamentals(await fetchFundamentals(valid.map(t => t.symbol)));
      setFundLoading(false);
    }
  };

  const SortHead = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={`px-2 py-2 font-medium ${right ? "text-right" : "text-left"}`}>
      <button type="button" onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${sortKey === k ? "text-foreground" : ""}`}>
        {children}
        {sortKey === k && (sortDir === "desc" ? <ArrowDown size={10} /> : <ArrowUp size={10} />)}
      </button>
    </th>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-[820px] flex-col gap-0 overflow-hidden border-border bg-card p-0">
        {/* Header */}
        <div className="flex items-start gap-4 border-b border-border px-5 pb-4 pt-5 sm:px-6">
          <div className="min-w-0 flex-1 pr-6">
            <DialogTitle className="text-lg font-bold leading-tight text-foreground sm:text-xl" style={{ fontFamily: "'Syne', sans-serif" }}>
              {theme.theme_name}
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs text-muted-foreground">
              {valid.length} stocks · {timeframe === "Today" ? "today" : timeframe === "Overall" ? "overall score" : `last ${timeframe}`}
              {theme.notes ? ` · ${theme.notes}` : ""}
            </DialogDescription>
          </div>
          <span className={`mr-6 shrink-0 text-2xl font-semibold leading-none sm:text-3xl ${pctClass(theme.performance_pct)}`} style={{ fontFamily: MONO }}>
            {fmtPct(theme.performance_pct)}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Key numbers */}
          <div className="grid grid-cols-2 gap-2 px-5 pt-4 sm:grid-cols-4 sm:px-6">
            <Stat
              label="Stocks rising"
              foot={breadth.kind ? <span title={BREADTH_HELP[breadth.kind]}>{BREADTH_LABEL[breadth.kind]}</span> : breadth.total < 4 ? "Too few stocks to judge" : undefined}
            >
              <span className="text-base font-semibold text-foreground" style={{ fontFamily: MONO }}>
                {breadth.up}/{breadth.total} <span className="text-xs font-normal text-muted-foreground">{breadth.pctUp}%</span>
              </span>
              <Meter value={breadth.pctUp} max={100} tone={breadth.pctUp >= 50 ? "gain" : "loss"} />
            </Stat>
            <Stat label="Volume vs normal" foot={vol ? (basis === "today" ? "Today vs 20-day avg" : "2 weeks vs 3-month avg") : "Not loaded"}>
              <span className="text-base font-semibold text-foreground" style={{ fontFamily: MONO }}>{vol ? `${vol.ratio.toFixed(1)}×` : "—"}</span>
              <Meter value={vol?.ratio ?? 0} max={3} tick={1} tone={vol && vol.ratio >= 1.5 ? "brand" : "neutral"} />
            </Stat>
            <Stat label="Typical stock" foot="Median, so one big mover can't skew it">
              <span className={`text-base font-semibold ${pctClass(breadth.medianPct)}`} style={{ fontFamily: MONO }}>{fmtPct(breadth.medianPct)}</span>
            </Stat>
            <Stat label={theme.performance_pct >= 0 ? "Leader" : "Weakest"} foot={leader?.name ? <span className="block truncate">{leader.name}</span> : undefined}>
              <span className="flex items-baseline gap-2 text-base font-semibold" style={{ fontFamily: MONO }}>
                <span className="text-foreground">{leader?.symbol ?? "—"}</span>
                <span className={`text-sm ${pctClass(leader?.pct)}`}>{fmtPct(leader?.pct)}</span>
              </span>
            </Stat>
          </div>

          {/* What's happening: numbers in words + AI summary of the news */}
          <section className="mx-5 mt-3 rounded-lg border border-border bg-background/40 px-4 py-3 sm:mx-6">
            <h3 className="text-xs font-semibold text-foreground">What's happening</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/90">{dataRead}</p>
            {leaderSyms.length > 0 && (
              <p className="mt-1.5 flex items-start gap-1.5 text-[13px] leading-relaxed text-foreground/90">
                <Trophy size={13} className="mt-0.5 shrink-0 text-[hsl(40,90%,55%)]" />
                <span>
                  {leaderSyms.length === 1 ? "1 stock is" : `${leaderSyms.length} stocks are`} on your Superperformance list:{" "}
                  <span className="font-semibold" style={{ fontFamily: MONO }}>{leaderSyms.slice(0, 6).join(", ")}{leaderSyms.length > 6 ? "…" : ""}</span>
                </span>
              </p>
            )}
            <div className="mt-3 border-t border-border/60 pt-3">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Sparkles size={12} className="text-primary" />
                <span>AI summary of recent news{ai && ai.headlines > 0 ? ` · ${ai.headlines} headlines` : ""}</span>
                {ai?.sentiment && (
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${ai.sentiment.sentiment === "bullish" ? "bg-gain-medium/15 text-gain-medium" : ai.sentiment.sentiment === "bearish" ? "bg-loss-mild/15 text-loss-mild" : "bg-secondary text-muted-foreground"}`}>
                    {ai.sentiment.sentiment}
                  </span>
                )}
              </div>
              {aiLoading ? (
                <div className="mt-2 space-y-1.5"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-[85%]" /></div>
              ) : aiText ? (
                <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/85">
                  {withTickers(aiOpen ? ai!.summary! : aiText.head)}
                  {aiText.rest && (
                    <button type="button" onClick={() => setAiOpen(o => !o)} className="ml-1.5 text-xs font-medium text-primary hover:underline">
                      {aiOpen ? "Show less" : "Read more"}
                    </button>
                  )}
                </p>
              ) : (
                <p className="mt-1.5 text-[13px] text-muted-foreground">
                  {loadAiRead ? "No recent news found for these stocks, so there's nothing to summarize." : "AI summary unavailable."}
                </p>
              )}
            </div>
          </section>

          {/* Participation over time */}
          <section className="mx-5 mt-3 sm:mx-6">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h3 className="text-xs font-semibold text-foreground">Share of stocks rising</h3>
              {trendWord && <span className="text-[11px] text-muted-foreground">{trendWord}</span>}
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {participation.map(p => (
                <div key={p.label} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between text-[11px]">
                    <span className="text-muted-foreground">{p.label}</span>
                    <span className="text-foreground" style={{ fontFamily: MONO }}>{p.pct === null ? "—" : `${p.pct}%`}</span>
                  </div>
                  <Meter value={p.pct ?? 0} max={100} tone={(p.pct ?? 0) >= 50 ? "gain" : "loss"} />
                </div>
              ))}
            </div>
          </section>

          {/* Tabs */}
          <div className="mt-4 flex items-center gap-1 border-b border-border px-5 sm:px-6" role="tablist">
            {([
              ["stocks", "Stocks", <List key="i" size={12} />, () => setActiveTab("stocks")],
              ["news", "News", <Newspaper key="i" size={12} />, openNews],
              ["fundamentals", "Fundamentals", <BarChart3 key="i" size={12} />, openFundamentals],
            ] as [Tab, string, React.ReactNode, () => void][]).map(([key, label, icon, onClick]) => (
              <button
                key={key}
                role="tab"
                aria-selected={activeTab === key}
                onClick={onClick}
                className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${activeTab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {icon}{label}
                {key === "news" && articles.length > 0 && <span className="rounded-full bg-primary/15 px-1.5 text-[9px] font-bold text-primary">{articles.length}</span>}
              </button>
            ))}
          </div>

          {activeTab === "stocks" ? (
            <div className="overflow-x-auto px-3 pb-3 sm:px-4">
              <table className="w-full min-w-[520px] text-xs">
                <thead className="text-[11px] text-muted-foreground">
                  <tr className="border-b border-border">
                    <SortHead k="symbol">Stock</SortHead>
                    <SortHead k="pct" right>{tfCol}</SortHead>
                    <SortHead k="perf_1w" right>1W</SortHead>
                    <SortHead k="perf_1m" right>1M</SortHead>
                    <SortHead k="vol">Volume vs normal</SortHead>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(t => {
                    const ex = extras[t.symbol];
                    const v = tickerVol(t.symbol);
                    return (
                      <tr key={t.symbol} className="border-b border-border/50 transition-colors hover:bg-accent/30">
                        <td className="px-2 py-2">
                          <a
                            href={`https://www.tradingview.com/symbols/${t.symbol}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group inline-flex min-w-0 items-baseline gap-2"
                          >
                            <span className="font-semibold text-foreground group-hover:text-primary" style={{ fontFamily: MONO }}>{t.symbol}</span>
                            {leaders?.has(t.symbol.toUpperCase()) && <Trophy size={11} className="self-center text-[hsl(40,90%,55%)]" aria-label="Superperformance stock" />}
                            {t.name && <span className="hidden max-w-[180px] truncate text-[11px] text-muted-foreground sm:inline">{t.name}</span>}
                            <ExternalLink size={9} className="self-center text-muted-foreground opacity-0 group-hover:opacity-100" />
                          </a>
                        </td>
                        <td className={`px-2 py-2 text-right font-semibold ${t.skipped ? "text-muted-foreground" : pctClass(t.pct)}`} style={{ fontFamily: MONO }}>
                          {t.skipped ? "N/A" : fmtPct(t.pct)}
                        </td>
                        <td className={`px-2 py-2 text-right ${pctClass(ex?.perf_1w)}`} style={{ fontFamily: MONO }}>{fmtPct(ex?.perf_1w)}</td>
                        <td className={`px-2 py-2 text-right ${pctClass(ex?.perf_1m)}`} style={{ fontFamily: MONO }}>{fmtPct(ex?.perf_1m)}</td>
                        <td className="px-2 py-2">
                          {v === null ? <span className="text-muted-foreground">—</span> : (
                            <span className="flex items-center gap-2">
                              <span className="w-9 text-right text-foreground/90" style={{ fontFamily: MONO }}>{v.toFixed(1)}×</span>
                              <span className="w-16"><Meter value={v} max={3} tick={1} tone={v >= 1.5 ? "brand" : "neutral"} /></span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : activeTab === "news" ? (
            <div className="px-5 py-3 sm:px-6">
              {newsLoading ? (
                <div className="space-y-2 py-2"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-[90%]" /><Skeleton className="h-3 w-[75%]" /></div>
              ) : (
                <NewsTabContent articles={articles} />
              )}
            </div>
          ) : (
            <FundamentalsTab
              theme={theme}
              fundamentals={fundamentals || localFundamentals}
              isLoading={fundLoading || (isFundamentalsLoading ?? false)}
              tickerPrices={Object.fromEntries(valid.map(t => [t.symbol, extras[t.symbol]?.price || 0]))}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
