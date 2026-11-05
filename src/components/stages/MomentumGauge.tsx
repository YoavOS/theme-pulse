import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Gauge as GaugeIcon, Loader2, RefreshCw } from "lucide-react";
import { buildGauge, dailyBreadth, loadPulse, momentumSeries, VERDICT_TEXT, type Level, type Pulse, type Verdict } from "@/lib/momentumGauge";
import { loadHistory } from "@/lib/rsHistory";
import type { StockStage } from "@/lib/stageAnalysis";

const DM_MONO = "'DM Mono', monospace";
const LEVEL: Record<Level, { label: string; cls: string; dot: string }> = {
  good: { label: "good", cls: "text-gain-medium", dot: "bg-gain-medium" },
  mixed: { label: "mixed", cls: "text-[hsl(40,90%,60%)]", dot: "bg-[hsl(40,90%,55%)]" },
  bad: { label: "bad", cls: "text-loss-medium", dot: "bg-loss-medium" },
  na: { label: "n/a", cls: "text-muted-foreground", dot: "bg-muted-foreground/40" },
};
const TONE: Record<"good" | "warn" | "bad", string> = {
  good: "border-gain-medium/40 bg-gain-medium/[0.06]",
  warn: "border-[hsl(40,90%,55%)]/40 bg-[hsl(40,90%,55%)]/[0.06]",
  bad: "border-loss-medium/40 bg-loss-medium/[0.07]",
};
const VCOLOR: Record<Verdict, string> = { on: "text-gain-medium", selective: "text-[hsl(40,90%,60%)]", off: "text-loss-medium", panic: "text-loss-strong" };

