import { useState, useCallback, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, RefreshCw, Sun, Loader2, Calendar, Newspaper,
  TrendingUp, TrendingDown, Minus, Sparkles, X, ChevronDown, ChevronUp, ExternalLink,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { useThemeIntelligence } from "@/hooks/useThemeIntelligence";
import { useSpyBenchmark } from "@/hooks/useSpyBenchmark";
import { useThemeNews, NewsArticle } from "@/hooks/useThemeNews";
import { toast } from "sonner";

const DM_MONO = "'DM Mono', monospace";
const CACHE_KEY = "morning_brief_cache_v2";
const EVENTS_CACHE_KEY = "morning_brief_events_v2";
const EVENTS_UPCOMING_KEY = "morning_brief_events_upcoming_v1";
const DIGEST_CACHE_KEY = "morning_brief_digest_v1";
const EXPLAIN_CACHE_KEY = "morning_brief_explain_v1"; // map of hash → ExplainResult

interface BriefCache { brief: string; generatedAt: string; }

interface EconEvent {
  date: string;
  country: string;
  event: string;
  impact: "High" | "Medium" | "Low" | "None";
  actual: number | string | null;
  estimate: number | string | null;
  previous: number | string | null;
  unit: string | null;
  currency: string | null;
}

interface DigestBullet { text: string; impact: "Bullish" | "Bearish" | "Neutral"; }
interface DigestGroup { theme: string; impact: "High" | "Medium" | "Low"; bullets: DigestBullet[]; }

interface ExplainResult {
  what: string;
  expected: string;
  impact_level: "High" | "Medium" | "Low";
  impact_text: string;
  generatedAt: string;
}

type ExplainTarget =
  | { kind: "event"; title: string; payload: any }
  | { kind: "news"; title: string; payload: any };

// ---------- helpers ----------
function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}
function impactColor(impact: string): string {
  if (impact === "High") return "text-[hsl(0,75%,60%)] border-[hsl(0,75%,60%)]/40 bg-[hsl(0,75%,60%)]/10";
  if (impact === "Medium") return "text-[hsl(40,90%,55%)] border-[hsl(40,90%,55%)]/40 bg-[hsl(40,90%,55%)]/10";
  if (impact === "Low") return "text-[hsl(140,60%,55%)] border-[hsl(140,60%,55%)]/40 bg-[hsl(140,60%,55%)]/10";
  return "text-muted-foreground border-border bg-secondary/40";
}
function directionPill(impact: string) {
  if (impact === "Bullish") return { cls: "text-[hsl(140,60%,55%)]", icon: <TrendingUp size={11} /> };
  if (impact === "Bearish") return { cls: "text-[hsl(0,75%,60%)]", icon: <TrendingDown size={11} /> };
  return { cls: "text-muted-foreground", icon: <Minus size={11} /> };
}
function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i} className="font-semibold text-foreground" style={{ fontFamily: DM_MONO }}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  );
}
function hashKey(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return `k${Math.abs(h)}`;
}

// Map theme name → keywords used to filter raw market news for that section
const THEME_KEYWORDS: Record<string, string[]> = {
  "Fed & Macro Policy": ["fed", "fomc", "powell", "rate", "rates", "central bank", "treasury", "yield", "dollar", "dxy"],
  "Inflation & Economic Data": ["cpi", "ppi", "inflation", "jobs", "payroll", "unemployment", "gdp", "retail sales", "pmi", "ism", "consumer"],
  "Geopolitics": ["iran", "israel", "ukraine", "russia", "china", "tariff", "sanction", "war", "conflict", "trump", "pentagon", "nato", "geneva", "hormuz"],
  "AI & Tech": ["ai ", "artificial intelligence", "chip", "semiconductor", "nvidia", "nvda", "amd", "microsoft", "msft", "google", "googl", "meta", "apple", "aapl", "openai", "data center"],
  "Energy & Commodities": ["oil", "crude", "gas", "energy", "opec", "gold", "silver", "copper", "barrel", "lng", "pipeline"],
  "Earnings & Corporate": ["earnings", "revenue", "guidance", "beats", "misses", "quarterly", "results", "profit", "merger", "acquisition", "buyback", "dividend"],
  "Crypto & Risk Sentiment": ["bitcoin", "btc", "ethereum", "eth", "crypto", "coinbase", "risk-off", "risk on", "vix"],
};

