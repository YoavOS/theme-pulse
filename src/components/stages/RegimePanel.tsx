import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { REGIME_TEXT, regimeSeries, type RegimeColor, type StockStage } from "@/lib/stageAnalysis";

const REGIME_COLOR: Record<RegimeColor, string> = {
  green: "hsl(152, 60%, 45%)",
  yellow: "hsl(45, 85%, 55%)",
  red: "hsl(344, 75%, 60%)",
};

/** Compact regime badge (used on the Bases page). */
export function RegimeBadge({ rows, compact = false }: { rows: StockStage[]; compact?: boolean }) {
  const s = useMemo(() => regimeSeries(rows), [rows]);
  const w = s[s.length - 1];
  if (!w) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: REGIME_COLOR[w.color] }} />
      {!compact && <span className="text-muted-foreground">List breadth:</span>}
      <span style={{ color: REGIME_COLOR[w.color] }}>{REGIME_TEXT[w.color].label}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{w.p50.toFixed(0)}% &gt;50d · {w.p200.toFixed(0)}% &gt;200d · H/L {w.hl.toFixed(0)}</span>
    </span>
  );
}

/** Market regime from the whole stock list's breadth (Stages tab). */
export default function RegimePanel({ rows }: { rows: StockStage[] }) {
  const s = useMemo(() => regimeSeries(rows), [rows]);
  const [hover, setHover] = useState<number | null>(null);
  if (s.length < 6) return null;
  const w = s[s.length - 1], ago4 = s[Math.max(0, s.length - 5)];
  const shown = hover !== null ? s[hover] : w;
  const delta = (a: number, b: number) => `${a - b >= 0 ? "▲" : "▼"}${Math.abs(a - b).toFixed(0)}`;
  const metric = (label: string, val: string, d: string | null, tip: string) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="min-w-[110px]">
          <div className="text-[10px] text-muted-foreground">{label}</div>
          <div className="font-mono text-sm">{val} {d && <span className="text-[10px] text-muted-foreground">{d} 4w</span>}</div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{tip}</TooltipContent>
    </Tooltip>
  );
  const W = 1000, H = 60;
  const line = (key: "p50" | "p200" | "hl") => s.map((x, k) => `${k ? "L" : "M"}${((k / (s.length - 1)) * W).toFixed(1)},${(H - (x[key] / 100) * (H - 4) - 2).toFixed(1)}`).join(" ");
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <div className="text-[11px] text-muted-foreground">Breadth of your list {hover !== null && `· ${s.length - 1 - hover}w ago`}</div>
              <div className="mt-0.5 flex items-center gap-2 text-base font-semibold" style={{ color: REGIME_COLOR[shown.color] }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: REGIME_COLOR[shown.color] }} />
                {REGIME_TEXT[shown.color].label}
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm text-xs leading-relaxed">
            {REGIME_TEXT[shown.color].tip}
            <br /><br />
            Green = SPY above its 40-week MA with the 10-week above the 40-week, ≥ 50% of your stocks above their 40-week MA (≈ 200-day),
            ≥ 60% above their 10-week (≈ 50-day) and the High–Low index ≥ 55. Red = under 40% above both, or the High–Low index under 40 and falling.
            Breadth research: momentum and breakouts work best in broad, rising markets; after deep washouts the first rebound can be violent — wait for breadth to repair.
          </TooltipContent>
        </Tooltip>
        {metric("% above 50-day (10w)", `${shown.p50.toFixed(0)}%`, hover === null ? delta(w.p50, ago4.p50) : null, "Share of your stocks closing above their 10-week MA (≈ 50-day). ≥ 60% healthy, < 40% weak, < 20–25% washout.")}
        {metric("% above 200-day (40w)", `${shown.p200.toFixed(0)}%`, hover === null ? delta(w.p200, ago4.p200) : null, "Share above their 40-week MA (≈ 200-day) — the structural trend. ≥ 50% bullish majority.")}
        {metric("High–Low index", shown.hl.toFixed(0), hover === null ? delta(w.hl, ago4.hl) : null, "New 52-week highs ÷ (highs + lows) among your stocks, ×100, 2-week average. > 55 leadership expanding, < 40 new lows dominate.")}
        {metric("SPY trend", shown.spyUp === null ? "—" : shown.spyUp ? "Up" : "Not up", null, "SPY above its 40-week MA and its 10-week MA above the 40-week.")}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {hover !== null ? REGIME_TEXT[shown.color].short + " " : ""}{shown.spyUp && shown.color !== "green" ? "The index itself is still up — a narrow market carried by few stocks. " : ""}
        <Link to="/market-flag" className="text-primary hover:underline">Full market picture →</Link>
      </p>
      <div className="relative mt-3">
        <svg viewBox={`0 0 ${W} ${H + 8}`} preserveAspectRatio="none" className="h-[68px] w-full"
          onMouseMove={(e) => { const r = (e.currentTarget as SVGElement).getBoundingClientRect(); setHover(Math.max(0, Math.min(s.length - 1, Math.round(((e.clientX - r.left) / r.width) * (s.length - 1))))); }}
          onMouseLeave={() => setHover(null)}>
          <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="hsl(var(--border))" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          <path d={line("p50")} fill="none" stroke="hsl(200, 70%, 60%)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
          <path d={line("p200")} fill="none" stroke="hsl(280, 60%, 72%)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
          {s.map((x, k) => (
            <rect key={k} x={(k / s.length) * W} y={H + 2} width={W / s.length + 0.5} height={6} fill={REGIME_COLOR[x.color]} opacity={0.85} />
          ))}
          {hover !== null && <line x1={(hover / (s.length - 1)) * W} x2={(hover / (s.length - 1)) * W} y1={0} y2={H + 8} stroke="hsl(var(--muted-foreground))" vectorEffect="non-scaling-stroke" />}
        </svg>
        <div className="mt-1 flex flex-wrap justify-between gap-2 text-[10px] text-muted-foreground">
          <span>{s.length}w ago</span>
          <span><span className="text-[hsl(200,70%,60%)]">— % above 50-day</span> · <span className="text-[hsl(280,60%,72%)]">— % above 200-day</span> · strip = regime each week · dashed = 50%</span>
          <span>last completed week</span>
        </div>
      </div>
    </section>
  );
}
