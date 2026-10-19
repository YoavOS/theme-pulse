import { useMemo, useState, type ReactNode } from "react";
import type { ThemeData, Ticker } from "@/data/themeData";
import type { PerfCache } from "@/hooks/useFullScan";

/**
 * Tracker "1W · 1M · 3M" view: every group's average move over three timeframes side by side,
 * with a plain-language label for how leadership is evolving:
 *   Consistent leader — top third of groups on all three timeframes
 *   New leader        — top third on 1W and 1M, not on 3M (money rotating in)
 *   Losing steam      — top third on 3M, bottom half on 1W and 1M (rotating out)
 *   Turning up        — bottom third on 3M, top third on 1W
 *   Consistent laggard — bottom third on all three
 */

type Key = "w" | "m" | "q";
const COLS: { key: Key; label: string; field: "perf_1w" | "perf_1m" | "perf_3m" }[] = [
  { key: "w", label: "1 week", field: "perf_1w" },
  { key: "m", label: "1 month", field: "perf_1m" },
  { key: "q", label: "3 months", field: "perf_3m" },
];

export type TrendLabel = "consistent" | "new" | "turning" | "fading" | "laggard" | "mixed";
export const TREND_META: Record<TrendLabel, { text: string; tip: string; cls: string; order: number }> = {
  consistent: { text: "Consistent leader", tip: "Top third of groups on 1 week, 1 month and 3 months.", cls: "border-[hsl(166,100%,42%)]/40 bg-[hsl(166,100%,42%)]/10 text-[hsl(166,90%,55%)]", order: 0 },
  new: { text: "New leader", tip: "Top third on 1 week and 1 month but not on 3 months — money rotating in.", cls: "border-[hsl(200,90%,60%)]/40 bg-[hsl(200,90%,60%)]/10 text-[hsl(200,90%,70%)]", order: 1 },
  turning: { text: "Turning up", tip: "Bottom third on 3 months but top third this week — an early bounce; needs the month to confirm.", cls: "border-[hsl(45,90%,55%)]/40 bg-[hsl(45,90%,55%)]/10 text-[hsl(45,90%,62%)]", order: 2 },
  mixed: { text: "Mixed", tip: "No clear pattern across the three timeframes.", cls: "border-border bg-muted/30 text-muted-foreground", order: 3 },
  fading: { text: "Losing steam", tip: "Top third on 3 months but bottom half on 1 week and 1 month — leadership fading.", cls: "border-[hsl(25,90%,60%)]/40 bg-[hsl(25,90%,60%)]/10 text-[hsl(25,90%,66%)]", order: 4 },
  laggard: { text: "Consistent laggard", tip: "Bottom third on all three timeframes.", cls: "border-[hsl(344,100%,65%)]/40 bg-[hsl(344,100%,65%)]/10 text-[hsl(344,100%,72%)]", order: 5 },
};
const FILTERS: (TrendLabel | "all")[] = ["all", "consistent", "new", "turning", "fading", "laggard"];

interface Row {
  name: string;
  v: Record<Key, number>;
  pr: Record<Key, number>; // percentile rank 0–1 among groups (1 = best)
  label: TrendLabel;
  n: number;
  theme: ThemeData;
}

function niceMax(x: number) {
  if (!(x > 0)) return 1;
  const steps = [0.5, 1, 2, 3, 4, 5, 8, 10, 15, 20, 30, 40, 50, 75, 100, 150, 200];
  return steps.find((s) => s >= x) ?? Math.ceil(x / 100) * 100;
}

export function classifyTrend(pr: Record<Key, number>): TrendLabel {
  const top = (k: Key) => pr[k] >= 2 / 3, bottom = (k: Key) => pr[k] <= 1 / 3, lowerHalf = (k: Key) => pr[k] < 0.5;
  if (top("w") && top("m") && top("q")) return "consistent";
  if (bottom("w") && bottom("m") && bottom("q")) return "laggard";
  if (top("w") && top("m")) return "new";
  if (top("q") && lowerHalf("w") && lowerHalf("m")) return "fading";
  if (bottom("q") && top("w")) return "turning";
  return "mixed";
}

