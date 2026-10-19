import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Copy, Download, Info } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StageBadge, StageChartPanel, WeekSpark } from "@/components/stages/StageStockTable";
import { downloadTradingViewList, stageWeeksAgo, type StockStage } from "@/lib/stageAnalysis";
import { STATE_NAMES, type StockBase } from "@/lib/bases";
import { PickCard, SectionHead } from "@/components/Explainer";

/**
 * Ready-made screens over the whole stock list (Deepvue-style presets), built from the weekly
 * stage scan plus its daily snapshot (features.dly) and earnings snapshot (features.ern).
 * Each screen is sorted by 1-month relative strength — the leaders of the move first.
 */

type ScreenKey = "accel" | "ema21" | "tight" | "character" | "ipo";

interface Ctx {
  rs1m: Map<string, number>;   // 1–99, 4-week return vs the list
  rs6: Map<string, number>;    // 1–99, Mansfield RS (52w) rank
  r3m: (r: StockStage) => number | null;
}

interface Screen {
  key: ScreenKey;
  title: string;
  blurb: string;
  rules: string[];
  needs?: "dly" | "ern";
  match: (r: StockStage, c: Ctx) => boolean;
  cols: { label: string; tip: string; cell: (r: StockStage) => ReactNode; sort?: (r: StockStage) => number }[];
}

const pct = (x: number | null | undefined, d = 1, plus = true) =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : `${plus && x > 0 ? "+" : ""}${x.toFixed(d)}%`;
const lastBits = (r: StockStage, ago = 0) => {
  const f = r.features?.flags ?? "";
  const ch = f[f.length - 1 - ago];
  return ch ? parseInt(ch, 32) : 0;
};
const weeksListed = (r: StockStage) => (r.features?.flags ?? "").length;
const tone = (x: number | null | undefined, good: number, bad: number) =>
  x === null || x === undefined ? "" : x >= good ? "text-gain-medium" : x <= bad ? "text-loss-medium" : "";

/** Three weekly closes within 1.5% of each other (O'Neil's "3 weeks tight") — the weekly fallback. */
const threeWeeksTight = (r: StockStage) => {
  const c = r.features?.wc ?? [];
  if (c.length < 3) return false;
  const l = c.slice(-3);
  return (Math.max(...l) - Math.min(...l)) / Math.min(...l) <= 0.015;
};
const wasStage4Within = (r: StockStage, weeks: number) => {
  for (let ago = 1; ago <= weeks; ago++) if (stageWeeksAgo(r, ago) === 4) return true;
  return false;
};