/** "Is this a market where buying strength works?" — top of the Stages tab. */
export default function MomentumGauge({ rows, onVerdict }: { rows: StockStage[]; onVerdict?: (v: Verdict, today: Verdict) => void }) {
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [pulseErr, setPulseErr] = useState<string | null>(null);
  const [mom, setMom] = useState<{ day: string; spread: number; leaders: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try { setPulse(await loadPulse()); setPulseErr(null); } catch (e) { setPulseErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    void refresh();
    // The fast inputs move during the day: refresh every 5 minutes while the tab is visible.
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 5 * 60_000);
    loadHistory(40).then((pts) => setMom(momentumSeries(pts))).catch(() => setMom([]));
    return () => window.clearInterval(id);
  }, []);

  const breadth = useMemo(() => dailyBreadth(rows), [rows]);
  const g = useMemo(() => buildGauge(pulse, mom, breadth), [pulse, mom, breadth]);
  useEffect(() => { if (pulse) onVerdict?.(g.verdict, g.today); }, [g.verdict, g.today, pulse, onVerdict]);

  const shown = g.today;
  const t = VERDICT_TEXT[shown];
  const changedToday = g.today !== g.verdict;
  const session = pulse ? { pre: "pre-market", regular: "market open", post: "after hours", closed: "market closed" }[pulse.session] : null;

  return (
    <section className={`rounded-lg border p-4 ${TONE[t.tone]}`}>
      <div className="flex flex-wrap items-start gap-3">
        <GaugeIcon size={18} className={`mt-0.5 ${VCOLOR[shown]}`} />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground" style={{ fontFamily: DM_MONO }}>
            Momentum gauge {changedToday ? "· today" : ""}
          </div>
          <div className={`text-lg font-semibold ${VCOLOR[shown]}`}>{loading && !pulse ? "Reading the market…" : t.label}</div>
          <p className="text-sm text-foreground/85">{t.text}</p>
          {changedToday && (
            <p className="mt-1 text-xs text-muted-foreground">
              Market overall: <span className={VCOLOR[g.verdict]}>{VERDICT_TEXT[g.verdict].label}</span> — today is rated more cautiously because of what's happening right now.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground" style={{ fontFamily: DM_MONO }}>
          {pulse && <span>{session} · {new Date(pulse.asOf).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>}
          <button onClick={() => void refresh()} className="rounded p-1 hover:bg-white/10" title="Refresh the live readings">
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
        </div>
      </div>

      {g.todayReasons.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <AlertTriangle size={12} className="text-[hsl(40,90%,60%)]" />
          {g.todayReasons.map((r) => (
            <span key={r} className="rounded border border-[hsl(40,90%,55%)]/30 bg-[hsl(40,90%,55%)]/10 px-1.5 py-0.5 text-[11px] text-[hsl(40,90%,72%)]">{r}</span>
          ))}
        </div>
      )}
      {pulseErr && <p className="mt-2 text-xs text-loss-medium">Live market data unavailable ({pulseErr}) — the gauge uses what it has.</p>}

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {g.readings.map((r) => (
          <div key={r.key} className="rounded-md border border-white/[0.06] bg-background/40 p-2.5" title={`${r.meaning}\n\nSource: ${r.source}`}>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
              <span className={`h-2 w-2 rounded-full ${LEVEL[r.level].dot}`} /> {r.name}
              <span className={`ml-auto text-[10px] ${LEVEL[r.level].cls}`}>{LEVEL[r.level].label}</span>
            </div>
            <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{r.value}</div>
          </div>
        ))}
      </div>

      {mom.length > 1 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] text-muted-foreground">Leaders minus laggards in your list, each 4-week window (newest right)</div>
          <div className="flex h-10 items-center gap-[3px]">
            {mom.slice(-26).map((m) => {
              const h = (Math.abs(m.spread) / Math.max(1, ...mom.slice(-26).map((x) => Math.abs(x.spread)))) * 100;
              return (
                <div key={m.day} className="flex h-full flex-1 flex-col" title={`4 weeks to ${m.day}: ${m.spread > 0 ? "+" : ""}${m.spread} pts`}>
                  <div className="flex h-1/2 items-end">{m.spread > 0 && <div className="w-full rounded-t-sm bg-gain-medium/70" style={{ height: `${h}%` }} />}</div>
                  <div className="flex h-1/2 items-start border-t border-white/10">{m.spread < 0 && <div className="w-full rounded-b-sm bg-loss-medium/70" style={{ height: `${h}%` }} />}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <button onClick={() => setOpen((v) => !v)} className="mt-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
        <ChevronDown size={12} className={`transition ${open ? "rotate-180" : ""}`} /> How the gauge decides · how well it has worked
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-[11.5px] leading-relaxed text-muted-foreground">
          <ul className="space-y-1">
            {g.readings.map((r) => (
              <li key={r.key}><b className="text-foreground/90">{r.name}</b> (weight {r.weight}): {r.meaning} <i>— {r.source}</i></li>
            ))}
          </ul>
          <p>
            <b className="text-foreground/90">Verdict:</b> score {g.score} of ±{g.maxScore}. <b>Momentum on</b> needs ≥ 2.5 with no bad trend, volatility or momentum reading;
            <b> off</b> at ≤ −1.5 (or bad trend and bad momentum together); <b>panic</b> when volatility is bad after a fall (trend bad or 8%+ off the high) —
            the state in which momentum has crashed most (Daniel & Moskowitz). <b>Today</b> can only be more careful: futures or indexes down 1.5%+, the VIX up 15%+
            → at least "off" for today; a Fed day, election days, mega-cap earnings or the first 30 minutes → "on" becomes "selective".
          </p>
          <p>
            <b className="text-foreground/90">Track record (honest):</b> tested on your list's past year (25 weekly readings, Apr–Sep 2026). Calm volatility was the most useful input:
            the leaders beat the rest of the list by +1.7% the next month when it read good, and lagged by −4.1% when it didn't. Momentum's own results persisted
            (after a bad 4 weeks, the next month worked only 29% of the time). It did <b>not</b> foresee the sudden June 2026 momentum crash — no reading did, the
            gauge said "on" a week before it. Treat it as a weather report, not a forecast.
          </p>
        </div>
      )}
    </section>
  );
}