export default function TrackerTrendView({
  groups, perf, title, status, switcher, onOpen, universe,
}: {
  groups: Map<string, { symbol: string; name?: string | null }[]>;
  perf: PerfCache | null;
  title: string;
  status: string;
  switcher: ReactNode;
  onOpen: (t: ThemeData) => void;
  universe: boolean;
}) {
  const [filter, setFilter] = useState<TrendLabel | "all">("all");
  const [sort, setSort] = useState<Key | "label">("label");

  const rows = useMemo(() => {
    if (!perf) return [] as Row[];
    const base: Omit<Row, "pr" | "label">[] = [];
    groups.forEach((members, name) => {
      const sums: Record<Key, number> = { w: 0, m: 0, q: 0 };
      const tickers: Ticker[] = [];
      let n = 0;
      for (const mem of members) {
        const p = perf.tickers[mem.symbol];
        if (!p || ![p.perf_1w, p.perf_1m, p.perf_3m].every((x) => typeof x === "number" && Number.isFinite(x))) continue;
        n++;
        sums.w += p.perf_1w; sums.m += p.perf_1m; sums.q += p.perf_3m;
        tickers.push({ symbol: mem.symbol, name: mem.name ?? undefined, pct: Math.round(p.perf_1m * 100) / 100 });
      }
      if (n < 2) return; // one stock is not a group trend
      const v = { w: sums.w / n, m: sums.m / n, q: sums.q / n };
      tickers.sort((a, b) => b.pct - a.pct);
      base.push({
        name, v, n,
        theme: {
          theme_name: name, performance_pct: Math.round(v.m * 100) / 100,
          up_count: tickers.filter((t) => t.pct > 0).length, down_count: tickers.filter((t) => t.pct <= 0).length,
          na_count: members.length - n, valid_count: n, tickers, dataSource: "real",
        },
      });
    });
    const rank = (k: Key) => {
      const sorted = [...base].sort((a, b) => a.v[k] - b.v[k]);
      const m = new Map<string, number>();
      sorted.forEach((r, i) => m.set(r.name, sorted.length > 1 ? i / (sorted.length - 1) : 0.5));
      return m;
    };
    const rw = rank("w"), rm = rank("m"), rq = rank("q");
    return base.map((r) => {
      const pr = { w: rw.get(r.name)!, m: rm.get(r.name)!, q: rq.get(r.name)! };
      return { ...r, pr, label: classifyTrend(pr) };
    });
  }, [groups, perf]);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) c.set(r.label, (c.get(r.label) ?? 0) + 1);
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const out = rows.filter((r) => filter === "all" || r.label === filter);
    out.sort((a, b) =>
      sort === "label"
        ? TREND_META[a.label].order - TREND_META[b.label].order || (b.pr.w + b.pr.m + b.pr.q) - (a.pr.w + a.pr.m + a.pr.q)
        : b.v[sort] - a.v[sort]);
    return out;
  }, [rows, filter, sort]);

  const scales = useMemo(() => {
    const s = {} as Record<Key, number>;
    for (const c of COLS) s[c.key] = niceMax(Math.max(0, ...rows.map((r) => Math.abs(r.v[c.key]))));
    return s;
  }, [rows]);

  const fmt = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(1)}%`;
  const headline = useMemo(() => {
    const pick = (l: TrendLabel) => rows.filter((r) => r.label === l).sort((a, b) => b.v.m - a.v.m).slice(0, 3).map((r) => r.name);
    return { consistent: pick("consistent"), fresh: pick("new"), fading: pick("fading") };
  }, [rows]);

  return (
    <div className="min-w-0 rounded-xl border border-border bg-card px-4 py-3.5">
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <h2 className="text-[15px] font-semibold" style={{ fontFamily: "Syne, sans-serif" }}>{title}</h2>
        <span className="font-mono text-[11px] text-muted-foreground">{status}</span>
        <div className="ml-auto max-w-full overflow-x-auto">{switcher}</div>
      </div>

      {!rows.length ? (
        <div className="py-10 text-center text-sm text-muted-foreground">{perf ? "Not enough data in the last Full Scan." : "No Full Scan data yet — press Full Scan."}</div>
      ) : (
        <>
          {/* Headline: the three things worth knowing */}
          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3 [&>*]:min-w-0">
            {([
              ["consistent", headline.consistent, "Leading on every timeframe"],
              ["new", headline.fresh, "Newly leading (rotation in)"],
              ["fading", headline.fading, "Losing steam (rotation out)"],
            ] as [TrendLabel, string[], string][]).map(([k, names, cap]) => (
              <button
                key={k}
                onClick={() => setFilter(filter === k ? "all" : k)}
                className={`rounded-lg border px-3 py-2 text-left transition hover:brightness-110 ${TREND_META[k].cls} ${filter === k ? "ring-1 ring-current" : ""}`}
              >
                <div className="text-[10.5px] uppercase tracking-wide opacity-80">{cap}</div>
                <div className="mt-0.5 truncate text-[13px] font-semibold text-foreground">{names.length ? names.join(" · ") : "—"}</div>
              </button>
            ))}
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-1">
            {FILTERS.map((f) => {
              const n = f === "all" ? rows.length : counts.get(f) ?? 0;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  disabled={!n}
                  title={f === "all" ? undefined : TREND_META[f].tip}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] disabled:opacity-35 ${filter === f ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {f === "all" ? "All" : TREND_META[f].text} <span className="font-mono opacity-70">{n}</span>
                </button>
              );
            })}
          </div>

          <div className="-mx-1 overflow-x-auto px-1"><div className="min-w-[540px]">
          <div className="grid grid-cols-[minmax(110px,1fr)_repeat(3,minmax(64px,1.1fr))_auto] items-center gap-x-3 border-b border-border px-1 pb-1 font-mono text-[10px] text-muted-foreground sm:grid-cols-[200px_repeat(3,1fr)_140px]">
            <button onClick={() => setSort("label")} className={`text-left ${sort === "label" ? "text-primary" : ""}`}>Group{sort === "label" ? " ▾" : ""}</button>
            {COLS.map((c) => (
              <button key={c.key} onClick={() => setSort(c.key)} className={`text-center ${sort === c.key ? "text-primary" : ""}`} title={`Sort by ${c.label} · scale ±${scales[c.key]}%`}>
                {c.label}{sort === c.key ? " ▾" : ""}
              </button>
            ))}
            <span className="text-right">Pattern</span>
          </div>

          <div className="divide-y divide-border/30">
            {shown.map((r) => (
              <button
                key={r.name}
                onClick={() => onOpen(r.theme)}
                className="grid w-full grid-cols-[minmax(110px,1fr)_repeat(3,minmax(64px,1.1fr))_auto] items-center gap-x-3 px-1 py-1.5 text-left hover:bg-accent/40 sm:grid-cols-[200px_repeat(3,1fr)_140px]"
                title={`${r.name} — ${r.n} stocks · click to open`}
              >
                <span className="truncate text-xs font-medium">{r.name} <span className="font-normal text-muted-foreground">({r.n})</span></span>
                {COLS.map((c) => <MiniBar key={c.key} v={r.v[c.key]} scale={scales[c.key]} top={r.pr[c.key] >= 2 / 3} bottom={r.pr[c.key] <= 1 / 3} fmt={fmt} />)}
                <span className="flex justify-end">
                  <span title={TREND_META[r.label].tip} className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${TREND_META[r.label].cls}`}>{TREND_META[r.label].text}</span>
                </span>
              </button>
            ))}
          </div>
          </div></div>
        </>
      )}

      <div className="mt-3 rounded-r-lg border-l-2 border-primary bg-primary/5 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
        Each bar is the group's average move over that timeframe (from the last Full Scan{universe ? ", whole stock list" : ""}); a brighter bar means the group
        ranks in the top third of all groups on it. Leadership that holds on all three timeframes is the most reliable;
        <b className="text-foreground/90"> new leaders</b> are where rotation is flowing now, and <b className="text-foreground/90">losing steam</b> flags former leaders being sold. Click a row to open its stocks.
      </div>
    </div>
  );
}

function MiniBar({ v, scale, top, bottom, fmt }: { v: number; scale: number; top: boolean; bottom: boolean; fmt: (x: number) => string }) {
  const w = Math.min(50, (Math.abs(v) / scale) * 50);
  const pos = v >= 0;
  const color = pos ? "166, 100%, 42%" : "344, 100%, 65%";
  const alpha = top || bottom ? 1 : 0.45;
  return (
    <span className="flex items-center gap-1.5">
      <span className="relative h-2.5 flex-1 rounded-[3px] bg-muted/40">
        <span className="absolute -bottom-[2px] -top-[2px] left-1/2 w-px bg-border" />
        <span
          className="absolute bottom-0 top-0 rounded-[3px]"
          style={pos ? { left: "50%", width: `${w}%`, background: `hsla(${color}, ${alpha})` } : { right: "50%", width: `${w}%`, background: `hsla(${color}, ${alpha})` }}
        />
      </span>
      <span className={`hidden w-12 text-right font-mono text-[10.5px] sm:inline ${pos ? "text-[hsl(166,100%,42%)]" : "text-[hsl(344,100%,65%)]"}`}>{fmt(v)}</span>
    </span>
  );
}