function matchHeadlinesForTheme(themeName: string, articles: NewsArticle[] | null | undefined, excludeBulletTexts: string[]): NewsArticle[] {
  if (!articles || articles.length === 0) return [];
  const kws = THEME_KEYWORDS[themeName] || [];
  const excludeSet = new Set(excludeBulletTexts.map(t => t.toLowerCase().replace(/\*\*/g, "").slice(0, 50)));
  const out: NewsArticle[] = [];
  const seen = new Set<string>();
  for (const a of articles) {
    if (!a.headline) continue;
    const key = a.url || a.headline;
    if (seen.has(key)) continue;
    const lower = a.headline.toLowerCase();
    if (excludeSet.has(lower.slice(0, 50))) continue;
    const match = kws.length === 0 ? true : kws.some(k => lower.includes(k));
    if (match) { out.push(a); seen.add(key); }
    if (out.length >= 15) break;
  }
  return out;
}
function readExplainCache(): Record<string, ExplainResult> {
  try { return JSON.parse(localStorage.getItem(EXPLAIN_CACHE_KEY) || "{}"); } catch { return {}; }
}
function writeExplainCache(map: Record<string, ExplainResult>) {
  // Trim to 200 most recent
  const entries = Object.entries(map);
  if (entries.length > 200) {
    entries.sort((a, b) => new Date(b[1].generatedAt).getTime() - new Date(a[1].generatedAt).getTime());
    map = Object.fromEntries(entries.slice(0, 200));
  }
  try { localStorage.setItem(EXPLAIN_CACHE_KEY, JSON.stringify(map)); } catch {}
}

