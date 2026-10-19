import { useMemo, useState } from "react";
import { SectionHead, Segmented } from "@/components/Explainer";
import { ordinal } from "@/lib/utils";
import { STAGE_COLORS, stageWeeksAgo, type StockStage } from "@/lib/stageAnalysis";

/**
 * Stage 2 rotation — groups ranked by the share of their stocks in Stage 2, now vs N weeks ago.
 * The biggest climbers are where new uptrends are forming; the biggest fallers are rolling over.
 * (Deepvue-style "semis went from fewest stocks in Stage 2 to first place".)
 */

const WINDOWS = [2, 4, 8, 13];

interface RotRow { name: string; n: number; now: number; then: number; rankNow: number; rankThen: number; spark: number[] }

function share(members: StockStage[], ago: number) {
  let s2 = 0, tot = 0;
  for (const r of members) {
    const s = stageWeeksAgo(r, ago);
    if (s === null || s === 0) continue;
    tot++; if (s === 2) s2++;
  }
  return tot >= 3 ? { pct: (s2 / tot) * 100, tot } : null;
}

export default function RotationPanel({ groups, asOf, modeLabel, minMembers, onOpen }: {
  groups: { name: string; members: StockStage[] }[];
  asOf: string | null;
  modeLabel: string;
  minMembers: number;
  onOpen: (name: string, rows: StockStage[]) => void;
}) {
  const [win, setWin] = useState(4);

  const rows = useMemo(() => {
    const list: Omit<RotRow, "rankNow" | "rankThen">[] = [];
    for (const g of groups) {
      if (g.name === "Unknown" || g.name === "Other") continue;
      const aligned = g.members.filter((r) => r.as_of === asOf);
      if (aligned.length < Math.max(3, minMembers)) continue;
      const now = share(aligned, 0), then = share(aligned, win);
      if (!now || !then) continue;
      const spark: number[] = [];
      for (let ago = Math.max(12, win); ago >= 0; ago--) spark.push(share(aligned, ago)?.pct ?? NaN);
      list.push({ name: g.name, n: aligned.length, now: now.pct, then: then.pct, spark });
    }
    const rankBy = (key: "now" | "then") => {
      const m = new Map<string, number>();
      [...list].sort((a, b) => b[key] - a[key]).forEach((r, i) => m.set(r.name, i + 1));
      return m;
    };
    const rn = rankBy("now"), rt = rankBy("then");
    return list.map((r) => ({ ...r, rankNow: rn.get(r.name)!, rankThen: rt.get(r.name)! }));
  }, [groups, asOf, win, minMembers]);

  const climbers = useMemo(() => rows.filter((r) => r.rankThen - r.rankNow > 0 && r.now - r.then >= 5)
    .sort((a, b) => (b.rankThen - b.rankNow) - (a.rankThen - a.rankNow) || (b.now - b.then) - (a.now - a.then)).slice(0, 6), [rows]);
  const fallers = useMemo(() => rows.filter((r) => r.rankNow - r.rankThen > 0 && r.then - r.now >= 5)
    .sort((a, b) => (b.rankNow - b.rankThen) - (a.rankNow - a.rankThen) || (b.then - b.now) - (a.then - a.now)).slice(0, 6), [rows]);

  const byName = useMemo(() => new Map(groups.map((g) => [g.name, g.members])), [groups]);

  const list = (items: RotRow[], up: boolean) => (
    <div>
      <div className={`mb-1.5 text-[11px] font-medium ${up ? "text-gain-medium" : "text-loss-medium"}`}>{up ? "▲ Climbing into Stage 2" : "▼ Leaving Stage 2"}</div>
      {!items.length ? (
        <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">No big moves over {win} weeks.</div>
      ) : (
        <div className="space-y-1">
          {items.map((r) => {
            const d = r.rankThen - r.rankNow;
            return (
              <button
                key={r.name}
                onClick={() => onOpen(r.name, byName.get(r.name) ?? [])}
                className="w-full rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5 text-left transition hover:border-border hover:bg-accent/40"
                title={`${r.name}: ${r.then.toFixed(0)}% → ${r.now.toFixed(0)}% of its ${r.n} stocks in Stage 2 · ranked ${ordinal(r.rankThen)} → ${ordinal(r.rankNow)} of ${rows.length}`}
              >
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{r.name} <span className="font-normal text-muted-foreground">({r.n})</span></span>
                  <span className="shrink-0 font-mono text-[11px]">
                    <span className="text-muted-foreground">{r.then.toFixed(0)}%</span>
                    <span className="mx-0.5 text-muted-foreground">→</span>
                    <b style={{ color: up ? STAGE_COLORS[2] : STAGE_COLORS[4] }}>{r.now.toFixed(0)}%</b>
                  </span>
                </span>
                <span className="mt-0.5 flex items-center gap-2">
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {ordinal(r.rankThen)} → <b className="text-foreground">{ordinal(r.rankNow)}</b>
                  </span>
                  <span className={`shrink-0 rounded px-1 font-mono text-[10px] ${d > 0 ? "bg-gain-medium/15 text-gain-medium" : "bg-loss-medium/15 text-loss-medium"}`}>{d > 0 ? "▲" : "▼"}{Math.abs(d)}</span>
                  <span className="ml-auto"><Spark pts={r.spark} up={up} /></span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <SectionHead
        title="Stage 2 rotation"
        sub={`${modeLabel} groups whose share of stocks in Stage 2 moved the most. Climbers are where new uptrends are forming.`}
        right={<Segmented<number> size="xs" value={win} onChange={setWin} options={WINDOWS.map((w) => ({ value: w, label: `vs ${w}w ago` }))} />}
      />
      {rows.length < 4 ? (
        <p className="text-xs text-muted-foreground">Not enough groups with weekly history yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list(climbers, true)}
          {list(fallers, false)}
        </div>
      )}
      <p className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground">
        A group climbing many spots while its Stage 2 share jumps is where new uptrends are forming — often before its returns lead.
        Groups need at least {Math.max(3, minMembers)} stocks. Spark = Stage 2 share over the last {Math.max(12, win)} weeks. Click a group for its stocks.
      </p>
    </section>
  );
}

function Spark({ pts, up }: { pts: number[]; up: boolean }) {
  const v = pts.filter(Number.isFinite);
  if (v.length < 3) return <span />;
  const W = 96, H = 18, max = Math.max(...v) + 4, min = Math.max(0, Math.min(...v) - 4);
  let started = false;
  const d = pts.map((y, k) => {
    if (!Number.isFinite(y)) { started = false; return ""; }
    const seg = `${started ? "L" : "M"}${((k / (pts.length - 1)) * W).toFixed(1)},${(H - 2 - ((y - min) / (max - min || 1)) * (H - 4)).toFixed(1)}`;
    started = true;
    return seg;
  }).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[18px] w-24" aria-hidden>
      <path d={d} fill="none" stroke={up ? STAGE_COLORS[2] : STAGE_COLORS[4]} strokeWidth={1.4} />
    </svg>
  );
}
