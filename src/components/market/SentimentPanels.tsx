import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { STRENGTH_STYLE } from "@/lib/marketPlaybook";
import type { StockStage } from "@/lib/stageAnalysis";

/**
 * Sentiment & positioning cards for the Market Flag page:
 *   • AAII individual-investor survey (weekly)        — market-sentiment function
 *   • COT positioning in the index futures (weekly)   — market-sentiment function
 *   • McClellan oscillator + summation of your list   — from the stage scan's daily up/down record
 * All are context at extremes, not timing signals — kept out of the risk score.
 */

interface CotContract {
  key: string; name: string; date: string; oi: number;
  specNet: number; specNetPct: number; specIndex: number; specChg1w: number;
  commNet: number; commIndex: number; specIndexHist: number[]; read: string;
}
interface AaiiWeek { date: string; bull: number; neutral: number; bear: number }
interface SentimentPayload {
  generatedAt: string;
  cot: CotContract[] | null;
  aaii: { weeks: AaiiWeek[]; longRun: { bull: number; neutral: number; bear: number } } | null;
  errors: string[];
}

const KEY = "market_sentiment_cache_v1";
const TTL = 3 * 60 * 60 * 1000;
const GREEN = "hsl(150,65%,48%)", RED = "hsl(344,75%,62%)", AMBER = "hsl(42,90%,58%)", GREY = "hsl(220,9%,55%)";

export function useMarketSentiment(refreshKey: number) {
  const [data, setData] = useState<SentimentPayload | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "fail">("loading");
  useEffect(() => {
    let live = true;
    const force = refreshKey > 0;
    (async () => {
      setState("loading");
      if (!force) {
        try {
          const raw = localStorage.getItem(KEY);
          if (raw) { const p = JSON.parse(raw) as { at: number; v: SentimentPayload }; if (Date.now() - p.at < TTL) { setData(p.v); setState("ok"); return; } }
        } catch { /* ignore */ }
      }
      try {
        const { data: res, error } = await supabase.functions.invoke("market-sentiment", { body: { force } });
        if (error) throw error;
        const v = res as SentimentPayload;
        if (!live) return;
        setData(v); setState(v?.cot || v?.aaii ? "ok" : "fail");
        if (v?.cot || v?.aaii) { try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), v })); } catch { /* quota */ } }
      } catch {
        if (live) setState("fail");
      }
    })();
    return () => { live = false; };
  }, [refreshKey]);
  return { data, state };
}

function Card({ title, sub, evidence, children }: { title: string; sub: string; evidence: "strong" | "moderate" | "weak"; children: React.ReactNode }) {
  return (
    <section className="flex flex-col rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[15px] font-semibold leading-tight tracking-tight">{title}</h3>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</p>
        </div>
        <span className={`shrink-0 rounded px-1.5 py-[1px] text-[10px] ${STRENGTH_STYLE[evidence]}`} title="How strong the evidence is that this predicts returns">{evidence} evidence</span>
      </div>
      {children}
    </section>
  );
}

const Unavailable = ({ what, state }: { what: string; state: "loading" | "ok" | "fail" }) =>
  state === "loading"
    ? <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Loading…</p>
    : <p className="text-xs text-muted-foreground">{what} couldn't be loaded right now{state === "fail" ? " (the market-sentiment function may not be deployed yet)" : ""}.</p>;

