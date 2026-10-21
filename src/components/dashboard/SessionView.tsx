import { useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { ThemeData, Ticker } from "@/data/themeData";
import { GROUP_MODE_LABEL, groupKeyForIndustry, type GroupMode } from "@/lib/groupColors";
import { Segmented } from "@/components/Explainer";
import { marketClock, useLiveSession, type SessionQuote } from "@/hooks/useLiveSession";

/**
 * Gap vs Session — splits each group's move today into the overnight gap (yesterday's close →
 * today's open) and the move during trading hours (open → now). Where the two disagree is where
 * the session changed the story: gaps that got bought or sold, and groups that reversed.
 */

type Pattern = "go" | "fade" | "bought" | "sold" | "flatUp" | "flatDown";
const EPS = 0.15; // % — smaller moves count as flat

const PATTERN: Record<Pattern, { label: string; tip: string; color: string }> = {
  go: { label: "Gap up, kept going", tip: "Opened higher and kept rising during the session — buyers followed through.", color: "hsl(166, 85%, 45%)" },
  bought: { label: "Gap down, bought", tip: "Opened lower but rose during the session — buyers stepped in.", color: "hsl(200, 85%, 62%)" },
  fade: { label: "Gap up, faded", tip: "Opened higher but sold off during the session — the gap got sold.", color: "hsl(35, 90%, 58%)" },
  sold: { label: "Gap down, sold more", tip: "Opened lower and kept falling — selling all day.", color: "hsl(344, 85%, 62%)" },
  flatUp: { label: "No gap, rose", tip: "Opened about flat and rose during the session.", color: "hsl(166, 50%, 55%)" },
  flatDown: { label: "No gap, fell", tip: "Opened about flat and fell during the session.", color: "hsl(344, 50%, 65%)" },
};
const patternOf = (gap: number, open: number): Pattern => {
  if (Math.abs(gap) < EPS) return open >= 0 ? "flatUp" : "flatDown";
  if (gap > 0) return open >= 0 ? "go" : "fade";
  return open >= 0 ? "bought" : "sold";
};

interface Row { name: string; gap: number; open: number; today: number; n: number; up: number; pattern: Pattern; theme: ThemeData }
type SortKey = "turn" | "session" | "gap" | "today";
const SORTS: { value: SortKey; label: string; title: string }[] = [
  { value: "turn", label: "Biggest turnarounds", title: "Session move against the gap, largest first" },
  { value: "session", label: "Session", title: "Change since the open" },
  { value: "gap", label: "Gap", title: "Overnight gap, largest either way" },
  { value: "today", label: "Today", title: "Change from yesterday's close" },
];
const fmt = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(2)}%`;
const tone = (x: number) => (x > 0.05 ? "text-[hsl(166,100%,42%)]" : x < -0.05 ? "text-[hsl(344,100%,65%)]" : "text-muted-foreground");

export default function SessionView({ groupMode, baseThemes, industryBySymbol, onOpen }: {
  groupMode: GroupMode;
  baseThemes: ThemeData[];
  industryBySymbol: Map<string, string | null>;
  onOpen: (t: ThemeData) => void;
}) {
  const { live, loading, error, refresh } = useLiveSession(true);
  const [display, setDisplay] = useState<"map" | "list">("map");
  const [sort, setSort] = useState<SortKey>("turn");
  const [only, setOnly] = useState<Pattern | null>(null);

  const rows = useMemo(() => {
    if (!live) return [] as Row[];
    const groups = new Map<string, { symbol: string; name?: string | null }[]>();
    const add = (k: string, m: { symbol: string; name?: string | null }) => {
      const a = groups.get(k) ?? [];
      if (!a.some((x) => x.symbol === m.symbol)) a.push(m);
      groups.set(k, a);
    };
    const seen = new Set<string>();
    for (const t of baseThemes) for (const tk of t.tickers) {
      const s = tk.symbol.toUpperCase();
      if (groupMode === "theme") add(t.theme_name, { symbol: s, name: tk.name });
      else if (!seen.has(s)) { seen.add(s); add(groupKeyForIndustry(industryBySymbol.get(s) ?? null, groupMode), { symbol: s, name: tk.name }); }
    }
    const out: Row[] = [];
    groups.forEach((members, name) => {
      const q = members.map((m) => ({ m, q: live.map.get(m.symbol) })).filter((x): x is { m: typeof x.m; q: SessionQuote } => !!x.q);
      if (!q.length) return;
      const avg = (k: keyof SessionQuote) => q.reduce((s, x) => s + x.q[k], 0) / q.length;
      const gap = avg("gap"), open = avg("open"), today = avg("today");
      const tickers: Ticker[] = q.map((x) => ({ symbol: x.m.symbol, name: x.m.name ?? undefined, pct: x.q.open })).sort((a, b) => b.pct - a.pct);
      out.push({
        name, gap, open, today, n: q.length, up: q.filter((x) => x.q.open > 0).length, pattern: patternOf(gap, open),
        theme: { theme_name: `${name} — since open`, performance_pct: Math.round(open * 100) / 100, up_count: tickers.filter((t) => t.pct > 0).length, down_count: tickers.filter((t) => t.pct <= 0).length, na_count: members.length - q.length, valid_count: q.length, tickers, dataSource: "real" },
      });
    });
    return out;
  }, [live, baseThemes, groupMode, industryBySymbol]);

  const turnScore = (r: Row) => (Math.abs(r.gap) < EPS || Math.abs(r.open) < EPS ? 0 : Math.sign(r.gap) !== Math.sign(r.open) ? Math.abs(r.open) : 0);
  const sorted = useMemo(() => {
    const f = only ? rows.filter((r) => r.pattern === only) : rows;
    const key = (r: Row) => (sort === "turn" ? turnScore(r) * 1000 + Math.abs(r.open - r.gap) : sort === "session" ? r.open : sort === "gap" ? Math.abs(r.gap) : r.today);
    return [...f].sort((a, b) => key(b) - key(a));
  }, [rows, sort, only]);

  const counts = useMemo(() => {
    const m = new Map<Pattern, Row[]>();
    for (const r of rows) m.set(r.pattern, [...(m.get(r.pattern) ?? []), r]);
    m.forEach((v) => v.sort((a, b) => Math.abs(b.open) - Math.abs(a.open)));
    return m;
  }, [rows]);

  const clock = marketClock();
  const status = live
    ? `live · ${new Date(live.fetchedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" })} ET · ${clock.open ? `${clock.sinceOpen} min since open · refreshes every 5 min` : "market closed — last session"}`
    : loading ? "fetching live quotes…" : "";

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5">
      <div className="mb-3 flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold tracking-tight">
            {GROUP_MODE_LABEL[groupMode]} — gap vs session
            <button onClick={refresh} disabled={loading} title="Refresh live quotes" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            </button>
          </h2>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">Today's move split into the overnight gap and the move during trading hours. <span className="font-mono">{status}</span></p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<"map" | "list"> size="xs" value={display} onChange={setDisplay} options={[{ value: "map", label: "Map" }, { value: "list", label: "List" }]} />
        </div>
      </div>

      {!rows.length ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          {loading ? "Fetching live quotes…" : error === "no_open" ? "No opening prices came back yet — try again in a minute." : error ? `Couldn't fetch live quotes: ${error}` : "No live data yet."}
        </div>
      ) : (
        <>
          {/* Four outcomes of the session */}
          <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {(["go", "bought", "fade", "sold"] as Pattern[]).map((p) => {
              const list = counts.get(p) ?? [];
              const on = only === p;
              return (
                <button key={p} onClick={() => { setOnly(on ? null : p); if (display === "map") setDisplay("list"); }} title={PATTERN[p].tip} aria-pressed={on}
                  className={`min-w-0 rounded-lg border px-3 py-2 text-left transition-colors ${on ? "border-primary/70 bg-primary/10" : "border-border bg-background/40 hover:bg-accent/30"}`}>
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate text-xs font-medium"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PATTERN[p].color }} />{PATTERN[p].label}</span>
                    <span className="font-mono text-lg font-semibold tabular-nums">{list.length}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">{list.slice(0, 3).map((r) => r.name).join(" · ") || "none"}</span>
                </button>
              );
            })}
          </div>

          {display === "map" ? <SessionMap rows={rows} onOpen={(r) => onOpen(r.theme)} /> : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Segmented<SortKey> size="xs" value={sort} onChange={setSort} options={SORTS} />
                {only && <button onClick={() => setOnly(null)} className="rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">{PATTERN[only].label} ✕</button>}
                <span className="ml-auto text-[11px] text-muted-foreground">{sorted.length} groups</span>
              </div>
              <div className="overflow-x-auto">
                <div className="min-w-[560px]">
                  <div className="grid grid-cols-[minmax(130px,1.4fr)_92px_70px_70px_70px_minmax(120px,1fr)] items-center gap-x-3 border-b border-border px-1 pb-1 text-[10.5px] text-muted-foreground">
                    <span>Group</span><span title="Yesterday's close → open → now">Path</span>
                    <span className="text-right">Gap</span><span className="text-right">Session</span><span className="text-right">Today</span><span>What happened</span>
                  </div>
                  {sorted.map((r) => (
                    <button key={r.name} onClick={() => onOpen(r.theme)} title={`${r.name}: ${r.n} stocks with live quotes, ${r.up} up since the open — click for the stocks`}
                      className="grid w-full grid-cols-[minmax(130px,1.4fr)_92px_70px_70px_70px_minmax(120px,1fr)] items-center gap-x-3 border-b border-border/30 px-1 py-1.5 text-left hover:bg-accent/40">
                      <span className="truncate text-xs font-medium">{r.name} <span className="font-normal text-muted-foreground">({r.n})</span></span>
                      <Path gap={r.gap} today={r.today} />
                      <span className={`text-right font-mono text-xs tabular-nums ${tone(r.gap)}`}>{fmt(r.gap)}</span>
                      <span className={`text-right font-mono text-xs font-semibold tabular-nums ${tone(r.open)}`}>{fmt(r.open)}</span>
                      <span className={`text-right font-mono text-xs tabular-nums ${tone(r.today)}`}>{fmt(r.today)}</span>
                      <span className="flex items-center gap-1.5 truncate text-[11px]" title={PATTERN[r.pattern].tip}><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PATTERN[r.pattern].color }} />{PATTERN[r.pattern].label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      <div className="mt-3 rounded-r-lg border-l-2 border-primary bg-primary/5 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
        <b className="text-foreground/90">Gap</b> = yesterday's close to today's open (news and pre-market). <b className="text-foreground/90">Session</b> = open to now — what buyers and sellers did during trading hours.
        <b className="text-foreground/90"> Today</b> = both together. A gap that keeps going shows follow-through; a gap that fades, or a gap down that gets bought, is where the session changed the story.
        {groupMode !== "theme" && " Live quotes exist for your theme tickers only, so these groups contain those stocks."}
      </div>
    </div>
  );
}

/** Tiny path: yesterday's close (0) → open (gap) → now (today). */
function Path({ gap, today }: { gap: number; today: number }) {
  const W = 92, H = 22, lim = Math.max(0.5, Math.abs(gap), Math.abs(today));
  const y = (v: number) => H / 2 - (v / lim) * (H / 2 - 2);
  const pts = [[4, y(0)], [W / 2, y(gap)], [W - 4, y(today)]];
  const up = today - gap >= 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[22px] w-[92px]" aria-hidden>
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="hsl(var(--border))" strokeDasharray="2 2" />
      <line x1={pts[0][0]} y1={pts[0][1]} x2={pts[1][0]} y2={pts[1][1]} stroke="hsl(var(--muted-foreground))" strokeWidth={1.2} strokeDasharray="3 2" />
      <line x1={pts[1][0]} y1={pts[1][1]} x2={pts[2][0]} y2={pts[2][1]} stroke={up ? "hsl(166, 100%, 42%)" : "hsl(344, 100%, 65%)"} strokeWidth={2} />
      {pts.map(([x, yy], i) => <circle key={i} cx={x} cy={yy} r={i === 2 ? 2.4 : 1.6} fill={i === 2 ? (up ? "hsl(166, 100%, 42%)" : "hsl(344, 100%, 65%)") : "hsl(var(--muted-foreground))"} />)}
    </svg>
  );
}

/** Quadrant map: x = overnight gap, y = session move. Dot size = stocks in the group. */
function SessionMap({ rows, onOpen }: { rows: Row[]; onOpen: (r: Row) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const W = 1000, H = 520, P = 44;
  const lim = (k: "gap" | "open") => { const m = Math.max(0.5, ...rows.map((r) => Math.abs(r[k]))); return Math.ceil(m * 1.1 * 4) / 4; };
  const lx = lim("gap"), ly = lim("open");
  const x = (v: number) => P + ((v + lx) / (2 * lx)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v + ly) / (2 * ly)) * (H - 2 * P);
  const maxN = Math.max(1, ...rows.map((r) => r.n));
  // label the groups furthest from the center so the map stays readable
  // Label the groups furthest from the center first, skipping any label that would overlap one already placed.
  const labels = new Map<string, { x: number; y: number; anchor: "start" | "end" }>();
  {
    const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const order = [...rows].sort((a, b) => Math.hypot(b.gap / lx, b.open / ly) - Math.hypot(a.gap / lx, a.open / ly));
    for (const r of order) {
      if (labels.size >= 16) break;
      const rr = 4 + Math.sqrt(r.n / maxN) * 10, cx = x(r.gap), cy = y(r.open), w = r.name.length * 6.6;
      const anchor = cx > W * 0.72 ? "end" : "start";
      const lx0 = anchor === "start" ? cx + rr + 4 : cx - rr - 4 - w, box = { x0: lx0, x1: lx0 + w, y0: cy - 10, y1: cy + 6 };
      if (boxes.some((b) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) continue;
      boxes.push(box);
      labels.set(r.name, { x: anchor === "start" ? cx + rr + 4 : cx - rr - 4, y: cy + 4, anchor });
    }
  }
  const quad = [
    { x: W / 2, y: P, w: W / 2 - P, h: H / 2 - P, p: "go" as Pattern, tx: W - P - 8, ty: P + 16, anchor: "end" },
    { x: P, y: P, w: W / 2 - P, h: H / 2 - P, p: "bought" as Pattern, tx: P + 8, ty: P + 16, anchor: "start" },
    { x: W / 2, y: H / 2, w: W / 2 - P, h: H / 2 - P, p: "fade" as Pattern, tx: W - P - 8, ty: H - P - 8, anchor: "end" },
    { x: P, y: H / 2, w: W / 2 - P, h: H / 2 - P, p: "sold" as Pattern, tx: P + 8, ty: H - P - 8, anchor: "start" },
  ];
  const hv = rows.find((r) => r.name === hover);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Groups by overnight gap and session move">
        {quad.map((q) => (
          <g key={q.p}>
            <rect x={q.x} y={q.y} width={q.w} height={q.h} fill={PATTERN[q.p].color} opacity={0.05} />
            <text x={q.tx} y={q.ty} textAnchor={q.anchor as "start" | "end"} fontSize={13} fill={PATTERN[q.p].color} opacity={0.85}>{PATTERN[q.p].label}</text>
          </g>
        ))}
        <line x1={x(0)} x2={x(0)} y1={P} y2={H - P} stroke="hsl(var(--border))" />
        <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="hsl(var(--border))" />
        <text x={W - P} y={y(0) - 6} textAnchor="end" fontSize={11} fill="hsl(var(--muted-foreground))">gap +{lx}% →</text>
        <text x={P} y={y(0) - 6} fontSize={11} fill="hsl(var(--muted-foreground))">← gap −{lx}%</text>
        <text x={x(0) + 6} y={P - 10} fontSize={11} fill="hsl(var(--muted-foreground))">session +{ly}%</text>
        <text x={x(0) + 6} y={H - P + 18} fontSize={11} fill="hsl(var(--muted-foreground))">session −{ly}%</text>
        {rows.map((r) => {
          const rr = 4 + Math.sqrt(r.n / maxN) * 10;
          const on = hover === r.name;
          return (
            <g key={r.name} className="cursor-pointer" onMouseEnter={() => setHover(r.name)} onMouseLeave={() => setHover(null)} onClick={() => onOpen(r)}>
              <circle cx={x(r.gap)} cy={y(r.open)} r={rr} fill={PATTERN[r.pattern].color} fillOpacity={on ? 0.95 : 0.6} stroke={on ? "white" : "hsl(var(--background))"} strokeWidth={on ? 2 : 1} />
              {(labels.has(r.name) || on) && (
                <text x={labels.get(r.name)?.x ?? x(r.gap) + rr + 4} y={y(r.open) + 4} textAnchor={labels.get(r.name)?.anchor ?? "start"} fontSize={12} fill="hsl(var(--foreground))" opacity={on ? 1 : 0.85} style={{ paintOrder: "stroke" }} stroke="hsl(var(--card))" strokeWidth={3}>{r.name}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hv && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-border bg-background/95 px-2.5 py-1.5 text-[11px] shadow">
          <div className="font-medium">{hv.name} <span className="text-muted-foreground">({hv.n})</span></div>
          <div className="font-mono">gap {fmt(hv.gap)} · session {fmt(hv.open)} · today {fmt(hv.today)}</div>
          <div style={{ color: PATTERN[hv.pattern].color }}>{PATTERN[hv.pattern].label}</div>
        </div>
      )}
      <p className="mt-1 text-[10.5px] text-muted-foreground">Dot size = stocks with live quotes. Click a dot for its stocks, or a card above for the list.</p>
    </div>
  );
}
