import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, BookOpen, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { BottomLine, HowItWorks } from "@/components/Explainer";
import WatchStar from "@/components/WatchStar";
import { useStockStages } from "@/hooks/useStockStages";
import { useUniverseSectors } from "@/hooks/useUniverseSectors";
import { groupKeyForIndustry } from "@/lib/groupColors";
import { STAGE_COLORS, type StageNum, type StockStage } from "@/lib/stageAnalysis";

// ─────────────────────────────────────────────────────────────
// Model Book — the biggest recent winners on your list, shown as they looked
// at the breakout. Built from each stock's weekly stage history and its last
// 40 weekly closes (no extra data calls): find the latest Stage 1 → 2 breakout
// 5–39 weeks ago, then measure what followed.
// ─────────────────────────────────────────────────────────────

interface Model {
  r: StockStage; boIdx: number; weeksSince: number; baseWeeks: number;
  gainNow: number; gainMax: number; weeksToMax: number; worstDip: number; stillS2: boolean;
}

function findModel(r: StockStage): Model | null {
  const wc = r.features?.wc ?? [];
  const h = r.history ?? "";
  if (wc.length < 20 || h.length < 20) return null;
  // latest breakout into Stage 2 from a base (1) or a transition (T)
  let j = -1;
  for (let k = h.length - 1; k >= 1; k--) if (h[k] === "2" && (h[k - 1] === "1" || h[k - 1] === "T")) { j = k; break; }
  if (j < 0) return null;
  const weeksSince = h.length - 1 - j;
  if (weeksSince < 5 || weeksSince > wc.length - 2) return null;
  const boIdx = wc.length - 1 - weeksSince;
  const bo = wc[boIdx];
  if (!(bo > 0)) return null;
  let baseWeeks = 0;
  for (let k = j - 1; k >= 0 && (h[k] === "1" || h[k] === "T"); k--) baseWeeks++;
  const after = wc.slice(boIdx);
  const maxV = Math.max(...after), maxAt = after.indexOf(maxV);
  const worst = Math.min(...after.slice(0, Math.max(1, maxAt + 1)));
  return {
    r, boIdx, weeksSince, baseWeeks,
    gainNow: (wc[wc.length - 1] / bo - 1) * 100,
    gainMax: (maxV / bo - 1) * 100,
    weeksToMax: maxAt,
    worstDip: (worst / bo - 1) * 100,
    stillS2: r.stage === 2,
  };
}

const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };

