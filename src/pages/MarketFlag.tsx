import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Flag, Loader2, Info, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const CACHE_KEY = "market_flag_cache_v1";
const CACHE_TTL = 12 * 60 * 60 * 1000;

interface Factor {
  key: string;
  label: string;
  weight: number;
  value: string;
  score: number;
  note: string;
  tooltip: { meaning: string; market: string; trader: string };
}

interface FlagPayload {
  state: string;
  color: string;
  stance: string;
  composite: number;
  weighted: number;
  summary: string;
  factors: Factor[];
  generatedAt: string;
}

const FLAG_STYLES: Record<string, { bg: string; text: string; ring: string }> = {
  green:         { bg: "hsl(150,70%,40%)", text: "hsl(150,80%,92%)", ring: "hsl(150,70%,40%)" },
  "light-green": { bg: "hsl(120,55%,42%)", text: "hsl(120,70%,94%)", ring: "hsl(120,55%,42%)" },
  yellow:        { bg: "hsl(48,90%,50%)",  text: "hsl(48,90%,10%)",  ring: "hsl(48,90%,50%)" },
  orange:        { bg: "hsl(28,90%,52%)",  text: "hsl(28,90%,10%)",  ring: "hsl(28,90%,52%)" },
  red:           { bg: "hsl(0,72%,48%)",   text: "hsl(0,80%,95%)",   ring: "hsl(0,72%,48%)" },
};

const scoreColor = (s: number) =>
  s >= 1 ? "hsl(150,70%,45%)" : s > 0 ? "hsl(120,50%,50%)" : s === 0 ? "hsl(48,80%,55%)" : s > -1 ? "hsl(28,85%,55%)" : "hsl(0,72%,55%)";

export default function MarketFlag() {
  const [data, setData] = useState<FlagPayload | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (force = false) => {
    if (!force) {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { at: number; payload: FlagPayload };
          if (Date.now() - parsed.at < CACHE_TTL) { setData(parsed.payload); return; }
        }
      } catch { /* ignore */ }
    }
    setLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("market-flag", { body: { force } });
      if (error) throw new Error(error.message);
      if ((res as any)?.error) throw new Error((res as any).error);
      setData(res as FlagPayload);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), payload: res })); } catch { /* quota */ }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load market flag");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(false); }, [load]);

  const style = FLAG_STYLES[data?.color ?? "yellow"] ?? FLAG_STYLES.yellow;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <Link to="/" className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <ArrowLeft size={14} />
          </Link>
          <Flag size={16} className="text-[hsl(40,90%,55%)]" />
          <h1 className="text-sm font-semibold tracking-wide">Market Flag / Bias</h1>
          <div className="ml-auto flex items-center gap-3">
            {data && (
              <span className="text-[11px] text-muted-foreground">
                Updated {new Date(data.generatedAt).toLocaleString()}
              </span>
            )}
            <button
              onClick={() => load(true)}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-4 py-5">
        {!data && loading && (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" /> Reading the tape…
          </div>
        )}

        {data && (
          <>
            {/* Big flag */}
            <section
              className="rounded-xl border p-6 text-center"
              style={{ background: style.bg, borderColor: style.ring, color: style.text }}
            >
              <div className="text-[11px] uppercase tracking-[0.25em] opacity-80">Market State</div>
              <div className="mt-1 text-4xl font-black tracking-tight">{data.state}</div>
              <div className="mt-2 text-sm font-medium opacity-90">Composite score {data.composite}/100</div>
            </section>

            {/* Trader stance */}
            <section className="rounded-lg border border-border bg-card p-4">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Trader Stance</div>
              <p className="mt-1 text-sm font-medium leading-relaxed">{data.stance}</p>
            </section>

            {/* AI summary */}
            {data.summary && (
              <section className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <Sparkles size={12} className="text-[hsl(40,90%,55%)]" /> AI Read
                </div>
                <p className="mt-2 whitespace-pre-line text-[15px] leading-[1.8]">{data.summary}</p>
              </section>
            )}

            {/* Factors */}
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.factors.map((f) => (
                <div key={f.key} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold">{f.label}</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button className="text-muted-foreground hover:text-foreground" aria-label={`About ${f.label}`}>
                            <Info size={12} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs space-y-1.5 text-[11px] leading-relaxed">
                          <p><span className="font-semibold">What it means: </span>{f.tooltip.meaning}</p>
                          <p><span className="font-semibold">Market standpoint: </span>{f.tooltip.market}</p>
                          <p><span className="font-semibold">Trader standpoint: </span>{f.tooltip.trader}</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <span
                      className="rounded px-1.5 py-0.5 font-mono text-[11px] font-bold"
                      style={{ background: `${scoreColor(f.score)}22`, color: scoreColor(f.score) }}
                    >
                      {f.score > 0 ? "+" : ""}{f.score}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-sm">{f.value}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{f.note}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                    {f.weight >= 1.5 ? "High weight" : "Medium weight"}
                  </div>
                </div>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
