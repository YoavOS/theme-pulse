import { useState, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Sun, Loader2, Calendar, Newspaper, TrendingUp, TrendingDown, Minus } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { useThemeIntelligence } from "@/hooks/useThemeIntelligence";
import { useSpyBenchmark } from "@/hooks/useSpyBenchmark";
import { useThemeNews } from "@/hooks/useThemeNews";
import { toast } from "sonner";

const DM_MONO = "'DM Mono', monospace";
const CACHE_KEY = "morning_brief_cache_v2";
const EVENTS_CACHE_KEY = "morning_brief_events_v1";
const DIGEST_CACHE_KEY = "morning_brief_digest_v1";

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

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
}

function impactColor(impact: string): string {
  if (impact === "High") return "text-[hsl(0,75%,60%)] border-[hsl(0,75%,60%)]/40 bg-[hsl(0,75%,60%)]/10";
  if (impact === "Medium") return "text-[hsl(40,90%,55%)] border-[hsl(40,90%,55%)]/40 bg-[hsl(40,90%,55%)]/10";
  return "text-muted-foreground border-border bg-secondary/40";
}

function directionPill(impact: string) {
  if (impact === "Bullish") return { cls: "text-[hsl(140,60%,55%)]", icon: <TrendingUp size={11} /> };
  if (impact === "Bearish") return { cls: "text-[hsl(0,75%,60%)]", icon: <TrendingDown size={11} /> };
  return { cls: "text-muted-foreground", icon: <Minus size={11} /> };
}

// Light markdown for **bold** inside news bullets
function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i} className="font-semibold text-foreground" style={{ fontFamily: DM_MONO }}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  );
}

