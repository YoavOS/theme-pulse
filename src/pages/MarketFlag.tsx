import { ordinal } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Flag, Loader2, Info, Sparkles, BookOpen, CalendarClock, Scale } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BottomLine, Fold, HowItWorks, SectionHead } from "@/components/Explainer";
import { AaiiCard, CotCard, McClellanCard, useMarketSentiment } from "@/components/market/SentimentPanels";
import { useStockStages } from "@/hooks/useStockStages";
import {
  HISTORY, HISTORY_ALL, PLAYBOOK, REFERENCES, STRENGTH_STYLE, TYPE_INFO, nextFomc, overlays, volTargetExposure,
  type FearGreed, type FlagMetrics, type MarketTypeKey, type Tip,
} from "@/lib/marketPlaybook";

const CACHE_KEY = "market_flag_cache_v2";
const CACHE_TTL = 30 * 60 * 1000;
const FNG_KEY = "market_fng_cache_v1";

interface Factor {
  key: string; label: string; weight: number; value: string; score: number; note: string;
  tooltip: { meaning: string; market: string; trader: string };
}
interface FlagPayload {
  version?: number;
  type?: { key: MarketTypeKey; name: string };
  state: string; color: string; composite: number; weighted: number;
  summary: string; summaryError?: string | null;
  factors: Factor[]; metrics?: FlagMetrics; generatedAt: string;
}

const TONE: Record<"go" | "caution" | "stop", { bar: string; text: string; bg: string }> = {
  go: { bar: "hsl(150,65%,42%)", text: "hsl(150,70%,55%)", bg: "hsl(150,60%,40%,0.10)" },
  caution: { bar: "hsl(42,90%,52%)", text: "hsl(42,95%,60%)", bg: "hsl(42,90%,50%,0.10)" },
  stop: { bar: "hsl(0,72%,52%)", text: "hsl(0,80%,66%)", bg: "hsl(0,72%,50%,0.10)" },
};
const scoreColor = (s: number) =>
  s >= 1 ? "hsl(150,70%,45%)" : s > 0 ? "hsl(120,50%,50%)" : s === 0 ? "hsl(48,80%,55%)" : s > -1 ? "hsl(28,85%,55%)" : "hsl(0,72%,55%)";
const fngColor = (x: number) => (x <= 25 ? "hsl(0,72%,55%)" : x <= 45 ? "hsl(28,85%,55%)" : x < 55 ? "hsl(48,80%,55%)" : x < 75 ? "hsl(120,50%,50%)" : "hsl(150,70%,45%)");
const sign = (x: number, d = 1) => `${x >= 0 ? "+" : ""}${x.toFixed(d)}`;

const FNG_LABELS: Record<string, string> = {
  market_momentum_sp500: "S&P 500 vs 125-day average",
  stock_price_strength: "52-week highs vs lows",
  stock_price_breadth: "Up vs down volume (McClellan)",
  put_call_options: "Put/call ratio",
  market_volatility_vix: "VIX vs its 50-day average",
  junk_bond_demand: "Junk vs investment-grade yields",
  safe_haven_demand: "Stocks vs bonds (20 days)",
};

/** CNN Fear & Greed — CNN's data endpoint allows browser requests, so it is read here. */
async function loadFearGreed(force: boolean): Promise<FearGreed | null> {
  if (!force) {
    try {
      const raw = localStorage.getItem(FNG_KEY);
      if (raw) { const p = JSON.parse(raw) as { at: number; v: FearGreed }; if (Date.now() - p.at < CACHE_TTL) return p.v; }
    } catch { /* ignore */ }
  }
  try {
    const res = await fetch("https://production.dataviz.cnn.io/index/fearandgreed/graphdata");
    if (!res.ok) return null;
    const j = await res.json();
    const fg = j?.fear_and_greed;
    if (!fg || typeof fg.score !== "number") return null;
    const v: FearGreed = {
      score: fg.score, rating: String(fg.rating ?? ""), timestamp: String(fg.timestamp ?? ""),
      prevClose: fg.previous_close ?? null, prevWeek: fg.previous_1_week ?? null, prevMonth: fg.previous_1_month ?? null, prevYear: fg.previous_1_year ?? null,
      history: ((j?.fear_and_greed_historical?.data ?? []) as { x: number; y: number }[]).filter((p) => Number.isFinite(p?.y)).map((p) => ({ x: p.x, y: p.y })),
      components: Object.entries(FNG_LABELS).filter(([k]) => typeof j?.[k]?.score === "number")
        .map(([k, label]) => ({ key: k, label, score: j[k].score as number, rating: String(j[k].rating ?? "") })),
    };
    try { localStorage.setItem(FNG_KEY, JSON.stringify({ at: Date.now(), v })); } catch { /* quota */ }
    return v;
  } catch {
    return null;
  }
}

