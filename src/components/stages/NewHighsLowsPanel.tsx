import { useMemo, useState } from "react";
import type { StockStage } from "@/lib/stageAnalysis";

/**
 * New 52-week highs and lows, by group — from each stock's weekly breadth flags
 * (bit 2 = new 52-week high that week, bit 3 = new 52-week low). Shows where leadership
 * (highs) and liquidation (lows) are concentrated, and a groups-on-both-sides read for chop.
 */

const HI = "hsl(152, 60%, 48%)";
const LO = "hsl(344, 75%, 62%)";

const bitsAt = (r: StockStage, ago: number) => {
  const f = r.features?.flags ?? "";
  const ch = f[f.length - 1 - ago];
  const b = ch ? parseInt(ch, 32) : NaN;
  return Number.isFinite(b) ? b : 0;
};

interface G { name: string; highs: StockStage[]; lows: StockStage[]; n: number }

export default function NewHighsLowsPanel({ stocks, groupsOf, modeLabel, onOpen }: {
  stocks: StockStage[];               // aligned to the latest week
  groupsOf: (sym: string) => string[];
  modeLabel: string;
  onOpen: (title: string, rows: StockStage[]) => void;
}) {
  const [win, setWin] = useState<1 | 4>(1);
  const [all, setAll] = useState(false);

  const { groups, totHi, totLo } = useMemo(() => {
    const m = new Map<string, G>();
    let totHi = 0, totLo = 0;
    for (const r of stocks) {
      // the most recent week in the window with a new high or low decides (a stock counts on one side only)
      let hi = false, lo = false;
      for (let ago = 0; ago < win; ago++) {
        const b = bitsAt(r, ago);
        if (b & 4) { hi = true; break; }
        if (b & 8) { lo = true; break; }
      }
      if (hi) totHi++; if (lo) totLo++;
      for (const g of groupsOf(r.symbol)) {
        const e = m.get(g) ?? { name: g, highs: [], lows: [], n: 0 };
        e.n++;
        if (hi) e.highs.push(r);
        if (lo) e.lows.push(r);
        m.set(g, e);
      }
    }
    const groups = [...m.values()].filter((g) => g.highs.length + g.lows.length > 0)
      .sort((a, b) => (b.highs.length - b.lows.length) - (a.highs.length - a.lows.length) || b.highs.length - a.highs.length);
    return { groups, totHi, totLo };
  }, [stocks, groupsOf, win]);

  // Market new highs vs lows per week (last 26 weeks)
  const hist = useMemo(() => {
    const out: { hi: number; lo: number }[] = [];
    for (let ago = 25; ago >= 0; ago--) {
      let hi = 0, lo = 0;
      for (const r of stocks) { const b = bitsAt(r, ago); if (b & 4) hi++; if (b & 8) lo++; }
      out.push({ hi, lo });
    }
    return out;
  }, [stocks]);

  const both = groups.filter((g) => g.highs.length >= 2 && g.lows.length >= 2);
  const topHi = [...groups].sort((a, b) => b.highs.length - a.highs.length).slice(0, 3).filter((g) => g.highs.length);
  const shown = all ? groups : [...groups.slice(0, 8), ...groups.slice(8).filter((g) => g.lows.length > g.highs.length).slice(-4)];
  const shownUnique = [...new Map(shown.map((g) => [g.name, g])).values()];
  const maxN = Math.max(1, ...shownUnique.map((g) => Math.max(g.highs.length, g.lows.length)));
  const hmax = Math.max(1, ...hist.map((h) => Math.max(h.hi, h.lo)));
  const sortTicks = (rows: StockStage[]) => [...rows].sort((a, b) => (b.features?.mrs52 ?? -99) - (a.features?.mrs52 ?? -99));

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">New highs &amp; lows</h2>
        <span className="text-[11px] text-muted-foreground">· 52-week, by {modeLabel.toLowerCase()}</span>
        <div className="ml-auto inline-flex rounded-md border border-border bg-muted/20 p-0.5">
          {([1, 4] as const).map((w) => (
            <button key={w} onClick={() => setWin(w)} className={`rounded px-2 py-0.5 text-[10px] ${win === w ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {w === 1 ? "last week" : "last 4 weeks"}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 grid grid-cols-[auto_1fr] items-end gap-4">
        <div className="space-y-1">
          <button onClick={() => onOpen(`New 52-week highs (${win === 1 ? "last week" : "last 4 weeks"})`, sortTicks(stocks.filter((r) => groups.some((g) => g.highs.includes(r)))))} className="block text-left">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">New highs</div>
            <div className="font-mono text-xl font-semibold" style={{ color: HI }}>{totHi}</div>
          </button>
          <button onClick={() => onOpen(`New 52-week lows (${win === 1 ? "last week" : "last 4 weeks"})`, stocks.filter((r) => groups.some((g) => g.lows.includes(r))))} className="block text-left">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">New lows</div>
            <div className="font-mono text-xl font-semibold" style={{ color: LO }}>{totLo}</div>
          </button>
        </div>
        <div>
          <svg viewBox="0 0 260 60" preserveAspectRatio="none" className="h-[60px] w-full" aria-label="New highs (up) and new lows (down) per week, last 26 weeks">
            <line x1={0} x2={260} y1={30} y2={30} stroke="hsl(var(--border))" strokeWidth={0.6} />
            {hist.map((h, i) => (
              <g key={i}>
                <rect x={i * 10 + 1} width={8} y={30 - (h.hi / hmax) * 28} height={(h.hi / hmax) * 28} fill={HI} opacity={i === hist.length - 1 ? 1 : 0.55}><title>{`${hist.length - 1 - i}w ago: ${h.hi} highs / ${h.lo} lows`}</title></rect>
                <rect x={i * 10 + 1} width={8} y={30} height={(h.lo / hmax) * 28} fill={LO} opacity={i === hist.length - 1 ? 1 : 0.55}><title>{`${hist.length - 1 - i}w ago: ${h.hi} highs / ${h.lo} lows`}</title></rect>
              </g>
            ))}
          </svg>
          <div className="flex justify-between text-[10px] text-muted-foreground"><span>26 weeks ago</span><span>highs ▲ · lows ▼ per week</span><span>last week</span></div>
        </div>
      </div>

      {!groups.length ? (
        <p className="py-4 text-center text-xs text-muted-foreground">No new 52-week highs or lows in this window.</p>
      ) : (
        <>
          <div className="mb-1 grid grid-cols-[1fr_minmax(150px,1.3fr)] gap-3 px-1 text-[10px] text-muted-foreground">
            <span>Group</span>
            <span className="flex justify-between"><span style={{ color: LO }}>◀ lows</span><span style={{ color: HI }}>highs ▶</span></span>
          </div>
          <div className="space-y-0.5">
            {shownUnique.map((g) => (
              <div key={g.name} className="grid grid-cols-[1fr_minmax(150px,1.3fr)] items-center gap-3 rounded px-1 py-[3px] hover:bg-accent/30">
                <span className="truncate text-xs" title={`${g.name}: ${g.highs.length} new highs · ${g.lows.length} new lows · ${g.n} stocks`}>
                  {g.name} <span className="text-muted-foreground">({g.n})</span>
                </span>
                <span className="grid grid-cols-2 items-center">
                  <button className="flex justify-end" disabled={!g.lows.length} onClick={() => onOpen(`${g.name} — new lows`, g.lows)}>
                    {g.lows.length > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="font-mono text-[10px]" style={{ color: LO }}>{g.lows.length}</span>
                        <span className="h-2.5 rounded-l-sm" style={{ width: `${Math.max(4, (g.lows.length / maxN) * 70)}px`, background: LO }} />
                      </span>
                    )}
                  </button>
                  <button className="flex justify-start border-l border-border" disabled={!g.highs.length} onClick={() => onOpen(`${g.name} — new highs`, sortTicks(g.highs))}>
                    {g.highs.length > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="h-2.5 rounded-r-sm" style={{ width: `${Math.max(4, (g.highs.length / maxN) * 70)}px`, background: HI }} />
                        <span className="font-mono text-[10px]" style={{ color: HI }}>{g.highs.length}</span>
                      </span>
                    )}
                  </button>
                </span>
              </div>
            ))}
          </div>
          {groups.length > shownUnique.length && (
            <button onClick={() => setAll(true)} className="mt-1 text-[11px] text-primary hover:underline">Show all {groups.length} groups</button>
          )}
          {all && groups.length > 12 && (
            <button onClick={() => setAll(false)} className="mt-1 text-[11px] text-muted-foreground hover:underline">Show fewer</button>
          )}
        </>
      )}

      <p className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground">
        {topHi.length ? <>Most new highs: <b className="text-foreground/90">{topHi.map((g) => `${g.name} (${g.highs.length})`).join(", ")}</b>. </> : null}
        {both.length ? <>{both.slice(0, 3).map((g) => g.name).join(", ")} {both.length === 1 ? "has" : "have"} names on both sides — a sign of a choppy, rotational group. </> : null}
        Weekly closes; a stock counts when that week's high cleared its prior 52-week high (or its low broke the 52-week low). Click a bar for the stocks.
      </p>
    </section>
  );
}