// ── AAII ────────────────────────────────────────────────────────
export function AaiiCard({ data, state }: { data: SentimentPayload | null; state: "loading" | "ok" | "fail" }) {
  const a = data?.aaii;
  if (!a?.weeks.length && state !== "loading") return null; // source unreachable → hide rather than show a broken card
  if (!a?.weeks.length) return <Card title="Investor sentiment" sub="AAII survey, weekly" evidence="moderate"><Unavailable what="The AAII survey" state={state} /></Card>;
  const w = a.weeks[a.weeks.length - 1];
  const spread = w.bull - w.bear;
  const last8 = a.weeks.slice(-8);
  const bull8 = last8.reduce((s, x) => s + x.bull, 0) / last8.length;
  const read = w.bear >= 50 ? { t: "Extreme pessimism", c: GREEN, n: "Bearish readings this high have historically come before above-average returns (contrarian)." }
    : w.bull >= 50 ? { t: "Extreme optimism", c: RED, n: "Bullish readings this high have tended to come before weaker returns (contrarian)." }
    : spread <= -15 ? { t: "Crowd leaning bearish", c: AMBER, n: "More bears than usual — mildly supportive as a contrarian read." }
    : spread >= 20 ? { t: "Crowd leaning bullish", c: AMBER, n: "More bulls than usual — complacency risk if it keeps rising." }
    : { t: "Ordinary", c: GREY, n: "Nothing extreme — no contrarian signal." };
  const spreads = a.weeks.map((x) => x.bull - x.bear);
  const W = 300, H = 46, mx = Math.max(25, ...spreads.map(Math.abs));
  const y = (v: number) => H / 2 - (v / mx) * (H / 2 - 2);
  return (
    <Card title="Investor sentiment" sub={`AAII survey · week of ${new Date(w.date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`} evidence="moderate">
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-bold" style={{ color: read.c }}>{read.t}</span>
        <span className="font-mono text-xs text-muted-foreground">bull − bear {spread >= 0 ? "+" : ""}{spread.toFixed(1)}</span>
      </div>
      <div className="mt-2 flex h-3 overflow-hidden rounded">
        <div style={{ width: `${w.bull}%`, background: GREEN }} title={`Bullish ${w.bull}%`} />
        <div style={{ width: `${w.neutral}%`, background: GREY }} title={`Neutral ${w.neutral}%`} />
        <div style={{ width: `${w.bear}%`, background: RED }} title={`Bearish ${w.bear}%`} />
      </div>
      <div className="mt-1 grid grid-cols-3 text-[11px]">
        <span style={{ color: GREEN }}>Bullish {w.bull.toFixed(1)}%<span className="block text-[10px] text-muted-foreground">avg {a.longRun.bull}%</span></span>
        <span className="text-center text-muted-foreground">Neutral {w.neutral.toFixed(1)}%<span className="block text-[10px]">avg {a.longRun.neutral}%</span></span>
        <span className="text-right" style={{ color: RED }}>Bearish {w.bear.toFixed(1)}%<span className="block text-[10px] text-muted-foreground">avg {a.longRun.bear}%</span></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-12 w-full" preserveAspectRatio="none" aria-label="Bull minus bear spread, weekly">
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="hsl(var(--border))" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {spreads.map((v, i) => {
          const bw = W / spreads.length;
          return <rect key={i} x={i * bw + 1} width={Math.max(1, bw - 2)} y={Math.min(y(v), H / 2)} height={Math.abs(y(v) - H / 2)} fill={v >= 0 ? GREEN : RED} opacity={i === spreads.length - 1 ? 1 : 0.55} />;
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground"><span>{a.weeks.length} weeks ago</span><span>bull − bear spread</span><span>this week</span></div>
      <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">{read.n} 8-week average bullish: {bull8.toFixed(0)}%. Individual investors' mood works as a contrarian gauge only at extremes.</p>
    </Card>
  );
}

// ── COT ─────────────────────────────────────────────────────────
export function CotCard({ data, state }: { data: SentimentPayload | null; state: "loading" | "ok" | "fail" }) {
  const cot = data?.cot;
  if (!cot?.length && state !== "loading") return null;
  if (!cot?.length) return <Card title="Futures positioning" sub="CFTC Commitments of Traders" evidence="weak"><Unavailable what="COT data" state={state} /></Card>;
  const fmtK = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x) >= 1e6 ? (Math.abs(x) / 1e6).toFixed(2) + "M" : Math.round(Math.abs(x) / 1000) + "k"}`;
  return (
    <Card title="Futures positioning" sub={`CFTC COT · as of ${new Date(cot[0].date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`} evidence="weak">
      <div className="space-y-2.5">
        {cot.map((c) => {
          const col = c.specIndex >= 80 ? RED : c.specIndex <= 20 ? GREEN : GREY;
          return (
            <div key={c.key}>
              <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
                <span className="font-medium">{c.name} <span className="font-mono text-[10px] text-muted-foreground">{c.key}</span></span>
                <span className="truncate text-[10.5px]" style={{ color: col === GREY ? undefined : col }}>{c.read}</span>
              </div>
              <div className="mt-1 grid grid-cols-[1fr_70px] items-center gap-2">
                <div className="relative h-2.5 rounded bg-muted/60" title={`Speculators' net position sits at ${c.specIndex} of 100 within its 3-year range (0 = most short, 100 = most long)`}>
                  <div className="absolute inset-y-0 left-[20%] w-px bg-border" /><div className="absolute inset-y-0 left-[80%] w-px bg-border" />
                  <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${Math.max(3, c.specIndex)}%`, background: col, opacity: 0.85 }} />
                </div>
                <MiniLine pts={c.specIndexHist} color={col} />
              </div>
              <div className="mt-0.5 flex justify-between font-mono text-[10px] text-muted-foreground">
                <span>specs {c.specIndex}/100 · net {fmtK(c.specNet)} ({c.specNetPct >= 0 ? "+" : ""}{c.specNetPct}% of OI) · 1w {fmtK(c.specChg1w)}</span>
                <span title="Commercials (hedgers) — their net position within its 3-year range">hedgers {c.commIndex}/100</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
        Bar = speculators' net position within its 3-year range; spark = the last year. Extremes (beyond the lines at 20 and 80) are read contrarian:
        crowded shorts can fuel squeezes, crowded longs can unwind. Index futures are also used for hedging, so treat this as background.
      </p>
    </Card>
  );
}

function MiniLine({ pts, color }: { pts: number[]; color: string }) {
  if (pts.length < 4) return <span />;
  const W = 70, H = 18;
  const d = pts.map((v, k) => `${k ? "L" : "M"}${((k / (pts.length - 1)) * W).toFixed(1)},${(H - 1 - (v / 100) * (H - 2)).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[18px] w-[70px]" aria-hidden>
      <rect x={0} y={0} width={W} height={H * 0.2} fill={RED} opacity={0.08} />
      <rect x={0} y={H * 0.8} width={W} height={H * 0.2} fill={GREEN} opacity={0.08} />
      <path d={d} fill="none" stroke={color === GREY ? "hsl(var(--foreground))" : color} strokeWidth={1.2} opacity={0.85} />
    </svg>
  );
}

// ── McClellan on your list ──────────────────────────────────────
export function mcclellan(rows: StockStage[]) {
  const withUd = rows.filter((r) => r.symbol !== "SPY" && r.features?.dly?.ud && r.features.dly.date);
  if (withUd.length < 50) return null;
  // align on the most common last session
  const cnt = new Map<string, number>();
  for (const r of withUd) cnt.set(r.features!.dly!.date, (cnt.get(r.features!.dly!.date) ?? 0) + 1);
  const date = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const al = withUd.filter((r) => r.features!.dly!.date === date).map((r) => r.features!.dly!.ud!);
  const L = Math.min(120, Math.max(...al.map((s) => s.length)));
  const rana: number[] = [], adv: number[] = [], dec: number[] = [];
  for (let ago = L - 1; ago >= 0; ago--) {
    let a = 0, d = 0;
    for (const s of al) { const ch = s[s.length - 1 - ago]; if (ch === "u") a++; else if (ch === "d") d++; }
    adv.push(a); dec.push(d);
    rana.push(a + d ? ((a - d) / (a + d)) * 1000 : 0);
  }
  let e19 = rana[0], e39 = rana[0], sum = 0;
  const osc: number[] = [], summ: number[] = [];
  for (const x of rana) {
    e19 = x * 0.1 + e19 * 0.9; e39 = x * 0.05 + e39 * 0.95;
    const o = e19 - e39; osc.push(o); sum += o; summ.push(sum);
  }
  // first ~40 sessions are EMA warm-up — show what follows
  const skip = Math.min(40, Math.max(0, osc.length - 20));
  return { date, n: al.length, osc: osc.slice(skip), summ: summ.slice(skip), adv: adv[adv.length - 1], dec: dec[dec.length - 1] };
}

export function McClellanCard({ rows }: { rows: StockStage[] }) {
  const m = useMemo(() => mcclellan(rows), [rows]);
  if (!m || m.osc.length < 10) {
    return (
      <Card title="Breadth momentum" sub="McClellan oscillator of your list" evidence="weak">
        <p className="text-xs text-muted-foreground">Needs the daily up/down record from the updated stage scan — run a Full Scan or Scan Stages once after deploying.</p>
      </Card>
    );
  }
  const now = m.osc[m.osc.length - 1];
  const s = m.summ, sNow = s[s.length - 1], s5 = s[Math.max(0, s.length - 6)];
  const read = now <= -80 ? { t: "Deeply oversold", c: GREEN } : now <= -50 ? { t: "Oversold", c: GREEN }
    : now >= 80 ? { t: "Very overbought", c: RED } : now >= 50 ? { t: "Overbought", c: AMBER } : { t: "Neutral", c: GREY };
  const W = 300, H = 60, mx = Math.max(60, ...m.osc.map(Math.abs));
  const y = (v: number) => H / 2 - (v / mx) * (H / 2 - 2);
  const sLo = Math.min(...s), sHi = Math.max(...s);
  const ys = (v: number) => H - 2 - ((v - sLo) / (sHi - sLo || 1)) * (H - 4);
  const bw = W / m.osc.length;
  return (
    <Card title="Breadth momentum" sub={`McClellan oscillator · ${m.n.toLocaleString("en-US")} stocks of your list`} evidence="weak">
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-bold" style={{ color: read.c }}>{read.t}</span>
        <span className="font-mono text-xs text-muted-foreground">{now >= 0 ? "+" : ""}{now.toFixed(0)}</span>
        <span className={`ml-auto text-[11px] ${sNow >= s5 ? "text-gain-medium" : "text-loss-medium"}`} title="Summation index: running total of the oscillator — its direction is the medium-term breadth trend">
          summation {sNow >= s5 ? "rising ▲" : "falling ▼"}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-[60px] w-full" preserveAspectRatio="none" aria-label="McClellan oscillator (bars) and summation index (line)">
        <rect x={0} y={0} width={W} height={y(50)} fill={RED} opacity={0.06} />
        <rect x={0} y={y(-50)} width={W} height={H - y(-50)} fill={GREEN} opacity={0.06} />
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="hsl(var(--border))" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {m.osc.map((v, i) => (
          <rect key={i} x={i * bw + 0.3} width={Math.max(0.6, bw - 0.6)} y={Math.min(y(v), H / 2)} height={Math.abs(y(v) - H / 2)} fill={v >= 0 ? GREEN : RED} opacity={i === m.osc.length - 1 ? 1 : 0.6} />
        ))}
        <path d={s.map((v, k) => `${k ? "L" : "M"}${(k * bw + bw / 2).toFixed(1)},${ys(v).toFixed(1)}`).join("")} fill="none" stroke="hsl(var(--foreground))" strokeWidth={1.3} opacity={0.7} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground"><span>{m.osc.length} sessions ago</span><span>bars = oscillator · line = summation</span><span>{new Date(m.date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></div>
      <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
        Last session: {m.adv} up, {m.dec} down. The oscillator is the 19- minus 39-day average of (advancers − decliners) ÷ total ×1000 across your list — beyond ±50 is stretched,
        often near short-term turning points; the summation line shows the slower breadth trend. Computed from your list, not the NYSE.
      </p>
    </Card>
  );
}
