import { useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Copy, Crown, ExternalLink, Search } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import type { RsStock } from "@/hooks/useRsAlpha";
import type { StockFundamentals } from "@/hooks/useStockFundamentalsMap";
import { useSuperperformance } from "@/hooks/useSuperperformance";
import { useStockStages } from "@/hooks/useStockStages";
import { useStockBases } from "@/hooks/useStockBases";
import { useInsiderBuys } from "@/hooks/useInsiderBuys";
import InsiderBuyBadge from "@/components/rs/InsiderBuyBadge";
import { breakoutSetup, savedCoverage, savedScore, type ProfileKey } from "@/lib/superperfProfiles";
import { GROUP_MODE_LABEL, groupKeyForIndustry, type GroupMode } from "@/lib/groupColors";
import { STAGE_COLORS, type StockStage } from "@/lib/stageAnalysis";
import { STATE_NAMES, type StockBase } from "@/lib/bases";
import { BUCKET_INFO, LEADER_PCT, MIN_COVERAGE, PILLARS, buildLeaderInputs, rankIndustries, rsRatings, type IndustrySummary, type LeaderRow } from "@/lib/industryLeaders";

/**
 * Industry Leaders — the best businesses in each industry, ranked against their own peers.
 * Purpose: when an industry is leading, focus on the setup of its fundamental leader.
 *   Overview: every industry (strongest RS first) with its #1 fundamental stock, that stock's RS,
 *             stage and setup, and the runners-up.
 *   Industry: all members ranked, with the four pillars, RS, stage, setup and base.
 */

const fmtPct = (v: number | null | undefined, d = 0) => (typeof v === "number" && Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(d)}%` : "—");
const pctCls = (v: number | null) =>
  v === null ? "text-muted-foreground" : v >= 80 ? "text-[hsl(150,65%,58%)] font-semibold" : v >= 60 ? "text-[hsl(150,45%,62%)]" : v >= 40 ? "text-foreground" : v >= 20 ? "text-[hsl(25,85%,62%)]" : "text-loss-medium";
const pctBg = (v: number | null) =>
  v === null ? "" : v >= 80 ? "bg-[hsl(150,60%,45%)]/15" : v >= 60 ? "bg-[hsl(150,60%,45%)]/[0.07]" : v < 20 ? "bg-loss-medium/10" : "";

function Bar({ v, color = "hsl(150,60%,50%)" }: { v: number | null; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        {v !== null && <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(3, v)}%`, background: color }} />}
      </span>
      <span className={`w-6 text-right font-mono text-xs ${pctCls(v)}`}>{v ?? "—"}</span>
    </span>
  );
}

function BucketChip({ b }: { b: LeaderRow["bucket"] }) {
  if (!b) return null;
  const i = BUCKET_INFO[b];
  return <span title={i.tip} className={`whitespace-nowrap rounded-full border px-1.5 py-px text-[10px] font-medium ${i.cls}`}>{i.label}</span>;
}

function StageCell({ st }: { st: StockStage | undefined }) {
  if (!st) return <span className="text-muted-foreground">—</span>;
  return <span className="inline-flex items-center gap-1.5 text-xs" title={st.reasons?.join(" · ") ?? undefined}><span className="h-2 w-2 rounded-full" style={{ background: STAGE_COLORS[st.stage] }} />{st.substage || st.stage}</span>;
}

function BaseCell({ b }: { b: StockBase | undefined }) {
  if (!b?.state) return <span className="text-muted-foreground">—</span>;
  const good = b.state === "ready" || b.state === "qualified" || b.state === "triggered";
  return (
    <span className={`text-xs ${good ? "text-[hsl(150,65%,60%)]" : b.state === "failed" || b.state === "extended" ? "text-[hsl(25,85%,62%)]" : "text-muted-foreground"}`}
      title={[b.dist_to_pivot !== null ? `${b.dist_to_pivot.toFixed(1)}% to pivot` : "", b.score !== null ? `base score ${Math.round(b.score)}` : ""].filter(Boolean).join(" · ") || undefined}>
      {STATE_NAMES[b.state]}{b.dist_to_pivot !== null && (b.state === "ready" || b.state === "qualified") ? ` · ${b.dist_to_pivot.toFixed(1)}%` : ""}
    </span>
  );
}