// ============ component ============
export default function MorningBrief() {
  const [brief, setBrief] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<string>("");

  const [events, setEvents] = useState<EconEvent[]>([]);
  const [eventsFetchedAt, setEventsFetchedAt] = useState<string | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<EconEvent[]>([]);
  const [upcomingFetchedAt, setUpcomingFetchedAt] = useState<string | null>(null);
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [loadingUpcoming, setLoadingUpcoming] = useState(false);

  const [digest, setDigest] = useState<DigestGroup[]>([]);
  const [digestFetchedAt, setDigestFetchedAt] = useState<string | null>(null);
  const [showMoreNews, setShowMoreNews] = useState(false);
  const [expandedDigest, setExpandedDigest] = useState<Record<number, boolean>>({});
  const DIGEST_PREVIEW = 3;

  // Explain modal
  const [explainTarget, setExplainTarget] = useState<ExplainTarget | null>(null);
  const [explainResult, setExplainResult] = useState<ExplainResult | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);

  const { themes } = useThemeIntelligence();
  const { spy } = useSpyBenchmark();
  const { marketNews, fetchMarketNews } = useThemeNews();

  // Load caches
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const c: BriefCache = JSON.parse(raw);
        if ((Date.now() - new Date(c.generatedAt).getTime()) / 3600000 < 12) {
          setBrief(c.brief); setGeneratedAt(c.generatedAt);
        }
      }
      const evRaw = localStorage.getItem(EVENTS_CACHE_KEY);
      if (evRaw) {
        const e = JSON.parse(evRaw);
        if ((Date.now() - new Date(e.fetchedAt).getTime()) / 3600000 < 6) {
          setEvents(e.events || []); setEventsFetchedAt(e.fetchedAt);
        }
      }
      const upRaw = localStorage.getItem(EVENTS_UPCOMING_KEY);
      if (upRaw) {
        const u = JSON.parse(upRaw);
        if ((Date.now() - new Date(u.fetchedAt).getTime()) / 3600000 < 12) {
          setUpcomingEvents(u.events || []); setUpcomingFetchedAt(u.fetchedAt);
        }
      }
      const dgRaw = localStorage.getItem(DIGEST_CACHE_KEY);
      if (dgRaw) {
        const d = JSON.parse(dgRaw);
        if ((Date.now() - new Date(d.fetchedAt).getTime()) / 3600000 < 2) {
          setDigest(d.groups || []); setDigestFetchedAt(d.fetchedAt);
        }
      }
    } catch {}
    fetchMarketNews();
  }, [fetchMarketNews]);

  const loadEvents = useCallback(async (force = false) => {
    if (!force && eventsFetchedAt && (Date.now() - new Date(eventsFetchedAt).getTime()) / 3600000 < 6) return;
    try {
      const { data } = await supabase.functions.invoke("economic-calendar", {
        body: { includeTomorrow: false, usOnly: true },
      });
      const list: EconEvent[] = data?.events || [];
      const fetchedAt = data?.fetchedAt || new Date().toISOString();
      setEvents(list); setEventsFetchedAt(fetchedAt);
      localStorage.setItem(EVENTS_CACHE_KEY, JSON.stringify({ events: list, fetchedAt }));
    } catch (e) { console.warn("events failed", e); }
  }, [eventsFetchedAt]);

  const loadUpcomingEvents = useCallback(async (force = false) => {
    if (!force && upcomingFetchedAt && (Date.now() - new Date(upcomingFetchedAt).getTime()) / 3600000 < 12) return;
    setLoadingUpcoming(true);
    try {
      const { data } = await supabase.functions.invoke("economic-calendar", {
        body: { daysAhead: 7, usOnly: true },
      });
      const list: EconEvent[] = data?.events || [];
      const fetchedAt = data?.fetchedAt || new Date().toISOString();
      setUpcomingEvents(list); setUpcomingFetchedAt(fetchedAt);
      localStorage.setItem(EVENTS_UPCOMING_KEY, JSON.stringify({ events: list, fetchedAt }));
    } catch (e) {
      console.warn("upcoming events failed", e);
    } finally { setLoadingUpcoming(false); }
  }, [upcomingFetchedAt]);

  const loadDigest = useCallback(async (articles: any[], force = false) => {
    if (!force && digestFetchedAt && (Date.now() - new Date(digestFetchedAt).getTime()) / 3600000 < 2) return;
    if (!articles || articles.length === 0) return;
    try {
      const { data } = await supabase.functions.invoke("news-digest", { body: { articles } });
      const groups: DigestGroup[] = data?.groups || [];
      const fetchedAt = data?.generatedAt || new Date().toISOString();
      setDigest(groups); setDigestFetchedAt(fetchedAt);
      localStorage.setItem(DIGEST_CACHE_KEY, JSON.stringify({ groups, fetchedAt }));
    } catch (e) { console.warn("digest failed", e); }
  }, [digestFetchedAt]);

  useEffect(() => { loadEvents(false); }, [loadEvents]);
  useEffect(() => {
    if (marketNews && marketNews.length > 0 && digest.length === 0) {
      loadDigest(marketNews as any[], false);
    }
  }, [marketNews, digest.length, loadDigest]);

  // -------- Explain handler with caching --------
  const openExplain = useCallback(async (target: ExplainTarget) => {
    setExplainTarget(target);
    setExplainResult(null);
    const key = hashKey(target.kind + "|" + target.title);
    const cache = readExplainCache();
    if (cache[key]) {
      setExplainResult(cache[key]);
      return;
    }
    setExplainLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("explain-item", {
        body: { kind: target.kind, payload: target.payload },
      });
      if (error) throw error;
      const result: ExplainResult = {
        what: data?.what || "",
        expected: data?.expected || "",
        impact_level: data?.impact_level || "Medium",
        impact_text: data?.impact_text || "",
        generatedAt: data?.generatedAt || new Date().toISOString(),
      };
      setExplainResult(result);
      cache[key] = result;
      writeExplainCache(cache);
    } catch (e) {
      console.error("explain failed", e);
      toast.error("Failed to generate explanation");
      setExplainTarget(null);
    } finally { setExplainLoading(false); }
  }, []);

  // ----- Generate AI brief -----
  const generate = useCallback(async () => {
    setIsLoading(true);
    setProgress("Gathering market data…");
    try {
      const eventsPromise = loadEvents(true);
      const digestPromise = (marketNews && marketNews.length > 0) ? loadDigest(marketNews as any[], true) : Promise.resolve();

      let marketDrivers: any = null;
      try {
        setProgress("Fetching index drivers…");
        const { data } = await supabase.functions.invoke("index-drivers", { body: {} });
        if (data) {
          marketDrivers = {
            spy: data.spy ? {
              perf: data.spy.indexChange,
              top5: (data.spy.rows || []).slice(0, 5).map((r: any) => ({
                sym: r.symbol, weight: r.weight, pct: r.pctChange, contrib: r.weightedContribution,
              })),
              concentration: data.spy.concentrationScore,
            } : null,
            qqq: data.qqq ? {
              perf: data.qqq.indexChange,
              top5: (data.qqq.rows || []).slice(0, 5).map((r: any) => ({
                sym: r.symbol, weight: r.weight, pct: r.pctChange, contrib: r.weightedContribution,
              })),
              concentration: data.qqq.concentrationScore,
            } : null,
          };
        }
      } catch (e) { console.warn("drivers failed", e); }

      let earningsToday: any[] = [];
      try {
        setProgress("Fetching earnings calendar…");
        const today = new Date().toISOString().split("T")[0];
        const { data } = await supabase.functions.invoke("earnings-calendar", { body: { from: today, to: today } });
        const list = data?.earnings || data?.data || data || [];
        earningsToday = (Array.isArray(list) ? list : []).slice(0, 15).map((e: any) => ({
          symbol: e.symbol, name: e.name || e.companyName,
          hour: e.hour, eps: e.epsEstimate, revenue: e.revenueEstimate,
        }));
      } catch (e) { console.warn("earnings failed", e); }

      setProgress("Analyzing themes…");
      const sorted = [...themes].sort((a, b) => b.momentumScore - a.momentumScore);
      const topThemes = sorted.slice(0, 6).map(t => ({
        name: t.themeName, score: t.momentumScore,
        perf_1d: t.perf_1d, perf_1w: t.perf_1w,
        breadth: `${t.breadthUp}/${t.breadthTotal}`,
        topTickers: t.tickers.filter(tk => tk.status === "done")
          .sort((a, b) => b.perf_1d - a.perf_1d).slice(0, 3)
          .map(tk => ({ symbol: tk.symbol, perf_1d: tk.perf_1d })),
      }));
      const fadingThemes = [...themes].sort((a, b) => a.momentumScore - b.momentumScore)
        .slice(0, 4).map(t => ({ name: t.themeName, score: t.momentumScore, perf_1d: t.perf_1d, perf_1w: t.perf_1w }));

      const totalUp = themes.reduce((s, t) => s + t.breadthUp, 0);
      const totalAll = themes.reduce((s, t) => s + t.breadthTotal, 0);
      const breadthPct = totalAll > 0 ? Math.round((totalUp / totalAll) * 100) : null;

      const volumeSurges: any[] = [];
      themes.forEach(t => {
        t.tickers.forEach(tk => {
          if (tk.status === "done" && (tk as any).relVol && (tk as any).relVol > 2) {
            volumeSurges.push({ symbol: tk.symbol, theme: t.themeName, relVol: (tk as any).relVol, perf_1d: tk.perf_1d });
          }
        });
      });
      volumeSurges.sort((a, b) => b.relVol - a.relVol);

      const keySetups = sorted.filter(t => t.momentumScore >= 70 && t.perf_1d > 0)
        .slice(0, 5).flatMap(t =>
          t.tickers.filter(tk => tk.status === "done" && tk.perf_1d > 1)
            .slice(0, 2).map(tk => ({ symbol: tk.symbol, theme: t.themeName, perf_1d: tk.perf_1d, themeScore: t.momentumScore }))
        ).slice(0, 10);

      setProgress("Generating brief with AI…");
      const { data, error } = await supabase.functions.invoke("morning-brief", {
        body: {
          spy: { perf_1d: spy.perf_1d, perf_1w: spy.perf_1w, perf_1m: spy.perf_1m },
          qqq: marketDrivers?.qqq ? { perf_1d: marketDrivers.qqq.perf } : null,
          marketDrivers,
          topThemes, fadingThemes, earningsToday, keySetups,
          volumeSurges: volumeSurges.slice(0, 8),
          marketNews: (marketNews || []).slice(0, 8).map((n: any) => ({ headline: n.headline, source: n.source })),
          breadth: { advancingPct: breadthPct, advancing: totalUp, total: totalAll },
          concentration: marketDrivers?.spy?.concentration,
        },
      });
      if (error || !data?.brief) throw new Error(error?.message || "No brief returned");
      setBrief(data.brief);
      setGeneratedAt(data.generatedAt);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ brief: data.brief, generatedAt: data.generatedAt }));
      await Promise.all([eventsPromise, digestPromise]);
      toast.success("Morning Brief generated");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to generate brief");
    } finally {
      setIsLoading(false); setProgress("");
    }
  }, [themes, spy, marketNews, loadEvents, loadDigest]);

  // Group upcoming events by date for the More Events drawer
  const upcomingByDate = useMemo(() => {
    const map = new Map<string, EconEvent[]>();
    upcomingEvents.forEach(ev => {
      const key = ev.date.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [upcomingEvents]);

  const visibleNews = useMemo<NewsArticle[]>(() => {
    return (marketNews || []).slice(0, showMoreNews ? 30 : 0);
  }, [marketNews, showMoreNews]);

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/50 backdrop-blur">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft size={18} />
            </Link>
            <Sun size={20} className="text-[hsl(40,90%,55%)]" />
            <div>
              <h1 className="font-['Syne',sans-serif] text-xl font-semibold">Morning Brief</h1>
              <p className="text-xs text-muted-foreground" style={{ fontFamily: DM_MONO }}>
                US events · News digest · AI insight
              </p>
            </div>
          </div>
          <button
            onClick={generate}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors"
          >
            {isLoading
              ? <><Loader2 size={14} className="animate-spin" /> Generating…</>
              : <><RefreshCw size={14} /> {brief ? "Regenerate" : "Generate Morning Brief"}</>}
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-6 space-y-4">
        {isLoading && (
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin text-primary" />
              {progress || "Working…"}
            </div>
          </div>
        )}

        {/* 1. MARKET EVENTS TODAY (US) */}
        <section className="rounded-lg border border-border bg-card">
          <header className="flex items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Calendar size={16} className="text-[hsl(40,90%,55%)]" />
              <h2 className="font-['Syne',sans-serif] text-base font-semibold">US Market Events Today</h2>
              <span className="text-[10px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>
                {events.length} events
              </span>
            </div>
            <button
              onClick={() => loadEvents(true)}
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              style={{ fontFamily: DM_MONO }}
            >
              <RefreshCw size={11} /> refresh
            </button>
          </header>
          <div className="p-3">
            {events.length === 0 ? (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                No high-impact US events flagged for today.
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {events.map((ev, i) => (
                  <EventRow key={i} ev={ev} onExplain={() => openExplain({
                    kind: "event", title: ev.event + "|" + ev.date.slice(0, 10),
                    payload: ev,
                  })} />
                ))}
              </ul>
            )}

            {/* Expandable upcoming-events area */}
            {showUpcoming && (
              <div className="mt-4 pt-4 border-t border-border/40 max-h-[420px] overflow-y-auto">
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-3" style={{ fontFamily: DM_MONO }}>
                  Upcoming US Events · Next 7 days
                </h3>
                {loadingUpcoming && upcomingEvents.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground inline-flex items-center justify-center gap-2 w-full">
                    <Loader2 size={14} className="animate-spin" /> Loading…
                  </div>
                ) : upcomingByDate.length === 0 ? (
                  <div className="py-4 text-center text-sm text-muted-foreground">No upcoming high-impact US events.</div>
                ) : (
                  <div className="space-y-3">
                    {upcomingByDate.map(([dateKey, list]) => (
                      <div key={dateKey}>
                        <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5" style={{ fontFamily: DM_MONO }}>
                          {fmtDate(dateKey + "T12:00:00Z")} {isToday(dateKey + "T12:00:00Z") && <span className="ml-1 text-primary">· today</span>}
                        </h4>
                        <ul className="divide-y divide-border/60 border border-border/40 rounded-md">
                          {list.map((ev, i) => (
                            <EventRow key={i} ev={ev} showDate={false} onExplain={() => openExplain({
                              kind: "event", title: ev.event + "|" + ev.date.slice(0, 10), payload: ev,
                            })} />
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Bottom Show More toggle */}
            <div className="flex justify-center mt-3 pt-3 border-t border-border/40">
              <button
                onClick={() => {
                  if (!showUpcoming) loadUpcomingEvents(false);
                  setShowUpcoming(v => !v);
                }}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/10 transition-colors"
                style={{ fontFamily: DM_MONO }}
              >
                {showUpcoming ? <>Show Less <ChevronUp size={12} /></> : <>Show More <ChevronDown size={12} /></>}
              </button>
            </div>
          </div>
        </section>


        {/* 2. NEWS DIGEST */}
        <section className="rounded-lg border border-border bg-card">
          <header className="flex items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Newspaper size={16} className="text-primary" />
              <h2 className="font-['Syne',sans-serif] text-base font-semibold">Key Market News Summary</h2>
              {digestFetchedAt && (
                <span className="text-[10px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>
                  {new Date(digestFetchedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>
            <button
              onClick={() => loadDigest(marketNews as any[], true)}
              disabled={!marketNews || marketNews.length === 0}
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 disabled:opacity-40"
              style={{ fontFamily: DM_MONO }}
            >
              <RefreshCw size={11} /> refresh
            </button>
          </header>
          <div className="p-4">
            {digest.length === 0 ? (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                {marketNews && marketNews.length > 0 ? "Generating news digest…" : "Loading market news…"}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {digest.map((g, gi) => {
                  const isExpanded = !!expandedDigest[gi];
                  const extras = isExpanded ? matchHeadlinesForTheme(g.theme, marketNews, g.bullets.map(b => b.text)) : [];
                  const hasMore = g.bullets.length > DIGEST_PREVIEW
                    || matchHeadlinesForTheme(g.theme, marketNews, g.bullets.map(b => b.text)).length > 0;
                  const shownBullets = isExpanded ? g.bullets : g.bullets.slice(0, DIGEST_PREVIEW);
                  return (
                    <div key={gi} className="rounded-md border border-border/60 bg-secondary/20 p-3 flex flex-col">
                      <div className="flex items-center justify-between mb-2 pb-2 border-b border-border/40">
                        <h3 className="text-sm font-semibold text-foreground">{g.theme}</h3>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${impactColor(g.impact)}`}>
                          {g.impact}
                        </span>
                      </div>
                      <ul className={`space-y-1.5 ${isExpanded ? "max-h-[360px] overflow-y-auto pr-1" : ""}`}>
                        {shownBullets.map((b, bi) => {
                          const d = directionPill(b.impact);
                          return (
                            <li key={bi} className="flex gap-2 text-[13px] leading-snug group">
                              <span className={`shrink-0 mt-0.5 ${d.cls}`}>{d.icon}</span>
                              <span className="flex-1 text-foreground/90">{renderInline(b.text)}</span>
                              <button
                                onClick={() => openExplain({
                                  kind: "news",
                                  title: g.theme + "|" + b.text,
                                  payload: { headline: b.text.replace(/\*\*/g, ""), summary: g.theme },
                                })}
                                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-[10px] text-primary inline-flex items-center gap-0.5 hover:underline"
                                style={{ fontFamily: DM_MONO }}
                                title="Explain"
                              >
                                <Sparkles size={10} /> explain
                              </button>
                            </li>
                          );
                        })}
                        {isExpanded && extras.length > 0 && (
                          <>
                            <li className="pt-2 mt-1 border-t border-border/40 text-[10px] uppercase tracking-wider text-muted-foreground" style={{ fontFamily: DM_MONO }}>
                              Related headlines ({extras.length})
                            </li>
                            {extras.map((a, ai) => (
                              <li key={`x${ai}`} className="flex gap-2 text-[12px] leading-snug group">
                                <span className="shrink-0 mt-0.5 text-muted-foreground">•</span>
                                <a
                                  href={a.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex-1 text-foreground/80 hover:text-primary hover:underline"
                                >
                                  {a.headline}
                                  {a.source && <span className="ml-1 text-[10px] text-muted-foreground">— {a.source}</span>}
                                </a>
                                <button
                                  onClick={() => openExplain({
                                    kind: "news",
                                    title: g.theme + "|" + a.headline,
                                    payload: { headline: a.headline, summary: a.summary || "", source: a.source, symbol: a.symbol },
                                  })}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-[10px] text-primary inline-flex items-center gap-0.5 hover:underline"
                                  style={{ fontFamily: DM_MONO }}
                                  title="Explain"
                                >
                                  <Sparkles size={10} /> explain
                                </button>
                              </li>
                            ))}
                          </>
                        )}
                      </ul>
                      {hasMore && (
                        <div className="flex justify-center mt-2 pt-2 border-t border-border/40">
                          <button
                            onClick={() => setExpandedDigest(prev => ({ ...prev, [gi]: !prev[gi] }))}
                            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-medium text-primary hover:bg-primary/10 transition-colors"
                            style={{ fontFamily: DM_MONO }}
                          >
                            {isExpanded
                              ? <>Show Less <ChevronUp size={11} /></>
                              : <>Show More <ChevronDown size={11} /></>}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Latest headlines (expandable at bottom) */}
            {showMoreNews && visibleNews.length > 0 && (
              <div className="mt-4 pt-4 border-t border-border/40 max-h-[420px] overflow-y-auto">
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2" style={{ fontFamily: DM_MONO }}>
                  Latest headlines ({visibleNews.length})
                </h3>
                <ul className="divide-y divide-border/40">
                  {visibleNews.map((n, i) => (
                    <li key={i} className="py-2 flex items-start gap-3 group">
                      <span className="text-[10px] text-muted-foreground w-12 shrink-0 mt-0.5" style={{ fontFamily: DM_MONO }}>
                        {n.published_at ? new Date(n.published_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-foreground leading-snug">
                          {n.url ? (
                            <a href={n.url} target="_blank" rel="noopener noreferrer" className="hover:text-primary inline-flex items-start gap-1">
                              {n.headline} <ExternalLink size={10} className="mt-1 opacity-50 shrink-0" />
                            </a>
                          ) : n.headline}
                        </div>
                        {n.source && (
                          <div className="text-[10px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>{n.source}</div>
                        )}
                      </div>
                      <button
                        onClick={() => openExplain({
                          kind: "news", title: "headline|" + n.headline,
                          payload: { headline: n.headline, summary: n.summary, source: n.source, symbol: n.symbol },
                        })}
                        className="shrink-0 text-[10px] text-primary inline-flex items-center gap-0.5 hover:underline opacity-70 hover:opacity-100"
                        style={{ fontFamily: DM_MONO }}
                      >
                        <Sparkles size={10} /> explain
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Bottom Show More toggle for latest headlines */}
            {marketNews && marketNews.length > 0 && (
              <div className="flex justify-center mt-3 pt-3 border-t border-border/40">
                <button
                  onClick={() => setShowMoreNews(v => !v)}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/10 transition-colors"
                  style={{ fontFamily: DM_MONO }}
                >
                  {showMoreNews
                    ? <>Show Less <ChevronUp size={12} /></>
                    : <>Show More Headlines <ChevronDown size={12} /></>}
                </button>
              </div>
            )}
          </div>
        </section>


        {/* 3. AI BRIEF */}
        {!brief && !isLoading && (
          <div className="rounded-lg border border-dashed border-border bg-card/50 p-10 text-center">
            <Sun size={36} className="mx-auto text-[hsl(40,90%,55%)] mb-3 opacity-60" />
            <h2 className="font-['Syne',sans-serif] text-lg font-semibold mb-2">Generate the full AI Morning Brief</h2>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              Performance overview, theme rotation, key setups, and a Groq-powered insight paragraph.
            </p>
            <button
              onClick={generate}
              className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-5 py-2.5 text-sm font-semibold text-primary hover:bg-primary/20 transition-colors"
            >
              <Sun size={14} /> Generate Morning Brief
            </button>
          </div>
        )}

        {brief && (
          <div className="rounded-lg border border-border bg-card p-8">
            {generatedAt && (
              <div className="text-[10px] text-muted-foreground mb-4 pb-3 border-b border-border" style={{ fontFamily: DM_MONO }}>
                Generated {new Date(generatedAt).toLocaleString()} · Powered by Groq Llama 3.3
              </div>
            )}
            <article className="morning-brief-content max-w-none">
              <ReactMarkdown
                components={{
                  h2: ({ children }) => (
                    <h2 className="font-['Syne',sans-serif] text-lg font-semibold text-primary mt-6 mb-3 pb-2 border-b border-border first:mt-0">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="font-['Syne',sans-serif] text-base font-semibold text-foreground mt-4 mb-2">{children}</h3>
                  ),
                  ul: ({ children }) => <ul className="space-y-1.5 my-3 ml-1">{children}</ul>,
                  li: ({ children }) => (
                    <li className="text-sm text-foreground leading-relaxed flex gap-2">
                      <span className="text-primary mt-1.5 shrink-0">•</span>
                      <span className="flex-1">{children}</span>
                    </li>
                  ),
                  p: ({ children }) => <p className="text-sm text-foreground leading-relaxed my-2">{children}</p>,
                  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                  code: ({ children }) => (
                    <code className="px-1 py-0.5 rounded bg-secondary/60 text-foreground text-xs" style={{ fontFamily: DM_MONO }}>
                      {children}
                    </code>
                  ),
                }}
              >
                {brief}
              </ReactMarkdown>
            </article>
          </div>
        )}
      </div>


      {/* ---------- Explain Modal ---------- */}
      {explainTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setExplainTarget(null)}>
          <div className="bg-card border border-border rounded-lg w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <header className="flex items-start justify-between px-5 py-3 border-b border-border gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <Sparkles size={16} className="text-primary mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <h3 className="font-['Syne',sans-serif] text-base font-semibold truncate">
                    {explainTarget.kind === "event" ? "Event Brief" : "News Brief"}
                  </h3>
                  <p className="text-[11px] text-muted-foreground truncate" style={{ fontFamily: DM_MONO }}>
                    {explainTarget.payload?.event || explainTarget.payload?.headline || ""}
                  </p>
                </div>
              </div>
              <button onClick={() => setExplainTarget(null)} className="text-muted-foreground hover:text-foreground shrink-0"><X size={18} /></button>
            </header>
            <div className="overflow-y-auto p-5 flex-1 space-y-4">
              {explainLoading || !explainResult ? (
                <div className="py-8 text-center text-sm text-muted-foreground inline-flex items-center justify-center gap-2 w-full">
                  <Loader2 size={14} className="animate-spin" /> Asking AI…
                </div>
              ) : (
                <>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1" style={{ fontFamily: DM_MONO }}>What it is</div>
                    <p className="text-sm text-foreground leading-relaxed">{explainResult.what}</p>
                  </div>
                  {explainResult.expected && explainResult.expected !== "N/A" && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1" style={{ fontFamily: DM_MONO }}>Expected</div>
                      <p className="text-sm text-foreground leading-relaxed">{explainResult.expected}</p>
                    </div>
                  )}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-2" style={{ fontFamily: DM_MONO }}>
                      US Market Impact
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${impactColor(explainResult.impact_level)}`}>
                        {explainResult.impact_level}
                      </span>
                    </div>
                    <p className="text-sm text-foreground leading-relaxed">{explainResult.impact_text}</p>
                  </div>
                  <div className="text-[10px] text-muted-foreground pt-2 border-t border-border/40" style={{ fontFamily: DM_MONO }}>
                    Cached · Groq Llama 3.3
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ Sub-components ============

function EventRow({ ev, onExplain, showDate = true }: { ev: EconEvent; onExplain: () => void; showDate?: boolean }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 hover:bg-secondary/20 group">
      {showDate && (
        <span className="text-[10px] text-muted-foreground w-16 shrink-0" style={{ fontFamily: DM_MONO }}>
          {fmtDate(ev.date).replace(/,/g, "")}
        </span>
      )}
      <span className="text-[11px] text-muted-foreground w-20 shrink-0" style={{ fontFamily: DM_MONO }}>
        {fmtTime(ev.date)}
      </span>
      <span className={`text-[10px] px-1.5 py-0.5 rounded border w-16 text-center shrink-0 font-semibold ${impactColor(ev.impact)}`}>
        {ev.impact}
      </span>
      <span className="text-sm text-foreground flex-1 truncate" title={ev.event}>
        {ev.event}
      </span>
      <div className="flex items-center gap-3 text-[11px] shrink-0" style={{ fontFamily: DM_MONO }}>
        {ev.previous != null && (
          <span className="text-muted-foreground hidden sm:inline">prev <span className="text-foreground">{String(ev.previous)}{ev.unit || ""}</span></span>
        )}
        {ev.estimate != null && (
          <span className="text-muted-foreground hidden sm:inline">est <span className="text-foreground">{String(ev.estimate)}{ev.unit || ""}</span></span>
        )}
        {ev.actual != null && (
          <span className="text-muted-foreground">act <span className="text-[hsl(140,60%,55%)] font-semibold">{String(ev.actual)}{ev.unit || ""}</span></span>
        )}
      </div>
      <button
        onClick={onExplain}
        className="shrink-0 text-[10px] text-primary inline-flex items-center gap-0.5 hover:underline opacity-70 hover:opacity-100"
        style={{ fontFamily: DM_MONO }}
      >
        <Sparkles size={10} /> explain
      </button>
    </li>
  );
}