const SCREENS: Screen[] = [
  {
    key: "accel", title: "Accelerating earnings", needs: "ern",
    blurb: "Earnings growing faster than last year, with revenue behind it — the fuel behind emerging leaders.",
    rules: [
      "Latest quarter EPS up ≥ 25% vs a year ago, and faster than last fiscal year's EPS growth",
      "Latest quarter revenue up ≥ 15% vs a year ago",
      "Stage 1 or 2 (not topping or declining)",
      "In this app's backtest, accelerating earnings was the fundamental signal that held up best (see the Minervini tab).",
    ],
    match: (r) => !!r.features?.ern?.accel && (r.stage === 1 || r.stage === 2),
    cols: [
      { label: "EPS q/q-yr", tip: "Latest quarter EPS vs the same quarter a year ago", cell: (r) => <span className="text-gain-medium">{pct(r.features?.ern?.epsYoY, 0)}</span>, sort: (r) => r.features?.ern?.epsYoY ?? -999 },
      { label: "vs last FY", tip: "Last fiscal year's EPS growth — the quarter should beat it", cell: (r) => pct(r.features?.ern?.fyEps, 0), sort: (r) => r.features?.ern?.fyEps ?? -999 },
      { label: "Revenue", tip: "Latest quarter revenue vs a year ago · ▲ when sequential growth sped up vs the quarter before", cell: (r) => {
        const e = r.features?.ern;
        const up = e?.revQoQ != null && e?.revQoQPrev != null && e.revQoQ > e.revQoQPrev;
        return <>{pct(e?.revYoY, 0)}{up && <span className="ml-1 text-gain-medium" title={`Sequential: ${pct(e?.revQoQPrev)} → ${pct(e?.revQoQ)}`}>▲</span>}</>;
      }, sort: (r) => r.features?.ern?.revYoY ?? -999 },
    ],
  },
  {
    key: "ema21", title: "21-day EMA pullback", needs: "dly",
    blurb: "Strong Stage 2 stocks pulling back to their 21-day average — a common low-risk entry in a trend.",
    rules: [
      "Stage 2, relative strength rank ≥ 70",
      "Close within 2% of the 21-day EMA (above or below)",
      "Above the 50-day average and up over 3 months",
    ],
    match: (r, c) => {
      const d = r.features?.dly;
      return r.stage === 2 && (c.rs6.get(r.symbol) ?? 0) >= 70 && !!d && Math.abs(d.ema21Pct) <= 2 && (d.sma50Pct ?? -1) > 0 && (c.r3m(r) ?? -1) > 0;
    },
    cols: [
      { label: "vs 21 EMA", tip: "Close vs the 21-day EMA", cell: (r) => pct(r.features?.dly?.ema21Pct), sort: (r) => -Math.abs(r.features?.dly?.ema21Pct ?? 99) },
      { label: "vs 50 SMA", tip: "Close vs the 50-day average", cell: (r) => pct(r.features?.dly?.sma50Pct), sort: (r) => r.features?.dly?.sma50Pct ?? -999 },
      { label: "ADR", tip: "Average daily range, 20 days — your normal daily swing (size the stop around it)", cell: (r) => pct(r.features?.dly?.adrPct, 1, false), sort: (r) => r.features?.dly?.adrPct ?? 0 },
    ],
  },
  {
    key: "tight", title: "Tight range",
    blurb: "Leaders coiling in a narrow range near their highs — the quiet before a move.",
    rules: [
      "Stage 2 (or late-base 1B), relative strength rank ≥ 70, within 15% of the 52-week high",
      "Last 10 sessions' range ≤ 2.2× the average daily range (daily data) — or 3 weekly closes within 1.5% when daily data is missing",
    ],
    match: (r, c) => {
      if (!(r.stage === 2 || r.substage === "1B") || (c.rs6.get(r.symbol) ?? 0) < 70 || (r.features?.pctFrom52wHigh ?? -99) < -15) return false;
      const d = r.features?.dly;
      return d ? d.tight <= 2.2 : threeWeeksTight(r);
    },
    cols: [
      { label: "10-day range", tip: "High–low range of the last 10 sessions (% of price)", cell: (r) => r.features?.dly ? pct(r.features.dly.range10Pct, 1, false) : <span className="text-muted-foreground" title="Weekly: 3 closes within 1.5%">3WT</span>, sort: (r) => -(r.features?.dly?.range10Pct ?? 99) },
      { label: "× ADR", tip: "10-day range ÷ average daily range — lower is tighter", cell: (r) => (r.features?.dly ? `${r.features.dly.tight.toFixed(1)}×` : "—"), sort: (r) => -(r.features?.dly?.tight ?? 99) },
      { label: "Volume", tip: "5-day ÷ 50-day average volume — below 1 means drying up (good inside a tight range)", cell: (r) => { const v = r.features?.dly?.vol5x50; return v == null ? "—" : <span className={v <= 0.8 ? "text-gain-medium" : ""}>{v.toFixed(2)}×</span>; }, sort: (r) => -(r.features?.dly?.vol5x50 ?? 9) },
    ],
  },
  {
    key: "character", title: "Character change",
    blurb: "Former decliners turning into new uptrends — a Stage 4 within the last 6 months, now a fresh Stage 2 with a rising RS line.",
    rules: [
      "Stage 4 at some point in the last 26 weeks",
      "Now Stage 2 after a breakout in the last 6 weeks (or 2A)",
      "Relative strength line rising over 13 weeks",
    ],
    match: (r) => r.stage === 2 && wasStage4Within(r, 26) && ((r.event_weeks_ago ?? 99) <= 6 || r.substage === "2A") && (r.features?.rpSlope13 ?? -1) > 0,
    cols: [
      { label: "Turned", tip: "Weeks since the stage change", cell: (r) => (r.event_weeks_ago === null ? "—" : r.event_weeks_ago === 0 ? "this week" : `${r.event_weeks_ago}w ago`), sort: (r) => -(r.event_weeks_ago ?? 99) },
      { label: "From low", tip: "Above its lowest weekly close of the last 40 weeks", cell: (r) => { const f = r.features; const lo = f?.wc?.length ? Math.min(...f.wc) : null; return lo && f ? pct((f.close / lo - 1) * 100, 0) : "—"; }, sort: (r) => { const f = r.features; const lo = f?.wc?.length ? Math.min(...f.wc) : null; return lo && f ? f.close / lo : 0; } },
    ],
  },
  {
    key: "ipo", title: "Recent IPOs",
    blurb: "Listed in the last 1.5 years and holding above the 10-week line — fresh charts with little overhead supply.",
    rules: [
      "Fewer than 78 weeks of trading history",
      "Close above the 10-week average",
      "Not in Stage 4",
    ],
    match: (r) => { const w = weeksListed(r); return w >= 8 && w < 78 && (lastBits(r) & 1) === 1 && r.stage !== 4; },
    cols: [
      { label: "Listed", tip: "Weeks of trading history", cell: (r) => `${weeksListed(r)}w`, sort: (r) => -weeksListed(r) },
    ],
  },
];

