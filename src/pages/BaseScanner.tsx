import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Boxes, ChevronDown, ChevronRight, Copy, Download, Info, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import { useStockBases } from "@/hooks/useStockBases";
import { useStockStages } from "@/hooks/useStockStages";
import { useUniverseSectors } from "@/hooks/useUniverseSectors";
import { groupKeyForIndustry } from "@/lib/groupColors";
import { StageBadge } from "@/components/stages/StageStockTable";
import TrackRecord from "@/components/stages/TrackRecord";
import WeeklyChart from "@/components/stages/WeeklyChart";
import { RegimeBadge } from "@/components/stages/RegimePanel";
import { downloadTradingViewList, isStageScanRunning, runStageScan } from "@/lib/stageAnalysis";
import {
  ALL_LABELS, ALL_STATES, BREAKDOWN_PARTS, CHART_CHECKS, LABEL_NAMES, STATE_NAMES, STATE_TIPS,
  passesStrict, tighteningGrade, type BaseLabel, type BaseState, type StockBase,
} from "@/lib/bases";

const PRESET_KEY = "base_scanner_preset_v1";
type SortKey = "score" | "dist" | "risk" | "rs" | "depth" | "weeks" | "symbol";

const STATE_STYLE: Record<BaseState, string> = {
  ready: "bg-primary/15 text-primary",
  triggered: "bg-emerald-500/15 text-emerald-400",
  qualified: "bg-[hsl(222,82%,64%)]/15 text-[hsl(222,82%,74%)]",
  developing: "bg-amber-400/15 text-amber-300",
  extended: "bg-orange-400/15 text-orange-300",
  failed: "bg-pink-500/15 text-pink-300",
  watch: "bg-muted text-muted-foreground",
};
const scoreColor = (s: number) => (s >= 85 ? "hsl(var(--primary))" : s >= 75 ? "hsl(222,82%,64%)" : s >= 65 ? "hsl(45,80%,55%)" : "hsl(329,70%,60%)");
const fmtPct = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : `${x.toFixed(d)}%`);
const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - Date.parse(iso + "T00:00:00Z")) / 86400_000) : null);