function ModelChart({ m }: { m: Model }) {
  const c = m.r.features!.wc!;
  const lo = Math.min(...c), hi = Math.max(...c);
  const W = 300, H = 96;
  const X = (k: number) => (k / (c.length - 1)) * W, Y = (v: number) => H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 12);
  const d = c.map((v, k) => `${k ? "L" : "M"}${X(k).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  const strip = (m.r.history ?? "").slice(-c.length);
  const baseStart = Math.max(0, m.boIdx - m.baseWeeks);
  return (
    <svg viewBox={`0 0 ${W} ${H + 6}`} className="h-[102px] w-full" preserveAspectRatio="none" aria-label={`${m.r.symbol}: 40 weekly closes with the breakout marked`}>
      <rect x={X(baseStart)} y={0} width={Math.max(2, X(m.boIdx) - X(baseStart))} height={H} fill="hsl(var(--muted))" opacity={0.35} />
      <line x1={X(m.boIdx)} x2={X(m.boIdx)} y1={0} y2={H} stroke="hsl(var(--primary))" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      <line x1={0} x2={W} y1={Y(c[m.boIdx])} y2={Y(c[m.boIdx])} stroke="hsl(var(--primary))" strokeWidth={0.6} opacity={0.4} vectorEffect="non-scaling-stroke" />
      <path d={d} fill="none" stroke="hsl(var(--foreground))" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      {[...strip].map((ch, k) => (
        <rect key={k} x={X(k) - W / c.length / 2} y={H + 1} width={W / c.length + 0.4} height={5}
          fill={ch === "T" ? "hsl(var(--muted-foreground))" : STAGE_COLORS[Number(ch) as StageNum] ?? "transparent"} opacity={0.85} />
      ))}
    </svg>
  );
}

export default function ModelBook() {
  const { rows, loading } = useStockStages(true);
  const { rows: uni, extra, load } = useUniverseSectors();
  const [minGain, setMinGain] = useState(50);
  const [only, setOnly] = useState<"all" | "running" | "done">("all");
  useEffect(() => { load(); }, [load]);

  const info = useMemo(() => {
    const m = new Map<string, { name: string | null; sector: string | null }>();
    for (const r of extra) m.set(r.symbol.toUpperCase(), { name: null, sector: r.sector });
    for (const r of uni) m.set(r.symbol.toUpperCase(), { name: r.name ?? null, sector: r.sector });
    return m;
  }, [uni, extra]);

  const models = useMemo(() => {
    const asOf = rows.reduce<string | null>((m, r) => (!m || r.as_of > m ? r.as_of : m), null);
    return rows.filter((r) => r.symbol !== "SPY" && r.as_of === asOf).map(findModel).filter((m): m is Model => !!m)
      .sort((a, b) => b.gainMax - a.gainMax);
  }, [rows]);
  const shown = models.filter((m) => m.gainMax >= minGain && (only === "all" || (only === "running" ? m.stillS2 : !m.stillS2)));
  const winners = models.filter((m) => m.gainMax >= 50);
  const lesson = winners.length >= 5 ? {
    base: med(winners.map((m) => m.baseWeeks))!, toMax: med(winners.map((m) => m.weeksToMax))!,
    dipShare: Math.round((winners.filter((m) => m.worstDip <= -8).length / winners.length) * 100),
    below: Math.round((winners.filter((m) => m.worstDip < -0.5).length / winners.length) * 100),
    all: models.length, hit: Math.round((winners.length / Math.max(1, models.length)) * 100),
  } : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-3">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          <Link to="/" className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><ArrowLeft size={14} /></Link>
          <BookOpen size={16} className="text-[hsl(40,90%,55%)]" />
          <h1 className="text-sm font-semibold tracking-wide">Model Book</h1>
          <span className="text-[11px] text-muted-foreground">recent winners on your list, as they looked at the breakout</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-5">
        {loading && !rows.length && <p className="text-sm text-muted-foreground">Loading…</p>}
        {lesson && (
          <BottomLine
            tone="neutral"
            title={<>{winners.length} stocks gained 50%+ after a Stage 1 → 2 breakout in the last 9 months — study what they had in common.</>}
            lines={[
              <>Typical base before the breakout: <b className="text-foreground/90">{lesson.base} weeks</b>. Typical time to the peak: <b className="text-foreground/90">{lesson.toMax} weeks</b>.</>,
              <>{lesson.below}% of winners closed below the breakout week at least once before peaking, and <b className="text-foreground/90">{lesson.dipShare}%</b> fell 8% or more first — size the position so a normal shakeout doesn't stop you out.</>,
              <>Only {lesson.hit}% of the {lesson.all} breakouts in this window became 50% winners — most breakouts don't, which is why the stop matters.</>,
            ]}
          />
        )}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
          <span className="text-muted-foreground">Gain after breakout</span>
          {[30, 50, 100].map((g) => (
            <button key={g} onClick={() => setMinGain(g)} className={`rounded-full border px-2.5 py-0.5 ${minGain === g ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{g}%+</button>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          {(["all", "running", "done"] as const).map((o) => (
            <button key={o} onClick={() => setOnly(o)} className={`rounded-full border px-2.5 py-0.5 ${only === o ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
              {o === "all" ? "All" : o === "running" ? "Still in Stage 2" : "Run is over"}
            </button>
          ))}
          <span className="ml-auto text-muted-foreground">{shown.length} examples</span>
        </div>
        {!shown.length && !loading && <Card className="p-6 text-sm text-muted-foreground">No examples match — try a lower gain, or run a Full Scan to refresh the stage history.</Card>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.slice(0, 60).map((m) => {
            const i = info.get(m.r.symbol);
            return (
              <Card key={m.r.symbol} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <WatchStar symbol={m.r.symbol} />
                      <span className="font-mono text-sm font-bold">{m.r.symbol}</span>
                      <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(m.r.symbol)}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" title="Open in TradingView"><ExternalLink size={11} /></a>
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">{i?.name ?? ""}{i?.sector ? ` · ${groupKeyForIndustry(i.sector, "industry")}` : ""}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-lg font-bold text-gain-medium">+{m.gainMax.toFixed(0)}%</div>
                    <div className="text-[10px] text-muted-foreground">peak · now {m.gainNow >= 0 ? "+" : ""}{m.gainNow.toFixed(0)}%</div>
                  </div>
                </div>
                <ModelChart m={m} />
                <div className="mt-1 grid grid-cols-3 gap-1 text-[10.5px]">
                  <div><div className="text-muted-foreground">Base</div><div className="font-mono">{m.baseWeeks}w</div></div>
                  <div><div className="text-muted-foreground">Breakout</div><div className="font-mono">{m.weeksSince}w ago</div></div>
                  <div><div className="text-muted-foreground">Worst dip</div><div className="font-mono">{m.worstDip.toFixed(0)}%</div></div>
                </div>
                <div className="mt-2 flex items-center justify-between text-[10.5px]">
                  <span className={m.stillS2 ? "text-gain-medium" : "text-muted-foreground"}>{m.stillS2 ? "Still in Stage 2" : `Now Stage ${m.r.stage || "T"}`}</span>
                  <Link to={`/minervini?symbol=${encodeURIComponent(m.r.symbol)}`} className="text-primary hover:underline">Fundamentals →</Link>
                </div>
              </Card>
            );
          })}
        </div>
        <HowItWorks title="How examples are picked">
          <p>
            For every stock, the app finds its latest move from a base (Stage 1) into an advance (Stage 2) in the weekly stage history, 5–39 weeks ago,
            and measures the weekly closes since: the highest point (peak gain), where it is now, and the worst weekly close before the peak (the shakeout).
            Grey shading = the base before the breakout; dashed line = the breakout week; the strip under each chart = the stage each week.
          </p>
          <p>
            It uses only data the stage scan already stores (40 weekly closes per stock), so it covers the last ~9 months and today's list only —
            stocks that collapsed and left the list are missing, which makes winners look more common than they are.
          </p>
        </HowItWorks>
      </main>
    </div>
  );
}
