import { useState, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Sun, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { useThemeIntelligence } from "@/hooks/useThemeIntelligence";
import { useSpyBenchmark } from "@/hooks/useSpyBenchmark";
import { useThemeNews } from "@/hooks/useThemeNews";
import { toast } from "sonner";

const DM_MONO = "'DM Mono', monospace";
const CACHE_KEY = "morning_brief_cache_v1";

interface BriefCache {
  brief: string;
  generatedAt: string;
}

export default function MorningBrief() {
  const [brief, setBrief] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const { themes } = useThemeIntelligence();
  const { spy } = useSpyBenchmark();
  const { marketNews, fetchMarketNews } = useThemeNews();

  // Load from cache on mount
  useEffect(() => {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      try {
        const c: BriefCache = JSON.parse(raw);
        const ageH = (Date.now() - new Date(c.generatedAt).getTime()) / 3600000;
        if (ageH < 12) {
          setBrief(c.brief);
          setGeneratedAt(c.generatedAt);
        }
      } catch {}
    }
    fetchMarketNews();
  }, [fetchMarketNews]);

  const generate = useCallback(async () => {
    setIsLoading(true);
    setProgress("Gathering market data…");

    try {
      // Market drivers (SPY + QQQ contributions)
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

      // Earnings today
      let earningsToday: any[] = [];
      try {
        setProgress("Fetching earnings calendar…");
        const today = new Date().toISOString().split("T")[0];
        const { data } = await supabase.functions.invoke("earnings-calendar", {
          body: { from: today, to: today },
        });
        const list = data?.earnings || data?.data || data || [];
        earningsToday = (Array.isArray(list) ? list : []).slice(0, 15).map((e: any) => ({
          symbol: e.symbol, name: e.name || e.companyName,
          hour: e.hour, eps: e.epsEstimate, revenue: e.revenueEstimate,
        }));
      } catch (e) { console.warn("earnings failed", e); }

      // Themes — top & bottom
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
        .slice(0, 4).map(t => ({
          name: t.themeName, score: t.momentumScore, perf_1d: t.perf_1d, perf_1w: t.perf_1w,
        }));

      // Breadth
      const totalUp = themes.reduce((s, t) => s + t.breadthUp, 0);
      const totalAll = themes.reduce((s, t) => s + t.breadthTotal, 0);
      const breadthPct = totalAll > 0 ? Math.round((totalUp / totalAll) * 100) : null;

      // Volume surges from theme data
      const volumeSurges: any[] = [];
      themes.forEach(t => {
        t.tickers.forEach(tk => {
          if (tk.status === "done" && (tk as any).relVol && (tk as any).relVol > 2) {
            volumeSurges.push({
              symbol: tk.symbol, theme: t.themeName,
              relVol: (tk as any).relVol, perf_1d: tk.perf_1d,
            });
          }
        });
      });
      volumeSurges.sort((a, b) => b.relVol - a.relVol);

      // Key setups: high momentum + advancing
      const keySetups = sorted.filter(t => t.momentumScore >= 70 && t.perf_1d > 0)
        .slice(0, 5).flatMap(t =>
          t.tickers.filter(tk => tk.status === "done" && tk.perf_1d > 1)
            .slice(0, 2).map(tk => ({
              symbol: tk.symbol, theme: t.themeName, perf_1d: tk.perf_1d, themeScore: t.momentumScore,
            }))
        ).slice(0, 10);

      setProgress("Generating brief with AI…");
      const { data, error } = await supabase.functions.invoke("morning-brief", {
        body: {
          spy: { perf_1d: spy.perf_1d, perf_1w: spy.perf_1w, perf_1m: spy.perf_1m },
          qqq: marketDrivers?.qqq ? { perf_1d: marketDrivers.qqq.perf } : null,
          marketDrivers,
          topThemes,
          fadingThemes,
          earningsToday,
          keySetups,
          volumeSurges: volumeSurges.slice(0, 8),
          marketNews: (marketNews || []).slice(0, 8).map((n: any) => ({
            headline: n.headline, source: n.source,
          })),
          breadth: { advancingPct: breadthPct, advancing: totalUp, total: totalAll },
          concentration: marketDrivers?.spy?.concentration,
        },
      });

      if (error || !data?.brief) {
        throw new Error(error?.message || "No brief returned");
      }

      setBrief(data.brief);
      setGeneratedAt(data.generatedAt);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ brief: data.brief, generatedAt: data.generatedAt }));
      toast.success("Morning Brief generated");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to generate brief");
    } finally {
      setIsLoading(false);
      setProgress("");
    }
  }, [themes, spy, marketNews]);

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
                Daily AI-powered intelligence report
              </p>
            </div>
          </div>
          <button
            onClick={generate}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors"
          >
            {isLoading ? (
              <><Loader2 size={14} className="animate-spin" /> Generating…</>
            ) : (
              <><RefreshCw size={14} /> {brief ? "Regenerate" : "Generate Morning Brief"}</>
            )}
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-6">
        {isLoading && (
          <div className="rounded-lg border border-border bg-card p-6 mb-4">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin text-primary" />
              {progress || "Working…"}
            </div>
          </div>
        )}

        {!brief && !isLoading && (
          <div className="rounded-lg border border-dashed border-border bg-card/50 p-12 text-center">
            <Sun size={40} className="mx-auto text-[hsl(40,90%,55%)] mb-3 opacity-60" />
            <h2 className="font-['Syne',sans-serif] text-lg font-semibold mb-2">Good morning — ready to plan your day?</h2>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              Generate a fresh AI-powered Morning Brief covering market overview, today's earnings,
              theme rotation, key setups, and a Groq-powered insight paragraph.
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