export default function BaseScanner() {
  const { rows, loading, error } = useStockBases(true);
  const { bySymbol: stageBy, rows: stageRows } = useStockStages(true);
  const { rows: uni, extra, load: loadUni } = useUniverseSectors();
  const [preset, setPreset] = useState<"balanced" | "strict">(() => {
    try { return (localStorage.getItem(PRESET_KEY) as "balanced" | "strict") || "balanced"; } catch { return "balanced"; }
  });
  const [stateF, setStateF] = useState<BaseState | "all">("all");
  const [labelF, setLabelF] = useState<BaseLabel | "all">("all");
  const [minScore, setMinScore] = useState(55);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("score");
  const [open, setOpen] = useState<string | null>(null);
  const [scan, setScan] = useState<{ done: number; total: number } | null>(isStageScanRunning() ? { done: 0, total: 0 } : null);

  useEffect(() => { loadUni(); }, [loadUni]);
  useEffect(() => { try { localStorage.setItem(PRESET_KEY, preset); } catch { /* ignore */ } }, [preset]);

  const groupOf = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const r of extra) m.set(r.symbol.toUpperCase(), r.sector);
    for (const r of uni) m.set(r.symbol.toUpperCase(), r.sector);
    return (sym: string) => groupKeyForIndustry(m.get(sym) ?? null, "industry");
  }, [uni, extra]);
  const nameOf = useMemo(() => {
    const m = new Map(uni.map((r) => [r.symbol.toUpperCase(), r.name ?? null]));
    return (sym: string) => m.get(sym) ?? null;
  }, [uni]);

  const market = stageBy.get("SPY") ?? null;
  // regime from the stocks classified up to the latest week (+ SPY for the index trend)
  const regimeRows = useMemo(() => {
    const latest = stageRows.reduce<string | null>((m, r) => (!m || r.as_of > m ? r.as_of : m), null);
    return stageRows.filter((r) => r.as_of === latest);
  }, [stageRows]);
  const asOf = rows.reduce<string | null>((m, r) => (!m || r.as_of > m ? r.as_of : m), null);

  // Preset first, then counts are computed on the preset set so chips match the table.
  const presetRows = useMemo(() => rows.filter((r) => r.score !== null && (preset === "balanced" || passesStrict(r))), [rows, preset]);
  const scoreRows = useMemo(() => presetRows.filter((r) => (r.score ?? 0) >= minScore), [presetRows, minScore]);

  const stateCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of scoreRows) if (labelF === "all" || (r.labels ?? []).includes(labelF)) m.set(r.state ?? "watch", (m.get(r.state ?? "watch") ?? 0) + 1);
    return m;
  }, [scoreRows, labelF]);
  const labelCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of scoreRows) if (stateF === "all" || r.state === stateF) for (const lb of r.labels ?? []) m.set(lb, (m.get(lb) ?? 0) + 1);
    return m;
  }, [scoreRows, stateF]);

  const visible = useMemo(() => {
    const q = search.trim().toUpperCase();
    const out = scoreRows.filter((r) =>
      (stateF === "all" || r.state === stateF) &&
      (labelF === "all" || (r.labels ?? []).includes(labelF)) &&
      (!q || r.symbol.includes(q) || groupOf(r.symbol).toUpperCase().includes(q)));
    const num = (x: number | null | undefined, dflt: number) => (x === null || x === undefined || !Number.isFinite(x) ? dflt : x);
    out.sort((a, b) => {
      switch (sort) {
        case "symbol": return a.symbol.localeCompare(b.symbol);
        case "dist": return num(a.dist_to_pivot, 999) - num(b.dist_to_pivot, 999);
        case "risk": return num(a.stop_risk, 999) - num(b.stop_risk, 999);
        case "rs": return num(b.rs_pct, -1) - num(a.rs_pct, -1);
        case "depth": return a.features.depthPct - b.features.depthPct;
        case "weeks": return a.features.weeks - b.features.weeks;
        default: return num(b.score, 0) - num(a.score, 0);
      }
    });
    return out;
  }, [scoreRows, stateF, labelF, search, sort, groupOf]);

  const cards = useMemo(() => {
    const prime = presetRows.filter((r) => r.band === "prime");
    return {
      prime: prime.length,
      tier1: presetRows.filter((r) => r.tier === 1).length,
      ready: presetRows.filter((r) => r.state === "ready").length,
      trig: presetRows.filter((r) => (r.state === "triggered" || r.state === "extended") && (daysSince(r.features.trigger.date) ?? 99) <= 7),
    };
  }, [presetRows]);

  const startScan = async () => {
    setScan({ done: 0, total: 0 });
    try {
      const r = await runStageScan((done, total) => setScan({ done, total }));
      toast.success(`Stages & bases updated · ${r.processed.toLocaleString("en-US")} stocks`);
    } catch (e) {
      toast.error("Scan failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setScan(null);
    }
  };

  // A scan started elsewhere (Full Scan, Stages tab) — follow it to completion.
  useEffect(() => {
    if (isStageScanRunning()) startScan();
  }, []);

  const symbols = visible.map((r) => r.symbol);
  const th = (key: SortKey | null, label: string, cls = "text-right", tip?: string) => (
    <th
      onClick={key ? () => setSort(key) : undefined}
      title={tip}
      className={`whitespace-nowrap px-2 py-2 text-[10.5px] font-medium ${cls} ${key ? "cursor-pointer select-none" : ""} ${sort === key ? "text-primary" : "text-muted-foreground"}`}
    >
      {label}{sort === key ? " ▾" : ""}
    </th>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-3">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
          <Link to="/" className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <ArrowLeft size={14} />
          </Link>
          <Boxes size={16} className="text-primary" />
          <h1 className="text-sm font-semibold tracking-wide">Base Scanner</h1>
          <Tooltip>
            <TooltipTrigger asChild><Info size={13} className="text-muted-foreground" /></TooltipTrigger>
            <TooltipContent className="max-w-sm text-xs leading-relaxed">
              Stage 2 continuation bases from your research: a 100-point base score (trend & prior move, relative strength,
              shape & repair, tightening, volume, pivot & risk, market) plus pattern labels (VCP, flat base, cup with handle,
              double bottom, ascending base, high-tight flag, box). Weekly bars define the base; daily bars from the last
              Full Scan time and grade the breakout.
            </TooltipContent>
          </Tooltip>
          {asOf && <span className="font-mono text-[11px] text-muted-foreground">week ending {new Date(asOf + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
          <div className="ml-auto flex items-center gap-2">
            <div className="inline-flex rounded-md border border-border bg-muted/20 p-0.5" title="Strict = the research's strict columns: RS ≥ 90, within 15% of the 52-week high, range position ≥ 0.85, ≤ 5% below the pivot, stop ≤ 8%, volume dry-up ≤ 0.8">
              {(["balanced", "strict"] as const).map((p) => (
                <button key={p} onClick={() => setPreset(p)} className={`rounded px-2.5 py-1 text-[11px] font-medium capitalize ${preset === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{p}</button>
              ))}
            </div>
            <button
              onClick={startScan}
              disabled={!!scan}
              className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs text-primary hover:bg-primary/20 disabled:opacity-60"
              title="Runs with Scan Stages (and automatically at the end of every Full Scan)"
            >
              {scan ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {scan ? (scan.total ? `Scanning ${scan.done}/${scan.total}` : "Scanning…") : "Scan"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-3 px-4 py-4">
        {error && !rows.length && (
          <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            {/does not exist|schema cache/i.test(error) ? "The Base Scanner isn't set up on the server yet." : `Couldn't load bases: ${error}`}
          </div>
        )}
        {!error && !loading && !rows.length && (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <p className="text-sm">No base candidates yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">Run a <b>Full Scan</b> (best — it also provides the daily bars for breakout timing) or press <b>Scan</b>.</p>
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-[11px] text-muted-foreground">Prime (85+)</div>
                <div className="mt-1 font-mono text-xl text-primary">{cards.prime}</div>
                <div className="text-[11px] text-muted-foreground">Tier 1: {cards.tier1} (85+, ≤3% from pivot, no critical warning)</div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-[11px] text-muted-foreground">Ready</div>
                <div className="mt-1 font-mono text-xl">{cards.ready}</div>
                <div className="text-[11px] text-muted-foreground">score ≥75 · ≤8% below pivot · stop ≤12%</div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-[11px] text-muted-foreground">Breakouts (last 7 days)</div>
                <div className="mt-1 font-mono text-xl text-emerald-400">{cards.trig.length}</div>
                <div className="text-[11px] text-muted-foreground">{cards.trig.filter((r) => r.features.trigger.exceptional).length} with exceptional volume (≥2.5×)</div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-[11px] text-muted-foreground">Market regime <Link to="/stages" className="underline">(details)</Link></div>
                <div className="mt-2 text-sm"><RegimeBadge rows={regimeRows} /></div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">SPY {market ? <StageBadge r={market} compact /> : "—"} · breadth of your whole list</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
              <span className="text-[11px] text-muted-foreground">State</span>
              <button onClick={() => setStateF("all")} className={`rounded-full border px-2 py-0.5 text-[11px] ${stateF === "all" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>All</button>
              {ALL_STATES.filter((s) => s !== "watch" || minScore < 65).map((s) => (
                <Tooltip key={s}>
                  <TooltipTrigger asChild>
                    <button onClick={() => setStateF(stateF === s ? "all" : s)} className={`rounded-full border px-2 py-0.5 text-[11px] ${stateF === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                      {STATE_NAMES[s]} <span className="font-mono opacity-70">{stateCounts.get(s) ?? 0}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">{STATE_TIPS[s]}</TooltipContent>
                </Tooltip>
              ))}
              <span className="mx-1 h-4 w-px bg-border" />
              <span className="text-[11px] text-muted-foreground">Pattern</span>
              {ALL_LABELS.map((lb) => (
                <button key={lb} onClick={() => setLabelF(labelF === lb ? "all" : lb)} className={`rounded-full border px-2 py-0.5 text-[11px] ${labelF === lb ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                  {LABEL_NAMES[lb]} <span className="font-mono opacity-70">{labelCounts.get(lb) ?? 0}</span>
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-border" />
              <span className="text-[11px] text-muted-foreground">Min score</span>
              <Slider value={[minScore]} min={0} max={95} step={5} onValueChange={(v) => setMinScore(v[0])} className="w-24" />
              <span className="w-6 font-mono text-[11px] text-primary">{minScore}</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ticker or industry…" className="h-7 w-40 rounded border border-border bg-background px-2 text-xs" />
              <div className="ml-auto flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">{visible.length} stocks</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(symbols.join(",")); toast.success(`${symbols.length} symbols copied.`); }}
                  disabled={!symbols.length}
                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] hover:bg-accent disabled:opacity-40"
                ><Copy size={10} /> Copy</button>
                <button
                  onClick={() => { downloadTradingViewList(symbols, `Bases_${preset}${labelF !== "all" ? "_" + labelF : ""}${stateF !== "all" ? "_" + stateF : ""}`); toast.success(`Downloaded ${symbols.length} symbols.`, { description: "One ticker per line — ready for TradingView import." }); }}
                  disabled={!symbols.length}
                  className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/20 disabled:opacity-40"
                ><Download size={10} /> TradingView .txt</button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full border-collapse text-xs">
                <thead className="bg-muted/20">
                  <tr className="border-b border-border">
                    {th("symbol", "Ticker", "text-left")}
                    {th(null, "Pattern", "text-left")}
                    {th("score", "Score")}
                    {th(null, "State", "text-left")}
                    {th(null, "Pivot")}
                    {th("dist", "To pivot", "text-right", "How far the latest close is below the pivot (↑ = above it)")}
                    {th("risk", "Stop risk", "text-right", "Pivot to support (final contraction low)")}
                    {th("depth", "Depth")}
                    {th("weeks", "Weeks")}
                    {th(null, "Prior move")}
                    {th(null, "Tight", "text-right", "Tightening grade from the contraction score (A best)")}
                    {th(null, "Dry-up", "text-right", "Last 3 weeks' median volume ÷ earlier base volume (lower = quieter)")}
                    {th("rs", "RS %ile", "text-right", "26-week return percentile across your whole stock list")}
                    {th(null, "Stage", "text-left")}
                    {th(null, "Industry", "text-left")}
                    {th(null, "⚠", "text-left")}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const f = r.features;
                    const isOpen = open === r.symbol;
                    const stage = stageBy.get(r.symbol);
                    const grade = tighteningGrade(r);
                    const dist = r.dist_to_pivot ?? f.distToPivotPct;
                    return (
                      <Fragment key={r.symbol}>
                        <tr onClick={() => setOpen(isOpen ? null : r.symbol)} className="cursor-pointer border-b border-border/40 hover:bg-accent/30">
                          <td className="whitespace-nowrap px-2 py-1.5 font-mono font-medium">
                            <span className="inline-flex items-center gap-1">
                              {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} className="text-muted-foreground" />}
                              <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(r.symbol)}`} target="_blank" rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()} className="hover:text-primary hover:underline" title={`${nameOf(r.symbol) ?? r.symbol} — open TradingView chart`}>
                                {r.symbol}
                              </a>
                              {r.tier === 1 && <span className="text-[9px] text-primary" title="Tier 1: score 85+, within 3% of the pivot, no critical warning">T1</span>}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5">
                            {(r.labels ?? []).map((lb) => (
                              <span key={lb} className={`mr-1 inline-block rounded px-1.5 py-[1px] text-[10px] ${lb === r.primary_label ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>{LABEL_NAMES[lb]}</span>
                            ))}
                            {f.threeWeeksTight && <span className="inline-block rounded bg-muted px-1.5 py-[1px] text-[10px] text-muted-foreground" title="Three weekly closes within ~1.5% of each other">3WT</span>}
                            {f.daily?.contracting && <span className="ml-1 inline-block rounded bg-emerald-500/15 px-1.5 py-[1px] text-[10px] text-emerald-400" title={`Contracting on daily swings: ${f.daily.pullbacks.map((p) => p.toFixed(0) + "%").join(" → ")}. In the walk-forward test (Mar 2025–Jul 2026) this was the strongest base feature.`}>tightening</span>}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono">
                            <span className="inline-flex items-center gap-1.5">
                              {r.score}
                              <span className="inline-block h-1.5 w-10 overflow-hidden rounded bg-muted"><span className="block h-full" style={{ width: `${r.score}%`, background: scoreColor(r.score ?? 0) }} /></span>
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            {r.state && <span className={`rounded px-1.5 py-[1px] text-[10px] ${STATE_STYLE[r.state]}`}>{STATE_NAMES[r.state]}</span>}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono">{(r.pivot ?? f.pivot).toFixed(2)}</td>
                          <td className={`whitespace-nowrap px-2 py-1.5 text-right font-mono ${dist < 0 ? "text-emerald-400" : dist <= 5 ? "text-primary" : ""}`}>
                            {dist < 0 ? `+${Math.abs(dist).toFixed(1)}% ↑` : `${dist.toFixed(1)}%`}
                          </td>
                          <td className={`whitespace-nowrap px-2 py-1.5 text-right font-mono ${(r.stop_risk ?? 0) > 12 ? "text-amber-400" : ""}`}>{fmtPct(r.stop_risk)}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono">{fmtPct(f.depthPct, 0)}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono">{f.weeks}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono">+{f.priorImpulsePct.toFixed(0)}%</td>
                          <td className={`whitespace-nowrap px-2 py-1.5 text-right font-mono ${grade === "A" ? "text-emerald-400" : grade === "B" ? "text-[hsl(222,82%,74%)]" : grade === "C" ? "text-amber-300" : "text-pink-300"}`}>{grade}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono">{f.dryUp === null ? "—" : f.dryUp.toFixed(2)}</td>
                          <td className={`whitespace-nowrap px-2 py-1.5 text-right font-mono ${(r.rs_pct ?? 0) >= 90 ? "text-emerald-400" : ""}`}>{r.rs_pct ?? "—"}</td>
                          <td className="px-2 py-1.5">{stage ? <StageBadge r={stage} compact /> : <span className="text-muted-foreground">—</span>}</td>
                          <td className="max-w-[160px] truncate px-2 py-1.5 text-[11px] text-muted-foreground">{groupOf(r.symbol)}</td>
                          <td className="max-w-[220px] truncate px-2 py-1.5 text-[11px] text-amber-300" title={(r.warnings ?? []).join(" · ")}>
                            {f.trigger.exceptional && <span className="mr-1 text-primary" title="Breakout-day volume ≥ 2.5× the 50-day average">★</span>}
                            {(r.warnings ?? []).join(" · ")}
                          </td>
                        </tr>
                        {isOpen && <BaseDetail r={r} />}
                      </Fragment>
                    );
                  })}
                  {!visible.length && (
                    <tr><td colSpan={16} className="px-2 py-8 text-center text-muted-foreground">No bases match these filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
              <b className="text-foreground/80">How to read it:</b> the score ranks the <i>base</i>; a breakout is judged separately and never changes it.
              Patterns are labels on top of the score and a stock can carry several. Breakout volume ≥ 2.5× is “exceptional participation” —
              research shows it raises the average payoff, <i>not</i> the hit rate, so keep the stop. Thresholds are the research's starting
              values, not proven cut-offs; the chart check in each row is part of the method.
              Stocks listed less than ~14 months get a separate <i>IPO base</i> model (base from the post-listing high, pivot = that high) — it has no backtest yet.
            </p>
            <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
              <b className="text-foreground/80">Backtest (your list, weekly data, May 2023 – Jul 2026, 13 weeks ahead vs SPY):</b> Stage 2 stocks in a
              detected base beat Stage 2 stocks without one (median −0.5% vs −2.0%, 49% vs 46% beating SPY); scores 85+ did best
              (+1.4%, 52%). Below 85 the score barely separated winners from losers, and no single pattern stood out — the market
              regime mattered more than any setup detail. The list is today's stocks, so the past looks better than it was (survivorship).
            </p>
            <TrackRecord mode="bases" />
          </>
        )}
      </main>
    </div>
  );
}

function BaseDetail({ r }: { r: StockBase }) {
  const f = r.features;
  const t = f.trigger;
  const lb = (r.primary_label ?? "generic") as BaseLabel;
  const kv: [string, string][] = [
    [`Pivot (${f.pivotContacts} high${f.pivotContacts === 1 ? "" : "s"} near it)`, (r.pivot ?? f.pivot).toFixed(2)],
    ["Support / stop level", (r.support ?? f.support).toFixed(2)],
    ["Latest close", `${f.latestClose.toFixed(2)} (${f.latestDate})`],
    ["Base", `${f.weeks}w from ${f.baseStart} · ${f.depthPct.toFixed(0)}% deep`],
    ["Prior move · giveback", `+${f.priorImpulsePct.toFixed(0)}% · ${f.giveback.toFixed(2)}`],
    ["Range position", f.rangePos.toFixed(2)],
    ["Pullbacks, weekly (oldest → newest)", f.pullbacks.length ? f.pullbacks.map((p) => `${p.toFixed(0)}%`).join(" → ") : "—"],
    ...(f.daily ? ([
      ["Pullbacks, daily swings", `${f.daily.pullbacks.length ? f.daily.pullbacks.map((p) => `${p.toFixed(0)}%`).join(" → ") : "—"}${f.daily.contracting ? " · contracting ✓" : ""}${f.daily.covered ? "" : " (base older than the daily data)"}`],
      ["Daily: 5-day volume · tightness rank", `${f.daily.dryUp5.toFixed(2)}× the prior 50 · ${f.daily.tightRank} (0 = tightest in 6 months)`],
    ] as [string, string][]) : []),
    ["Range / ATR contraction", `${f.rangeContraction ?? "—"} / ${f.atrContraction ?? "—"}`],
    ["Volume dry-up · down/up volume", `${f.dryUp ?? "—"} · ${f.downUpVol ?? "—"}`],
    ["RS line vs 52w high", f.rsHighDistPct === null ? "—" : f.rsHighDistPct <= 0.5 ? "at a new high" : `−${f.rsHighDistPct.toFixed(1)}%`],
    ["From 52w high · above 10w MA", `${f.pctFrom52wHigh.toFixed(0)}% · ${f.ext10wPct >= 0 ? "+" : ""}${f.ext10wPct.toFixed(0)}%`],
    ["IBD base stage · base #", `${f.baseCount}${f.baseCountCapped ? "+" : ""} · #${f.baseNumber ?? f.baseCount}${f.baseCountCapped ? " (last 2 years)" : ""}`],
    ["Earnings", r.earnings_date ?? "none in the next 30 days"],
  ];
  if (t.status !== "none") {
    kv.splice(3, 0, [
      "Breakout",
      `${t.date ?? "—"}${t.rvol !== null ? ` · ${t.rvol.toFixed(1)}× vol` : ""}${t.closeLocation !== null ? ` · close loc ${t.closeLocation.toFixed(2)}` : ""}${t.rangeExpansion !== null ? ` · range ${t.rangeExpansion.toFixed(1)}×` : ""}${t.extensionPct !== null ? ` · ${t.extensionPct >= 0 ? "+" : ""}${t.extensionPct.toFixed(1)}% vs pivot` : ""}`,
    ]);
    if (t.acceptSessions) kv.splice(4, 0, ["First 5 sessions", `${t.acceptDays}/${t.acceptSessions} closes above pivot · lowest ${t.minClosePct !== undefined && t.minClosePct >= 0 ? "+" : ""}${t.minClosePct ?? "—"}%${t.retest ? " · retesting" : ""}`]);
  }
  return (
    <tr className="border-b border-border/40 bg-background/40">
      <td colSpan={16} className="px-4 py-3">
        <div className="sticky left-4 grid w-[calc(100vw-5rem)] max-w-[1180px] gap-5 md:grid-cols-3">
          <div>
            <h4 className="mb-2 text-xs font-semibold">Score breakdown · {r.score} / 100 · <span className="capitalize">{r.band}</span></h4>
            {BREAKDOWN_PARTS.map((p) => {
              const v = r.breakdown?.[p.key] ?? 0;
              return (
                <div key={p.key} className="my-1 grid grid-cols-[130px_1fr_44px] items-center gap-2 text-[11px]">
                  <span>{p.label}</span>
                  <span className="h-1.5 overflow-hidden rounded bg-muted"><span className="block h-full bg-primary" style={{ width: `${Math.min(100, (v / p.max) * 100)}%` }} /></span>
                  <span className="text-right font-mono text-muted-foreground">{Number(v.toFixed(1))}/{p.max}</span>
                </div>
              );
            })}
            {f.dataNote && <p className="mt-2 text-[10px] italic text-muted-foreground">{f.dataNote}</p>}
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold">Measurements</h4>
            <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[11px]">
              {kv.map(([k, v]) => (
                <Fragment key={k}><span className="text-muted-foreground">{k}</span><span className="text-right font-mono">{v}</span></Fragment>
              ))}
            </div>
          </div>
          <div>
            {f.chart && f.chart.c.length > 5 && <BaseChart r={r} />}
            <h4 className="mb-2 text-xs font-semibold">Manual chart check · {LABEL_NAMES[lb]}</h4>
            <ul className="list-disc space-y-1 pl-4 text-[11px] text-foreground/85">
              {CHART_CHECKS[lb].map((c) => <li key={c}>{c}</li>)}
            </ul>
            <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(r.symbol)}`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[11px] text-primary hover:underline">
              Open TradingView chart ↗
            </a>
          </div>
        </div>
      </td>
    </tr>
  );
}

/** Weekly mini chart from the scan's own bars: base window shaded, pivot (amber) and stop (pink). */
function BaseChart({ r }: { r: StockBase }) {
  const ch = r.features.chart!;
  const piv = r.pivot ?? r.features.pivot, sup = r.support ?? r.features.support;
  return (
    <div className="mb-3">
      <WeeklyChart
        s={ch}
        shadeFrom={ch.from}
        levels={[{ y: piv, color: "hsl(40,95%,55%)" }, { y: sup, color: "hsl(344,80%,65%)", dash: "2 3" }]}
        label={`${r.symbol} weekly chart, last ${ch.c.length} weeks`}
      />
      <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-muted-foreground">
        <span>weekly · {ch.c.length}w to {ch.end}</span>
        <span className="text-[hsl(40,95%,55%)]">— pivot</span>
        <span className="text-[hsl(344,80%,65%)]">— stop</span>
        <span className="text-[hsl(280,60%,72%)]">— 30w MA</span>
        <span>shaded = base</span>
      </div>
    </div>
  );
}