export default function MorningBrief() {
  const [brief, setBrief] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [events, setEvents] = useState<EconEvent[]>([]);
  const [eventsFetchedAt, setEventsFetchedAt] = useState<string | null>(null);
  const [digest, setDigest] = useState<DigestGroup[]>([]);
  const [digestFetchedAt, setDigestFetchedAt] = useState<string | null>(null);
  const { themes } = useThemeIntelligence();
  const { spy } = useSpyBenchmark();
  const { marketNews, fetchMarketNews } = useThemeNews();

  // Load cached brief
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const c: BriefCache = JSON.parse(raw);
        if ((Date.now() - new Date(c.generatedAt).getTime()) / 3600000 < 12) {
          setBrief(c.brief);
          setGeneratedAt(c.generatedAt);
        }
      }
      const evRaw = localStorage.getItem(EVENTS_CACHE_KEY);
      if (evRaw) {
        const e = JSON.parse(evRaw);
        if ((Date.now() - new Date(e.fetchedAt).getTime()) / 3600000 < 6) {
          setEvents(e.events || []);
          setEventsFetchedAt(e.fetchedAt);
        }
      }
      const dgRaw = localStorage.getItem(DIGEST_CACHE_KEY);
      if (dgRaw) {
        const d = JSON.parse(dgRaw);
        if ((Date.now() - new Date(d.fetchedAt).getTime()) / 3600000 < 2) {
          setDigest(d.groups || []);
          setDigestFetchedAt(d.fetchedAt);
        }
      }
    } catch {}
    fetchMarketNews();
  }, [fetchMarketNews]);

  const loadEvents = useCallback(async (force = false) => {
    if (!force && eventsFetchedAt && (Date.now() - new Date(eventsFetchedAt).getTime()) / 3600000 < 6) return;
    try {
      const { data } = await supabase.functions.invoke("economic-calendar", { body: { includeTomorrow: false } });
      const list: EconEvent[] = data?.events || [];
      const fetchedAt = data?.fetchedAt || new Date().toISOString();
      setEvents(list);
      setEventsFetchedAt(fetchedAt);
      localStorage.setItem(EVENTS_CACHE_KEY, JSON.stringify({ events: list, fetchedAt }));
    } catch (e) { console.warn("events failed", e); }
  }, [eventsFetchedAt]);

  const loadDigest = useCallback(async (articles: any[], force = false) => {
    if (!force && digestFetchedAt && (Date.now() - new Date(digestFetchedAt).getTime()) / 3600000 < 2) return;
    if (!articles || articles.length === 0) return;
    try {
      const { data } = await supabase.functions.invoke("news-digest", { body: { articles } });
      const groups: DigestGroup[] = data?.groups || [];
      const fetchedAt = data?.generatedAt || new Date().toISOString();
      setDigest(groups);
      setDigestFetchedAt(fetchedAt);
      localStorage.setItem(DIGEST_CACHE_KEY, JSON.stringify({ groups, fetchedAt }));
    } catch (e) { console.warn("digest failed", e); }
  }, [digestFetchedAt]);

  // Auto-load events + digest in background
  useEffect(() => { loadEvents(false); }, [loadEvents]);
  useEffect(() => {
    if (marketNews && marketNews.length > 0 && digest.length === 0) {
      loadDigest(marketNews as any[], false);
    }
  }, [marketNews, digest.length, loadDigest]);

  const generate = useCallback(async () => {
    setIsLoading(true);
    setProgress("Gathering market data…");

    try {
      // Refresh events + digest in parallel with main brief
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
      setIsLoading(false);
      setProgress("");
    }
  }, [themes, spy, marketNews, loadEvents, loadDigest]);

  const hasAnyContent = brief || events.length > 0 || digest.length > 0;

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
                Events · News digest · AI insight
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

        {/* 1. MARKET EVENTS TODAY */}
        <section className="rounded-lg border border-border bg-card">
          <header className="flex items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Calendar size={16} className="text-[hsl(40,90%,55%)]" />
              <h2 className="font-['Syne',sans-serif] text-base font-semibold">Market Events Today</h2>
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
                No high-impact events flagged for today.
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {events.map((ev, i) => (
                  <li key={i} className="flex items-center gap-3 px-2 py-2.5 hover:bg-secondary/20 rounded">
                    <span className="text-[11px] text-muted-foreground w-24 shrink-0" style={{ fontFamily: DM_MONO }}>
                      {fmtTime(ev.date)}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border w-16 text-center shrink-0 font-semibold ${impactColor(ev.impact)}`}>
                      {ev.impact}
                    </span>
                    <span className="text-[10px] text-muted-foreground w-8 shrink-0" style={{ fontFamily: DM_MONO }}>
                      {ev.country}
                    </span>
                    <span className="text-sm text-foreground flex-1 truncate" title={ev.event}>
                      {ev.event}
                    </span>
                    <div className="flex items-center gap-3 text-[11px] shrink-0" style={{ fontFamily: DM_MONO }}>
                      {ev.previous != null && (
                        <span className="text-muted-foreground">prev <span className="text-foreground">{String(ev.previous)}{ev.unit || ""}</span></span>
                      )}
                      {ev.estimate != null && (
                        <span className="text-muted-foreground">est <span className="text-foreground">{String(ev.estimate)}{ev.unit || ""}</span></span>
                      )}
                      {ev.actual != null && (
                        <span className="text-muted-foreground">act <span className="text-[hsl(140,60%,55%)] font-semibold">{String(ev.actual)}{ev.unit || ""}</span></span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* 2. KEY NEWS SUMMARY */}
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
                {marketNews && marketNews.length > 0
                  ? "Generating news digest…"
                  : "Loading market news…"}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {digest.map((g, gi) => (
                  <div key={gi} className="rounded-md border border-border/60 bg-secondary/20 p-3">
                    <div className="flex items-center justify-between mb-2 pb-2 border-b border-border/40">
                      <h3 className="text-sm font-semibold text-foreground">{g.theme}</h3>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${impactColor(g.impact)}`}>
                        {g.impact}
                      </span>
                    </div>
                    <ul className="space-y-1.5">
                      {g.bullets.map((b, bi) => {
                        const d = directionPill(b.impact);
                        return (
                          <li key={bi} className="flex gap-2 text-[13px] leading-snug">
                            <span className={`shrink-0 mt-0.5 ${d.cls}`}>{d.icon}</span>
                            <span className="flex-1 text-foreground/90">{renderInline(b.text)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 3. AI BRIEF (performance overview, themes, setups) */}
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
    </div>
  );
}