const tv = (sym: string) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(sym)}`;

export default function IndustryLeadersModal({ open, onOpenChange, stocks, isOtcSymbol, fundamentalsMap }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  stocks: RsStock[];
  isOtcSymbol: (sym: string) => boolean;
  fundamentalsMap: Map<string, StockFundamentals>;
}) {
  const { rows: saved, thresholds } = useSuperperformance();
  const { bySymbol: stageMap } = useStockStages(open);
  const { bySymbol: baseMap } = useStockBases(open);
  const insiders = useInsiderBuys(open);

  const [mode, setMode] = useState<GroupMode>(() => { try { return (localStorage.getItem("industry-leaders-mode") as GroupMode) || "industry"; } catch { return "industry"; } });
  const changeMode = (m: GroupMode) => { setMode(m); setView(null); try { localStorage.setItem("industry-leaders-mode", m); } catch { /* ignore */ } };
  const [view, setView] = useState<string | null>(null);  // null = overview, else a group name
  const [q, setQ] = useState("");
  const [leadingOnly, setLeadingOnly] = useState(false);
  const [confirmedOnly, setConfirmedOnly] = useState(false);
  const [perGroup, setPerGroup] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const universe = useMemo(() => stocks.filter((s) => !isOtcSymbol(s.symbol)), [stocks, isOtcSymbol]);
  const bySym = useMemo(() => new Map(universe.map((s) => [s.symbol.toUpperCase(), s])), [universe]);
  const savedBy = useMemo(() => new Map(saved.map((r) => [r.symbol.toUpperCase(), r])), [saved]);

  const rating = useMemo(() => rsRatings(universe), [universe]);

  const industries = useMemo<IndustrySummary[]>(() => {
    const items = buildLeaderInputs(universe, (s) => groupKeyForIndustry(s.sector, mode), fundamentalsMap, savedBy, rating);
    return rankIndustries(items).filter((g) => !/^(unknown|other|n\/a|—)$/i.test(g.group.trim()));
    // thresholds: savedScore depends on the minimum-coverage setting, which refreshes `thresholds`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universe, fundamentalsMap, savedBy, rating, mode, thresholds]);

  const setupOf = (sym: string) => {
    const s = bySym.get(sym);
    return breakoutSetup({ stage: stageMap.get(sym) ?? null, rsRating: rating.get(sym) ?? null, rs1w: s?.rs1w ?? null, rs1m: s?.rs1m ?? null, rsNewHigh: s?.rsNh20d ?? null }).score;
  };

  const leadingCut = Math.max(1, Math.ceil(industries.length * 0.25));
  const overview = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return industries.filter((g) =>
      g.leaders.length > 0
      && (!leadingOnly || g.rsRank <= leadingCut)
      && (!confirmedOnly || g.leaders[0].bucket === "confirmed")
      && (!needle || g.group.toLowerCase().includes(needle) || g.leaders.slice(0, 3).some((r) => r.symbol.toLowerCase().startsWith(needle))));
  }, [industries, q, leadingOnly, confirmedOnly, leadingCut]);

  const current = view ? industries.find((g) => g.group === view) ?? null : null;
  const stats = useMemo(() => ({
    industries: industries.length,
    ranked: industries.reduce((a, g) => a + g.ranked, 0),
    confirmed: industries.filter((g) => g.leaders[0]?.bucket === "confirmed").length,
  }), [industries]);

  const copyLeaders = async () => {
    const text = overview.map((g) => `###${g.group.replace(/[,\n]/g, " ")}\n${g.leaders.slice(0, perGroup).map((r) => r.symbol).join("\n")}`).join("\n");
    try { await navigator.clipboard.writeText(text); toast.success(`Copied ${overview.length} industries × top ${perGroup}`, { description: "TradingView sections — paste into Import symbols." }); }
    catch { toast.error("Clipboard blocked"); }
  };

  const raw = (sym: string) => {
    const f = fundamentalsMap.get(sym), row = savedBy.get(sym);
    const prof: [ProfileKey, string][] = [["current", "Current"], ["momentum", "Earn. momentum"], ["growth", "Sales accel."], ["margins", "Margins"], ["quality", "Quality"]];
    return (
      <div className="grid gap-3 px-3 py-2 text-xs sm:grid-cols-2">
        <div className="space-y-1">
          <div className="font-semibold text-muted-foreground">Raw numbers</div>
          <div className="grid grid-cols-[auto_auto] justify-start gap-x-6 gap-y-0.5 font-mono">
            <span className="text-muted-foreground">EPS growth (qtr, YoY)</span><span>{fmtPct(f?.eps_quarterly_yoy)}</span>
            <span className="text-muted-foreground">Revenue growth (qtr, YoY)</span><span>{fmtPct(f?.revenue_quarterly_yoy)}</span>
            <span className="text-muted-foreground">EPS growth (TTM)</span><span>{fmtPct(f?.eps_ttm_yoy)}</span>
            <span className="text-muted-foreground">ROE</span><span>{fmtPct(f?.roe, 1)}</span>
            <span className="text-muted-foreground">Net margin</span><span>{fmtPct(f?.net_margin, 1)}</span>
            <span className="text-muted-foreground">Debt / equity</span><span>{typeof f?.debt_to_equity === "number" ? f.debt_to_equity.toFixed(2) : "—"}</span>
          </div>
        </div>
        <div className="space-y-1">
          <div className="font-semibold text-muted-foreground">Profile scores {row?.last_report ? <span className="font-normal">· last report {row.last_report}</span> : null}</div>
          <div className="grid grid-cols-[auto_auto] justify-start gap-x-6 gap-y-0.5 font-mono">
            {prof.map(([k, l]) => { const v = savedScore(row, k), c = savedCoverage(row, k); return [
              <span key={k + "l"} className="text-muted-foreground">{l}</span>,
              <span key={k + "v"}>{v ?? "—"}{c !== null ? <span className="text-muted-foreground"> · data {c}%</span> : null}</span>,
            ]; })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setExpanded(null); }}>
      <DialogContent className="flex h-[92vh] w-[96vw] max-w-[1400px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="flex items-center gap-2"><Crown size={16} className="text-[hsl(40,90%,60%)]" /> Industry Leaders</DialogTitle>
          <DialogDescription className="text-xs">
            The best businesses in each industry, ranked against their own peers. When an industry leads, focus on its fundamental leader's setup.
          </DialogDescription>
        </DialogHeader>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card/40 px-5 py-2 text-xs">
          {view ? (
            <button onClick={() => { setView(null); setExpanded(null); }} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 hover:bg-accent"><ArrowLeft size={12} /> All industries</button>
          ) : (
            <>
              <span className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Industry or ticker…" className="h-7 w-48 rounded-md border border-border bg-background pl-7 pr-2 text-xs" />
              </span>
              <label className="flex items-center gap-1.5" title={`Top 25% of industries by median RS rating (${leadingCut} of ${industries.length})`}><Checkbox checked={leadingOnly} onCheckedChange={(v) => setLeadingOnly(v === true)} /> Leading industries only</label>
              <label className="flex items-center gap-1.5" title={BUCKET_INFO.confirmed.tip}><Checkbox checked={confirmedOnly} onCheckedChange={(v) => setConfirmedOnly(v === true)} /> Leader is confirmed (RS 80+)</label>
            </>
          )}
          <select value={mode} onChange={(e) => changeMode(e.target.value as GroupMode)} className="h-7 rounded-md border border-border bg-background px-2 text-xs" aria-label="Group by">
            {(["industry", "subIndustry", "sector"] as GroupMode[]).map((m) => <option key={m} value={m}>by {GROUP_MODE_LABEL[m]}</option>)}
          </select>
          <span className="text-muted-foreground">{stats.industries} groups · {stats.ranked} stocks ranked · {stats.confirmed} confirmed leader{stats.confirmed === 1 ? "" : "s"}</span>
          {!view && (
            <span className="ml-auto inline-flex items-center gap-1.5">
              <select value={perGroup} onChange={(e) => setPerGroup(Number(e.target.value))} className="h-7 rounded-md border border-border bg-background px-1.5 text-xs" aria-label="Leaders per industry to copy">
                {[1, 2, 3, 5].map((n) => <option key={n} value={n}>top {n}</option>)}
              </select>
              <button onClick={copyLeaders} disabled={!overview.length} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 hover:bg-accent disabled:opacity-40"><Copy size={12} /> Copy for TradingView</button>
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {industries.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No fundamentals yet. Run the Superperformance update and the fundamentals scan, then come back.</div>
          ) : !current ? (
            /* ── Overview: one row per industry ── */
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-[1] bg-background text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left" title="Industry rank by the median RS rating of its stocks">#</th>
                  <th className="px-2 py-2 text-left">{GROUP_MODE_LABEL[mode]}</th>
                  <th className="px-2 py-2 text-left" title="Median RS rating of the industry's stocks">Group RS</th>
                  <th className="px-2 py-2 text-left">Fundamental leader</th>
                  <th className="px-2 py-2 text-left" title="Industry-relative fundamental score (0–100)">Fund.</th>
                  <th className="px-2 py-2 text-right">RS</th>
                  <th className="px-2 py-2 text-left">Stage</th>
                  <th className="px-2 py-2 text-right" title="Breakout setup score">Setup</th>
                  <th className="px-2 py-2 text-left">Base</th>
                  <th className="px-2 py-2 text-right" title="Distance below the 52-week high">From high</th>
                  <th className="px-2 py-2 text-left">Next in line</th>
                </tr>
              </thead>
              <tbody>
                {overview.map((g) => {
                  const L = g.leaders[0], st = stageMap.get(L.symbol), fh = st?.features?.pctFrom52wHigh;
                  return (
                    <tr key={g.group} onClick={() => setView(g.group)} className={`cursor-pointer border-b border-border/40 hover:bg-muted/30 ${g.rsRank <= leadingCut ? "" : "opacity-90"}`}>
                      <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{g.rsRank}</td>
                      <td className="max-w-[240px] px-2 py-1.5">
                        <div className="truncate font-medium" title={g.group}>{g.group}</div>
                        <div className="text-[11px] text-muted-foreground">{g.ranked} ranked · {g.members} stocks</div>
                      </td>
                      <td className="px-2 py-1.5"><Bar v={g.rsMedian === null ? null : Math.round(g.rsMedian)} color="hsl(222,82%,64%)" /></td>
                      <td className="px-2 py-1.5">
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <a href={tv(L.symbol)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-mono font-bold hover:text-primary">{L.symbol}</a>
                          <InsiderBuyBadge info={insiders.get(L.symbol)} />
                          <BucketChip b={L.bucket} />
                        </span>
                        {bySym.get(L.symbol)?.companyName && <div className="max-w-[200px] truncate text-[11px] text-muted-foreground">{bySym.get(L.symbol)?.companyName}</div>}
                      </td>
                      <td className="px-2 py-1.5"><Bar v={L.score} /></td>
                      <td className={`px-2 py-1.5 text-right font-mono text-xs ${pctCls(L.rsRating)}`}>{L.rsRating ?? "—"}</td>
                      <td className="px-2 py-1.5"><StageCell st={st} /></td>
                      <td className={`px-2 py-1.5 text-right font-mono text-xs ${pctCls(setupOf(L.symbol))}`}>{setupOf(L.symbol) ?? "—"}</td>
                      <td className="px-2 py-1.5"><BaseCell b={baseMap.get(L.symbol)} /></td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs text-muted-foreground">{typeof fh === "number" ? `${Math.abs(fh).toFixed(1)}%` : "—"}</td>
                      <td className="px-2 py-1.5 font-mono text-xs text-muted-foreground">
                        {g.leaders.slice(1, 3).map((r) => <span key={r.symbol} className="mr-2" title={`Fundamental score ${r.score} · RS ${r.rsRating ?? "—"}`}>{r.symbol}<span className="text-[10px]"> {r.score}</span></span>)}
                      </td>
                    </tr>
                  );
                })}
                {!overview.length && <tr><td colSpan={11} className="p-6 text-center text-sm text-muted-foreground">No industries match.</td></tr>}
              </tbody>
            </table>
          ) : (
            /* ── One industry: all members ranked ── */
            <div className="space-y-3 p-5">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h3 className="text-lg font-semibold">{current.group}</h3>
                <span className="text-xs text-muted-foreground">#{current.rsRank} of {industries.length} by group RS · median RS {current.rsMedian !== null ? Math.round(current.rsMedian) : "—"} · {current.members} stocks, {current.ranked} with enough data</span>
              </div>

              {(() => {
                const L = current.leaders[0];
                if (!L) return null;
                const st = stageMap.get(L.symbol), b = baseMap.get(L.symbol), setup = setupOf(L.symbol);
                const strong = PILLARS.filter((p) => (L.pillars[p.key] ?? 0) >= 80).map((p) => p.label.toLowerCase());
                return (
                  <div className="rounded-lg border border-[hsl(40,90%,55%)]/40 bg-[hsl(40,90%,55%)]/[0.06] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Crown size={15} className="text-[hsl(40,90%,60%)]" />
                      <span className="font-mono text-lg font-bold">{L.symbol}</span>
                      <span className="text-sm text-muted-foreground">{bySym.get(L.symbol)?.companyName}</span>
                      <BucketChip b={L.bucket} />
                      <InsiderBuyBadge info={insiders.get(L.symbol)} />
                      <a href={tv(L.symbol)} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent"><ExternalLink size={12} /> Chart</a>
                    </div>
                    <p className="mt-2 text-sm">
                      Best fundamentals of {current.ranked} in the group (score {L.score}){strong.length ? `, top fifth on ${strong.join(", ")}` : ""}.
                      {" "}RS rating {L.rsRating ?? "—"}{st ? `, stage ${st.substage || st.stage}` : ""}{setup !== null ? `, setup ${setup}` : ""}{b?.state ? `, base ${STATE_NAMES[b.state].toLowerCase()}${b.dist_to_pivot !== null ? ` (${b.dist_to_pivot.toFixed(1)}% to pivot)` : ""}` : ""}.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-4">
                      {PILLARS.map((p) => <span key={p.key} className="text-xs" title={p.tip}><span className="mr-1.5 text-muted-foreground">{p.label}</span><Bar v={L.pillars[p.key]} /></span>)}
                    </div>
                  </div>
                );
              })()}

              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2 text-left">#</th>
                      <th className="px-2 py-2 text-left">Stock</th>
                      <th className="px-2 py-2 text-left" title="Industry-relative fundamental score (0–100)">Fund.</th>
                      {PILLARS.map((p) => <th key={p.key} className="px-2 py-2 text-right" title={p.tip}>{p.label}</th>)}
                      <th className="px-2 py-2 text-right">RS</th>
                      <th className="px-2 py-2 text-left">Stage</th>
                      <th className="px-2 py-2 text-right">Setup</th>
                      <th className="px-2 py-2 text-left">Base</th>
                      <th className="px-2 py-2 text-left"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.leaders.map((r) => {
                      const isOpen = expanded === r.symbol, setup = setupOf(r.symbol);
                      return [
                        <tr key={r.symbol} onClick={() => setExpanded(isOpen ? null : r.symbol)} className={`cursor-pointer border-t border-border/40 hover:bg-muted/30 ${r.rank === 1 ? "bg-[hsl(40,90%,55%)]/[0.05]" : ""}`}>
                          <td className="px-2 py-1.5 font-mono text-xs text-muted-foreground"><span className="inline-flex items-center gap-1">{isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}{r.rank}</span></td>
                          <td className="px-2 py-1.5">
                            <span className="inline-flex items-center gap-1.5">
                              {r.rank === 1 && <Crown size={12} className="text-[hsl(40,90%,60%)]" />}
                              <a href={tv(r.symbol)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-mono font-bold hover:text-primary">{r.symbol}</a>
                              <InsiderBuyBadge info={insiders.get(r.symbol)} />
                            </span>
                            <div className="max-w-[200px] truncate text-[11px] text-muted-foreground">{bySym.get(r.symbol)?.companyName}</div>
                          </td>
                          <td className="px-2 py-1.5"><Bar v={r.score} /></td>
                          {PILLARS.map((p) => <td key={p.key} className={`px-2 py-1.5 text-right font-mono text-xs ${pctCls(r.pillars[p.key])} ${pctBg(r.pillars[p.key])}`}>{r.pillars[p.key] ?? "—"}</td>)}
                          <td className={`px-2 py-1.5 text-right font-mono text-xs ${pctCls(r.rsRating)}`}>{r.rsRating ?? "—"}</td>
                          <td className="px-2 py-1.5"><StageCell st={stageMap.get(r.symbol)} /></td>
                          <td className={`px-2 py-1.5 text-right font-mono text-xs ${pctCls(setup)}`}>{setup ?? "—"}</td>
                          <td className="px-2 py-1.5"><BaseCell b={baseMap.get(r.symbol)} /></td>
                          <td className="px-2 py-1.5"><BucketChip b={r.bucket} /></td>
                        </tr>,
                        isOpen ? <tr key={r.symbol + "-x"} className="border-t border-border/40 bg-muted/20"><td colSpan={13}>{raw(r.symbol)}<div className="px-3 pb-2 text-[11px] text-muted-foreground">Data for the ranking: {r.coverage}% of 9 inputs.</div></td></tr> : null,
                      ];
                    })}
                  </tbody>
                </table>
              </div>

              {current.unranked.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Not ranked — under {MIN_COVERAGE}% of the inputs available: <span className="font-mono">{current.unranked.map((r) => r.symbol).join(", ")}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-border px-5 py-2 text-[11px] leading-snug text-muted-foreground">
          Fundamental score = industry percentile on Growth 35%, Trend 20%, Quality 25%, Strength 20% (hover the column names). Top fundamentals = score {LEADER_PCT}+ or #1 in the group.
          {" "}<b className="font-medium text-foreground">Confirmed</b> = top fundamentals + RS 80+ · <b className="font-medium text-foreground">Emerging</b> = top fundamentals, RS under 70 · <b className="font-medium text-foreground">Price only</b> = RS 80+ with bottom-half fundamentals.
          {" "}Groups with fewer than 3 stocks are left out. Ranks are within this app's universe.
        </div>
      </DialogContent>
    </Dialog>
  );
}