export default function ScreensView({ stageRows, baseBy, nameOf, groupOf }: {
  stageRows: StockStage[];
  baseBy: Map<string, StockBase>;
  nameOf: (s: string) => string | null;
  groupOf: (s: string) => string;
}) {
  const [key, setKey] = useState<ScreenKey>(() => { try { return (localStorage.getItem("bases_screen_v1") as ScreenKey) || "accel"; } catch { return "accel"; } });
  const pick = (k: ScreenKey) => { setKey(k); setOpen(null); setSortCol(null); try { localStorage.setItem("bases_screen_v1", k); } catch { /* ignore */ } };
  const [open, setOpen] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<string | null>(null);

  const stocks = useMemo(() => stageRows.filter((r) => r.symbol !== "SPY"), [stageRows]);
  const spy = useMemo(() => stageRows.find((r) => r.symbol === "SPY") ?? null, [stageRows]);

  const ctx: Ctx = useMemo(() => {
    const ret = (r: StockStage, w: number) => { const c = r.features?.wc ?? []; return c.length > w ? (c[c.length - 1] / c[c.length - 1 - w] - 1) * 100 : null; };
    const rank = (vals: { s: string; v: number | null | undefined }[]) => {
      const ok = vals.filter((x): x is { s: string; v: number } => typeof x.v === "number" && Number.isFinite(x.v)).sort((a, b) => a.v - b.v);
      const m = new Map<string, number>();
      ok.forEach((x, i) => m.set(x.s, Math.max(1, Math.min(99, Math.round(((i + 1) / ok.length) * 99)))));
      return m;
    };
    const spy4 = spy ? ret(spy, 4) ?? 0 : 0;
    return {
      rs1m: rank(stocks.map((r) => { const v = ret(r, 4); return { s: r.symbol, v: v === null ? null : v - spy4 }; })),
      rs6: rank(stocks.map((r) => ({ s: r.symbol, v: r.features?.mrs52 }))),
      r3m: (r) => ret(r, 13),
    };
  }, [stocks, spy]);

  const coverage = useMemo(() => ({
    dly: stocks.filter((r) => r.features?.dly).length,
    ern: stocks.filter((r) => r.features?.ern).length,
  }), [stocks]);

  const results = useMemo(() => {
    const m = new Map<ScreenKey, StockStage[]>();
    for (const s of SCREENS) {
      m.set(s.key, stocks.filter((r) => s.match(r, ctx)).sort((a, b) => (ctx.rs1m.get(b.symbol) ?? 0) - (ctx.rs1m.get(a.symbol) ?? 0)));
    }
    return m;
  }, [stocks, ctx]);

  const screen = SCREENS.find((s) => s.key === key)!;
  const rows = useMemo(() => {
    const q = search.trim().toUpperCase();
    const out = (results.get(key) ?? []).filter((r) => !q || r.symbol.includes(q) || groupOf(r.symbol).toUpperCase().includes(q));
    if (sortCol) {
      const c = screen.cols.find((x) => x.label === sortCol);
      const f = c?.sort ?? (sortCol === "rs6" ? (r: StockStage) => ctx.rs6.get(r.symbol) ?? 0 : sortCol === "3m" ? (r: StockStage) => ctx.r3m(r) ?? -999 : sortCol === "hi" ? (r: StockStage) => r.features?.pctFrom52wHigh ?? -999 : null);
      if (f) out.sort((a, b) => f(b) - f(a));
    }
    return out;
  }, [results, key, search, groupOf, sortCol, screen, ctx]);

  const missing = screen.needs ? stocks.length > 0 && coverage[screen.needs] < stocks.length * 0.3 : false;
  const symbols = rows.map((r) => r.symbol);
  const th = (label: string, tip: string, sortKey?: string, cls = "text-right") => (
    <th
      title={tip}
      onClick={sortKey ? () => setSortCol(sortCol === sortKey ? null : sortKey) : undefined}
      className={`whitespace-nowrap px-2 py-2 text-[10.5px] font-medium ${cls} ${sortKey ? "cursor-pointer select-none" : ""} ${sortCol === sortKey ? "text-primary" : "text-muted-foreground"}`}
    >
      {label}{sortCol === sortKey ? " ▾" : ""}
    </th>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {SCREENS.map((s) => {
          const list = results.get(s.key) ?? [];
          return <PickCard key={s.key} title={s.title} count={list.length} tickers={list.map((r) => r.symbol)} on={s.key === key} onClick={() => pick(s.key)} title2={s.blurb} />;
        })}
      </div>

      <div className="rounded-lg border border-border bg-card px-3 pb-2.5 pt-3">
        <SectionHead
          className="mb-1"
          title={<>{screen.title}
            <Tooltip>
              <TooltipTrigger asChild><Info size={13} className="text-muted-foreground" /></TooltipTrigger>
              <TooltipContent className="max-w-sm text-xs"><ul className="list-disc space-y-0.5 pl-4">{screen.rules.map((x) => <li key={x}>{x}</li>)}</ul></TooltipContent>
            </Tooltip></>}
          sub={<>{screen.blurb} Sorted by 1-month relative strength.</>}
          right={<>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ticker or industry…" className="h-8 w-40 rounded border border-border bg-background px-2 text-xs" />
            <button
              onClick={() => { navigator.clipboard.writeText(symbols.join(",")); toast.success(`${symbols.length} symbols copied.`); }}
              disabled={!symbols.length} title="Copy symbols"
              className="inline-flex h-8 items-center gap-1 rounded border border-border px-2 text-[11px] hover:bg-accent disabled:opacity-40"
            ><Copy size={11} /></button>
            <button
              onClick={() => { downloadTradingViewList(symbols, `Screen_${screen.key}`); toast.success(`Downloaded ${symbols.length} symbols.`); }}
              disabled={!symbols.length} title="Download a TradingView watchlist"
              className="inline-flex h-8 items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 text-[11px] font-medium text-primary hover:bg-primary/20 disabled:opacity-40"
            ><Download size={11} /> TradingView</button>
          </>}
        />
        {missing && (
          <p className="mt-2 rounded border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-[11px] text-amber-200">
            {screen.needs === "ern" ? "Earnings data" : "Daily data"} is only available for {coverage[screen.needs!]} of {stocks.length} stocks — press <b>Scan</b> (top right) once to fill it in.
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-muted/20">
            <tr className="border-b border-border">
              {th("Stock", "", undefined, "text-left")}
              {th("40 weeks", "Weekly closes, colored by stage", undefined, "text-left")}
              {th("Stage", "", undefined, "text-left")}
              {th("RS 1M", "4-week return vs SPY, ranked across your list (1–99)")}
              {th("RS", "52-week relative strength rank (1–99)", "rs6")}
              {th("3M", "13-week return", "3m")}
              {th("From high", "Distance from the 52-week high", "hi")}
              {screen.cols.map((c) => <Fragment key={c.label}>{th(c.label, c.tip, c.sort ? c.label : undefined)}</Fragment>)}
              {th("Base", "Base Scanner state, if the stock has a base", undefined, "text-left")}
              {th("Industry", "", undefined, "text-left")}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isOpen = open === r.symbol;
              const b = baseBy.get(r.symbol);
              const rs1 = ctx.rs1m.get(r.symbol), rs6 = ctx.rs6.get(r.symbol), r3 = ctx.r3m(r);
              return (
                <Fragment key={r.symbol}>
                  <tr onClick={() => setOpen(isOpen ? null : r.symbol)} className={`cursor-pointer border-b border-border/40 hover:bg-accent/30 ${isOpen ? "bg-accent/20" : ""}`}>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} className="text-muted-foreground" />}
                        <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(r.symbol)}`} target="_blank" rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()} className="font-mono font-semibold hover:text-primary hover:underline">{r.symbol}</a>
                      </div>
                      <div className="max-w-[150px] truncate pl-4 text-[10px] text-muted-foreground">{nameOf(r.symbol) ?? ""}</div>
                    </td>
                    <td className="px-2 py-1"><WeekSpark r={r} /></td>
                    <td className="px-2 py-1.5"><StageBadge r={r} compact /></td>
                    <td className="px-2 py-1.5 text-right font-mono">
                      <span className="inline-flex items-center gap-1.5">
                        {rs1 ?? "—"}
                        {rs1 !== undefined && <span className="inline-block h-1.5 w-8 overflow-hidden rounded bg-muted"><span className="block h-full bg-primary" style={{ width: `${rs1}%` }} /></span>}
                      </span>
                    </td>
                    <td className={`px-2 py-1.5 text-right font-mono ${(rs6 ?? 0) >= 90 ? "text-gain-medium" : ""}`}>{rs6 ?? "—"}</td>
                    <td className={`whitespace-nowrap px-2 py-1.5 text-right font-mono ${tone(r3, 20, -10)}`}>{pct(r3, 0)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono">{pct(r.features?.pctFrom52wHigh, 0)}</td>
                    {screen.cols.map((c) => <td key={c.label} className="whitespace-nowrap px-2 py-1.5 text-right font-mono">{c.cell(r)}</td>)}
                    <td className="whitespace-nowrap px-2 py-1.5 text-[10.5px]">
                      {b?.state ? <span className="rounded bg-primary/10 px-1.5 py-[1px] text-primary" title={`Base score ${b.score}`}>{STATE_NAMES[b.state]} · {b.score}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="max-w-[160px] truncate px-2 py-1.5 text-[11px] text-muted-foreground">{groupOf(r.symbol)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-border/40 bg-background/40">
                      <td colSpan={20} className="px-3 py-2">
                        <div className="sticky left-3 flex w-[calc(100vw-4rem)] max-w-[1200px] flex-col gap-3 lg:flex-row">
                          <div className="min-w-0 flex-1 lg:max-w-[820px]"><StageChartPanel r={r} /></div>
                          <StockFacts r={r} base={b} rs1={rs1} rs6={rs6} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={20} className="px-2 py-8 text-center text-muted-foreground">No stocks pass this screen right now{search ? " with this search" : ""}.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Side panel next to the chart: the numbers behind the screens, grouped, so the row's "why" is visible at a glance. */
function StockFacts({ r, base, rs1, rs6 }: { r: StockStage; base?: StockBase; rs1?: number; rs6?: number }) {
  const d = r.features?.dly, e = r.features?.ern;
  const Row = ({ k, v, cls = "" }: { k: string; v: ReactNode; cls?: string }) => (
    <div className="flex items-baseline justify-between gap-3 py-[3px]"><span className="text-muted-foreground">{k}</span><span className={`font-mono ${cls}`}>{v}</span></div>
  );
  const Group = ({ title, children }: { title: string; children: ReactNode }) => (
    <div><div className="mb-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground/80">{title}</div><div className="divide-y divide-border/40">{children}</div></div>
  );
  return (
    <div className="grid w-full shrink-0 content-start gap-3 rounded-md border border-border/60 bg-card/60 p-3 text-[11px] lg:w-[300px]">
      <Group title="Trend">
        <Row k="Stage" v={<StageBadge r={r} compact />} />
        <Row k="RS 1 month / 52 weeks" v={`${rs1 ?? "—"} / ${rs6 ?? "—"}`} />
        <Row k="From 52-week high" v={pct(r.features?.pctFrom52wHigh, 0)} />
        {base?.state && <Row k="Base" v={`${STATE_NAMES[base.state]} · ${base.score}`} cls="text-primary" />}
      </Group>
      {d && (
        <Group title={`Daily · ${d.date}`}>
          <Row k="vs 21-day EMA" v={pct(d.ema21Pct)} />
          <Row k="vs 50-day average" v={pct(d.sma50Pct)} />
          <Row k="Avg daily range" v={pct(d.adrPct, 1, false)} />
          <Row k="10-day range" v={`${pct(d.range10Pct, 1, false)} · ${d.tight.toFixed(1)}× ADR`} cls={d.tight <= 2.2 ? "text-gain-medium" : ""} />
          {d.vol5x50 != null && <Row k="Volume 5d ÷ 50d" v={`${d.vol5x50.toFixed(2)}×`} cls={d.vol5x50 <= 0.8 ? "text-gain-medium" : ""} />}
        </Group>
      )}
      {e && (
        <Group title="Earnings">
          <Row k="EPS vs year ago" v={pct(e.epsYoY, 0)} cls={tone(e.epsYoY, 25, 0)} />
          <Row k="Last fiscal year EPS" v={pct(e.fyEps, 0)} />
          <Row k="Revenue vs year ago" v={pct(e.revYoY, 0)} cls={tone(e.revYoY, 15, 0)} />
          {e.accel && <div className="pt-1 text-[10.5px] text-gain-medium">▲ Earnings accelerating</div>}
        </Group>
      )}
      {!!r.reasons?.length && (
        <Group title="Why this stage">
          <div className="pt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">{r.reasons.slice(0, 4).join(" · ")}</div>
        </Group>
      )}
    </div>
  );
}