export default function MarketFlag() {
  const [data, setData] = useState<FlagPayload | null>(null);
  const [fng, setFng] = useState<FearGreed | null>(null);
  const [fngState, setFngState] = useState<"loading" | "ok" | "fail">("loading");
  const [loading, setLoading] = useState(false);
  const [sentKey, setSentKey] = useState(0);
  const sentiment = useMarketSentiment(sentKey);
  const { rows: stageRows } = useStockStages(true);

  const load = useCallback(async (force = false) => {
    setFngState("loading");
    loadFearGreed(force).then((v) => { setFng(v); setFngState(v ? "ok" : "fail"); });
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
      const r = res as FlagPayload & { error?: string };
      if (r?.error) throw new Error(r.error);
      setData(r);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), payload: r })); } catch { /* quota */ }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load market flag");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(false); }, [load]);

  const typeKey = data?.type?.key;
  const m = data?.metrics;
  const info = typeKey ? TYPE_INFO[typeKey] : null;
  const tone = info ? TONE[info.tone] : TONE.caution;
  const extra = typeKey && m ? overlays(typeKey, m, fng) : [];
  const exposure = volTargetExposure(m?.spy.rv20 ?? null);
  const fomc = nextFomc();
  const citeKeys = typeKey ? [...new Set([...PLAYBOOK[typeKey].tips, ...extra].map((t) => t.cite).filter((x): x is string => !!x))] : [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <Link to="/" className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <ArrowLeft size={14} />
          </Link>
          <Flag size={16} className="text-[hsl(40,90%,55%)]" />
          <h1 className="text-sm font-semibold tracking-wide">Market Flag</h1>
          <div className="ml-auto flex items-center gap-3">
            {data && <span className="hidden text-[11px] text-muted-foreground sm:inline">Updated {new Date(data.generatedAt).toLocaleString()}</span>}
            <button onClick={() => { load(true); setSentKey((k) => k + 1); }} disabled={loading}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50">
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
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

        {data && !data.type && (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            The server is still running the old Market Flag version. Deploy the updated <code>market-flag</code> function to see the market type and playbook.
          </div>
        )}

        {data && info && typeKey && m && (
          <>
            <BottomLine
              tone={info.tone === "go" ? "good" : info.tone === "stop" ? "bad" : "warn"}
              title={<><span style={{ color: tone.text }}>{info.name}</span> — {PLAYBOOK[typeKey].tips[0].title.toLowerCase()}.</>}
              lines={[
                PLAYBOOK[typeKey].tips.length > 1 ? <>Also: {PLAYBOOK[typeKey].tips.slice(1, 3).map((t) => t.title.toLowerCase()).join(" · ")}.</> : null,
                exposure !== null ? <>Volatility alone allows {exposure}% of your normal position size{exposure >= 90 && info.tone !== "go" ? " — the market type, not volatility, is the reason to hold back" : ""}.</> : null,
                extra.length ? <>Today also: {extra.map((t) => t.title.toLowerCase()).join(" · ")}.</> : null,
                fomc && fomc.days <= 7 ? <>Fed decision {fomc.days === 0 ? "today" : `in ${fomc.days} day${fomc.days === 1 ? "" : "s"}`} — expect sharp moves both ways.</> : null,
              ]}
            />

            {/* Market type */}
            <section className="rounded-xl border p-5" style={{ borderColor: tone.bar, background: tone.bg }}>
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-[240px] flex-1">
                  <div className="text-[11px] tracking-[0.2em] text-muted-foreground">Market type</div>
                  <div className="mt-1 text-3xl font-black tracking-tight" style={{ color: tone.text }}>{info.name}</div>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-foreground/85">{info.blurb}</p>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
                  <Stat label="S&P vs 50-day" value={`${sign((m.spy.last / m.spy.ma50 - 1) * 100)}%`} />
                  <Stat label="S&P vs 200-day" value={`${sign((m.spy.last / m.spy.ma200 - 1) * 100)}%`} />
                  <Stat label="From 52w high" value={`${m.spy.dd52.toFixed(1)}%`} />
                  <Stat label="VIX · VIX/VIX3M" value={`${m.vix.last?.toFixed(1) ?? "—"} · ${m.vix.term?.toFixed(2) ?? "—"}`} />
                  <Stat label="Your list > 40w MA" value={m.breadth ? `${Math.round(m.breadth.p200)}%` : "—"} />
                  <Stat label="Risk score (100 = calm)" value={`${data.composite}/100`} hint={data.composite >= 65 ? "calm" : data.composite >= 45 ? "normal" : data.composite >= 30 ? "elevated" : "high risk"} />
                </div>
              </div>
            </section>

            {data.summary && (
              <section className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Sparkles size={12} className="text-[hsl(40,90%,55%)]" /> AI read
                </div>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{data.summary}</p>
              </section>
            )}

            {/* Playbook */}
            <section className="rounded-lg border border-border bg-card p-4">
              <SectionHead
                icon={<BookOpen size={15} className="text-[hsl(40,90%,55%)]" />}
                title="Playbook for this market"
                sub="What tends to work in this kind of market. Each tip is tagged with how strong the evidence behind it is."
              />
              <div className="grid gap-2.5 md:grid-cols-2">
                {[...extra, ...PLAYBOOK[typeKey].tips].map((t, k) => <TipCard key={k} t={t} highlight={k < extra.length} />)}
              </div>
              <div className="mt-3 rounded-md bg-muted/30 px-3 py-2 text-xs">
                <span className="font-semibold">What would change the type: </span>
                <span className="text-muted-foreground">{PLAYBOOK[typeKey].watch.join(" · ")}</span>
              </div>
            </section>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Sizing */}
              <section className="rounded-lg border border-border bg-card p-4">
                <SectionHead className="mb-2" icon={<Scale size={15} className="text-sky-300" />} title="Position sizing" />
                {exposure !== null ? (
                  <>
                    <div className="font-display text-4xl font-bold tracking-tight" style={{ color: exposure >= 90 ? TONE.go.text : exposure >= 60 ? TONE.caution.text : TONE.stop.text }}>{exposure}%</div>
                    <div className="text-xs text-muted-foreground">of your normal position size</div>
                    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                      S&P volatility over the last 20 days is {m.spy.rv20?.toFixed(1)}% a year
                      {m.spy.rvPct !== null ? ` (${ordinal(m.spy.rvPct)} percentile of 2 years)` : ""}. Scaling exposure to keep volatility near 15% held risk steady and,
                      in published tests, improved risk-adjusted returns — though how much that holds up out of sample is debated.
                    </p>
                    <span className={`mt-2 inline-block rounded px-1.5 py-[1px] text-[10px] ${STRENGTH_STYLE.moderate}`}>moderate evidence</span>
                  </>
                ) : <p className="text-xs text-muted-foreground">Not enough data.</p>}
              </section>

              {/* Calendar */}
              <section className="rounded-lg border border-border bg-card p-4">
                <SectionHead className="mb-2" icon={<CalendarClock size={15} className="text-violet-300" />} title="Calendar" />
                {fomc ? (
                  <>
                    <div className="text-sm">Next Fed decision: <b>{new Date(fomc.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</b></div>
                    <div className="text-xs text-muted-foreground">{fomc.days === 0 ? "today" : `in ${fomc.days} day${fomc.days === 1 ? "" : "s"}`}</div>
                  </>
                ) : <div className="text-xs text-muted-foreground">No scheduled meeting in the list.</div>}
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  Fed days bring sharp moves both ways. The famous pre-Fed drift (stocks rising the day before) has largely faded since 2015, so it is not a reason to buy early.
                </p>
              </section>

            </div>

            {/* Sentiment & positioning */}
            <section>
              <SectionHead
                className="px-1"
                title="Sentiment & positioning"
                sub="How the crowd feels and how it is positioned. Read it contrarian and only at extremes — it is kept out of the risk score."
              />
              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
                <div className="flex flex-col gap-4">
                  <FearGreedCard fng={fng} state={fngState} />
                  <CotCard data={sentiment.data} state={sentiment.state} />
                </div>
                <div className="flex flex-col gap-4">
                  <AaiiCard data={sentiment.data} state={sentiment.state} />
                  <McClellanCard rows={stageRows} />
                </div>
              </div>
            </section>

            {/* History by type */}
            <Fold title="What happened next, by market type" hint={`· S&P 500 since 2003 · now: ${info.name}, median ${sign(HISTORY[typeKey].m3)}% over 3 months, up ${HISTORY[typeKey].up3}% of the time`}>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border text-[10.5px] text-muted-foreground">
                      <th className="px-2 py-1.5 text-left font-medium">Type</th>
                      <th className="px-2 py-1.5 text-right font-medium">Episodes</th>
                      <th className="px-2 py-1.5 text-right font-medium">S&P next 3M (median)</th>
                      <th className="px-2 py-1.5 text-right font-medium">Up after 3M</th>
                      <th className="px-2 py-1.5 text-right font-medium" title="Median of the worst peak-to-trough dip within the next 3 months">Typical worst dip</th>
                      <th className="px-2 py-1.5 text-right font-medium">Volatility</th>
                      <th className="px-2 py-1.5 text-right font-medium" title="Momentum ETF (MTUM) minus S&P over the next 3 months, since 2013">Momentum vs S&P</th>
                      <th className="px-2 py-1.5 text-right font-medium" title="Russell 2000 (IWM) minus S&P over the next 3 months">Small caps vs S&P</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Object.keys(HISTORY) as MarketTypeKey[]).map((k) => {
                      const h = HISTORY[k], cur = k === typeKey;
                      return (
                        <tr key={k} className={`border-b border-border/30 ${cur ? "bg-primary/10 font-semibold" : ""}`}>
                          <td className="px-2 py-1">{TYPE_INFO[k].name}{cur && <span className="ml-1.5 rounded bg-primary/20 px-1 text-[9.5px] text-primary">now</span>}</td>
                          <td className="px-2 py-1 text-right font-mono text-muted-foreground">{h.episodes}</td>
                          <td className="px-2 py-1 text-right font-mono">{sign(h.m3)}%</td>
                          <td className="px-2 py-1 text-right font-mono">{h.up3}%</td>
                          <td className="px-2 py-1 text-right font-mono text-pink-300">{h.worstDd3.toFixed(1)}%</td>
                          <td className="px-2 py-1 text-right font-mono">{h.vol.toFixed(0)}%</td>
                          <td className={`px-2 py-1 text-right font-mono ${h.momVsSpy > 0 ? "text-emerald-400" : "text-pink-300"}`}>{sign(h.momVsSpy)} <span className="text-muted-foreground">({h.momUp}%)</span></td>
                          <td className={`px-2 py-1 text-right font-mono ${h.smallVsSpy > 0 ? "text-emerald-400" : "text-pink-300"}`}>{sign(h.smallVsSpy)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
                All days: S&P next 3 months median {sign(HISTORY_ALL.m3)}%, up {HISTORY_ALL.up3}% of the time. Windows overlap and some types have few episodes,
                so read these as tendencies. The index often did <i>better</i> after scary types (mean reversion), but with deeper dips — what changes most from type to type is
                risk and which stocks lead, not the index's direction. "Narrow" here uses the equal-weight index, as your list's breadth has no long history.
              </p>
            </Fold>

            {/* Factors */}
            <Fold title="Risk factors behind the score" hint={`· ${data.factors.filter((f) => f.score < -0.5).length} of ${data.factors.length} flashing caution`}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.factors.map((f) => (
                  <div key={f.key} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold">{f.label}</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button className="text-muted-foreground hover:text-foreground" aria-label={`About ${f.label}`}><Info size={12} /></button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs space-y-1.5 text-[11px] leading-relaxed">
                            <p><span className="font-semibold">What it is: </span>{f.tooltip.meaning}</p>
                            <p><span className="font-semibold">Why it matters: </span>{f.tooltip.market}</p>
                            <p><span className="font-semibold">For you: </span>{f.tooltip.trader}</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <span className="rounded px-1.5 py-0.5 font-mono text-[11px] font-bold" style={{ background: `${scoreColor(f.score)}22`, color: scoreColor(f.score) }}>
                        {f.score > 0 ? "+" : ""}{f.score.toFixed(1)}
                      </span>
                    </div>
                    <div className="mt-1 text-[13px] font-mono leading-snug">{f.value}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{f.note}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground/70">weight {f.weight}</div>
                  </div>
                ))}
              </div>
            </Fold>


            {citeKeys.length > 0 && (
              <HowItWorks title="Evidence behind today's tips">
                <ul className="list-disc space-y-0.5 pl-4">{citeKeys.map((k) => <li key={k}>{REFERENCES[k]}</li>)}</ul>
              </HowItWorks>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-mono text-sm font-semibold">{value}{hint && <span className="ml-1 text-[10px] font-normal text-muted-foreground">{hint}</span>}</div>
    </div>
  );
}

function TipCard({ t, highlight }: { t: Tip; highlight: boolean }) {
  const tone = TONE[t.tone ?? "caution"];
  return (
    <div className={`rounded-md border p-3 ${highlight ? "border-border bg-muted/30" : "border-border/60"}`} style={{ borderLeft: `3px solid ${tone.bar}` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] font-semibold leading-snug">{t.title}</div>
        <span className={`shrink-0 rounded px-1.5 py-[1px] text-[10px] ${STRENGTH_STYLE[t.strength]}`}
          title={t.cite ? REFERENCES[t.cite] : t.strength === "weak" ? "Practitioner rule — little formal evidence" : undefined}>
          {t.strength}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.text}</p>
      {highlight && <div className="mt-1 text-[10px] text-muted-foreground/70">today's conditions</div>}
    </div>
  );
}

function FearGreedCard({ fng, state }: { fng: FearGreed | null; state: "loading" | "ok" | "fail" }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2">
        <h3 className="font-display text-[15px] font-semibold leading-tight tracking-tight">Fear &amp; Greed</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">CNN's index of seven market gauges, read contrarian</p>
      </div>
      {state === "loading" && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Loading…</p>}
      {state === "fail" && <p className="text-xs text-muted-foreground">CNN's index couldn't be loaded right now (it may be blocked by your browser or network).</p>}
      {fng && (
        <>
          <div className="flex items-end gap-3">
            <div className="text-3xl font-black" style={{ color: fngColor(fng.score) }}>{Math.round(fng.score)}</div>
            <div className="pb-1 text-xs capitalize text-muted-foreground">{fng.rating}</div>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {[["prev close", fng.prevClose], ["1 week", fng.prevWeek], ["1 month", fng.prevMonth], ["1 year", fng.prevYear]]
              .filter(([, v]) => v !== null).map(([l, v]) => `${l} ${Math.round(v as number)}`).join(" · ")}
          </div>
          <Spark points={fng.history} />
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">The {fng.components.length} parts of the index</summary>
          <div className="mt-1.5 space-y-1">
            {fng.components.map((c) => (
              <div key={c.key} className="flex items-center gap-2 text-[11px]">
                <span className="w-40 shrink-0 truncate text-muted-foreground" title={c.label}>{c.label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
                  <div className="h-full rounded" style={{ width: `${Math.max(2, Math.min(100, c.score))}%`, background: fngColor(c.score) }} />
                </div>
                <span className="w-6 text-right font-mono">{Math.round(c.score)}</span>
              </div>
            ))}
          </div>
          </details>
          <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
            Sentiment works at extremes and slowly: washed-out fear has tended to precede better returns, euphoria worse ones — but it is not a timing tool.
            Kept out of the risk score on purpose.
          </p>
        </>
      )}
    </section>
  );
}

function Spark({ points }: { points: { x: number; y: number }[] }) {
  if (points.length < 10) return null;
  const W = 300, Hh = 46;
  const xs = points.map((p) => p.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const X = (x: number) => ((x - x0) / (x1 - x0 || 1)) * W, Y = (y: number) => Hh - (y / 100) * Hh;
  const d = points.map((p, k) => `${k ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} className="mt-2 h-12 w-full" preserveAspectRatio="none" aria-label="Fear & Greed over the last year">
      <rect x="0" y={Y(100)} width={W} height={Y(75) - Y(100)} fill="hsl(150,60%,40%,0.10)" />
      <rect x="0" y={Y(25)} width={W} height={Y(0) - Y(25)} fill="hsl(0,70%,50%,0.10)" />
      <path d={d} fill="none" stroke="hsl(40,90%,60%)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
