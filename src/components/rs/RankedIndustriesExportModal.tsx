import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Copy, Download, ListOrdered } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import type { RsStock } from "@/hooks/useRsAlpha";
import type { StockFundamentals } from "@/hooks/useStockFundamentalsMap";
import { useSuperperformance } from "@/hooks/useSuperperformance";
import { PROFILE_BY_KEY, savedScore, type ProfileKey } from "@/lib/superperfProfiles";
import { GROUP_MODE_LABEL, groupKeyForIndustry, type GroupMode } from "@/lib/groupColors";
import { buildLeaderInputs, rankIndustries, rsRatings } from "@/lib/industryLeaders";
import { TIMEFRAMES, TV_SAFE_LIMIT, buildTvText, rankGroups, tvSectionHeader, type RsInput, type Timeframe } from "@/lib/industryRanking";

/**
 * Ranked industries → TradingView watchlist.
 * Sections = industries from strongest to weakest on the chosen timeframe (shrunk, clipped
 * equal-weight RS — see lib/industryRanking). Inside each section, stocks from best to worst
 * fundamentals compared with their industry peers (the Industry Leaders score), or another key.
 */

type SortKey = "fund" | "rs" | ProfileKey;
const SORTS: { key: SortKey; label: string; tip: string }[] = [
  { key: "fund", label: "Fundamentals vs peers", tip: "Industry-relative fundamental score (Industry Leaders): growth, trend, quality and strength, each ranked against the stock's own industry." },
  { key: "rs", label: "RS on this timeframe", tip: "The stock's RS (return minus SPY) on the selected timeframe." },
  { key: "current", label: "Current profile", tip: "Saved Current fundamentals score (absolute, not vs peers)." },
  { key: "minervini", label: "Minervini profile", tip: "Saved Minervini SEPA score." },
  { key: "oneil", label: "O'Neil profile", tip: "Saved O'Neil CAN SLIM score." },
  { key: "momentum", label: "Earnings momentum", tip: "Saved Earnings-momentum score (surprises, revisions, acceleration)." },
  { key: "quality", label: "Quality profile", tip: "Saved Quality score." },
];

interface Settings {
  tf: Timeframe; mode: GroupMode; topGroups: number; perGroup: number; minMembers: number;
  sort: SortKey; dropNoData: boolean; headerInfo: boolean;
}
const DEFAULTS: Settings = { tf: "3m", mode: "industry", topGroups: 20, perGroup: 5, minMembers: 3, sort: "fund", dropNoData: false, headerInfo: true };
const KEY = "ranked-industries-export-v1";
const load = (): Settings => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return DEFAULTS; } };

const ALL = 0; // slider value meaning "all"

export default function RankedIndustriesExportModal({ open, onOpenChange, stocks, isOtcSymbol, fundamentalsMap, overallRs }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  stocks: RsStock[];
  isOtcSymbol: (sym: string) => boolean;
  fundamentalsMap: Map<string, StockFundamentals>;
  /** The stock's Overall RS with the user's RS Alpha weights. */
  overallRs: (s: RsStock) => number | null;
}) {
  const { rows: saved, thresholds } = useSuperperformance();
  const [st, setSt] = useState<Settings>(load);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ } }, [st]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSt((p) => ({ ...p, [k]: v }));
  const [showText, setShowText] = useState(false);

  const universe = useMemo(() => stocks.filter((s) => !isOtcSymbol(s.symbol)), [stocks, isOtcSymbol]);
  const groupOf = useMemo(() => (s: RsStock) => groupKeyForIndustry(s.sector, st.mode), [st.mode]);
  const isJunkGroup = (g: string) => /^(unknown|other|n\/a|—)$/i.test(g.trim());

  // 1) Industries, strongest first, on the timeframe.
  const groups = useMemo(() => {
    const items: RsInput[] = universe.map((s) => ({
      symbol: s.symbol.toUpperCase(), group: groupOf(s),
      rs: { "1d": s.rs1d, "1w": s.rs1w, "1m": s.rs1m, "3m": s.rs3m, "6m": s.rs6m, overall: overallRs(s) },
    }));
    return rankGroups(items, st.tf, st.minMembers).filter((g) => !isJunkGroup(g.group));
  }, [universe, groupOf, st.tf, st.minMembers, overallRs]);

  // 2) Stocks inside each industry.
  const rating = useMemo(() => rsRatings(universe), [universe]);
  const savedBy = useMemo(() => new Map(saved.map((r) => [r.symbol.toUpperCase(), r])), [saved]);
  const fund = useMemo(() => {
    const ind = rankIndustries(buildLeaderInputs(universe, groupOf, fundamentalsMap, savedBy, rating), 1);
    return new Map(ind.map((g) => [g.group, g]));
    // thresholds: savedScore depends on the minimum-coverage setting, which refreshes `thresholds`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universe, groupOf, fundamentalsMap, savedBy, rating, thresholds]);
  const bySym = useMemo(() => new Map(universe.map((s) => [s.symbol.toUpperCase(), s])), [universe]);
  const tfRs = (sym: string): number | null => {
    const s = bySym.get(sym);
    if (!s) return null;
    const v = st.tf === "1d" ? s.rs1d : st.tf === "1w" ? s.rs1w : st.tf === "1m" ? s.rs1m : st.tf === "3m" ? s.rs3m : st.tf === "6m" ? s.rs6m : overallRs(s);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };

  const sections = useMemo(() => {
    const top = st.topGroups === ALL ? groups : groups.slice(0, st.topGroups);
    return top.map((g) => {
      const f = fund.get(g.group);
      const members = universe.filter((s) => groupOf(s) === g.group).map((s) => s.symbol.toUpperCase());
      let ranked: { sym: string; key: number | null; lowData: boolean }[];
      if (st.sort === "fund") {
        const leaders = (f?.leaders ?? []).map((r) => ({ sym: r.symbol, key: r.score, lowData: false }));
        const rest = (f?.unranked ?? []).map((r) => ({ sym: r.symbol, key: null as number | null, lowData: true }))
          .sort((a, b) => (rating.get(b.sym) ?? 0) - (rating.get(a.sym) ?? 0));   // no data: by RS rating, at the end
        ranked = [...leaders, ...rest];
      } else {
        const val = (sym: string) => (st.sort === "rs" ? tfRs(sym) : savedScore(savedBy.get(sym), st.sort as ProfileKey));
        const withV = members.map((sym) => ({ sym, key: val(sym), lowData: val(sym) === null }));
        ranked = withV.filter((x) => !x.lowData).sort((a, b) => (b.key as number) - (a.key as number))
          .concat(withV.filter((x) => x.lowData).sort((a, b) => (rating.get(b.sym) ?? 0) - (rating.get(a.sym) ?? 0)));
      }
      if (st.dropNoData) ranked = ranked.filter((x) => !x.lowData);
      const take = st.perGroup === ALL ? ranked : ranked.slice(0, st.perGroup);
      return { g, stocks: take, total: ranked.length };
    }).filter((s) => s.stocks.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, fund, universe, groupOf, st.topGroups, st.perGroup, st.sort, st.dropNoData, st.tf, rating, savedBy]);

  const tfLabel = TIMEFRAMES.find((t) => t.key === st.tf)?.label ?? st.tf;
  const movers = !!TIMEFRAMES.find((t) => t.key === st.tf)?.movers;
  const out = useMemo(() => buildTvText(sections.map((s) => ({
    name: st.headerInfo ? tvSectionHeader(s.g.rank, s.g.group, `${tfLabel} ${s.g.pct}`) : s.g.group,
    symbols: s.stocks.map((x) => x.sym),
  }))), [sections, st.headerInfo, tfLabel]);

  const today = new Date().toISOString().slice(0, 10);
  const fileName = `industries_ranked_${tfLabel}_top${st.topGroups === ALL ? "all" : st.topGroups}x${st.perGroup === ALL ? "all" : st.perGroup}_${today}.txt`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(out.text); toast.success(`Copied ${out.symbols} symbols in ${out.sections} sections`, { description: "TradingView → new watchlist → ⋯ → Import list." }); }
    catch { toast.error("Clipboard blocked — use Download instead."); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([out.text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = fileName; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const sortTip = SORTS.find((s) => s.key === st.sort)?.tip;
  const nf = (v: number | null, d = 1) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] w-[96vw] max-w-[1200px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="flex items-center gap-2"><ListOrdered size={16} className="text-[hsl(199,85%,65%)]" /> Ranked industries → TradingView</DialogTitle>
          <DialogDescription className="text-xs">
            Industries from strongest to weakest on the timeframe you pick; inside each one, stocks from best to worst fundamentals compared with their peers.
          </DialogDescription>
        </DialogHeader>

        {/* Controls */}
        <div className="grid gap-x-6 gap-y-3 border-b border-border bg-card/40 px-5 py-3 text-xs md:grid-cols-3">
          <div className="space-y-1.5">
            <div className="font-medium">Rank industries by RS over</div>
            <div className="flex flex-wrap gap-1">
              {TIMEFRAMES.map((t) => (
                <button key={t.key} type="button" aria-pressed={st.tf === t.key} onClick={() => set("tf", t.key)}
                  title={t.movers ? "Short-term movers: noisy — no evidence these ranks persist" : t.tip}
                  className={`rounded-md border px-2.5 py-1 font-medium ${st.tf === t.key ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Group by</span>
              <select value={st.mode} onChange={(e) => set("mode", e.target.value as GroupMode)} className="h-7 rounded-md border border-border bg-background px-2">
                {(["industry", "subIndustry", "sector"] as GroupMode[]).map((m) => <option key={m} value={m}>{GROUP_MODE_LABEL[m]}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-2.5">
            <div className="space-y-1">
              <div className="flex justify-between"><span className="font-medium">Industries</span><span className="font-mono text-[hsl(40,90%,60%)]">{st.topGroups === ALL ? `all ${groups.length}` : `top ${st.topGroups}`}</span></div>
              <Slider min={0} max={60} step={5} value={[st.topGroups]} onValueChange={([v]) => set("topGroups", v)} />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between"><span className="font-medium">Stocks per industry</span><span className="font-mono text-[hsl(40,90%,60%)]">{st.perGroup === ALL ? "all" : `top ${st.perGroup}`}</span></div>
              <Slider min={0} max={20} step={1} value={[st.perGroup]} onValueChange={([v]) => set("perGroup", v)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="font-medium">Order inside each industry</span>
            </div>
            <select value={st.sort} onChange={(e) => set("sort", e.target.value as SortKey)} title={sortTip} className="h-7 w-full rounded-md border border-border bg-background px-2">
              {SORTS.filter((s) => s.key === "fund" || s.key === "rs" || PROFILE_BY_KEY.has(s.key as ProfileKey)).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <label className="flex items-center gap-1.5"><Checkbox checked={st.dropNoData} onCheckedChange={(v) => set("dropNoData", v === true)} /> Leave out stocks without enough data</label>
            <label className="flex items-center gap-1.5"><Checkbox checked={st.headerInfo} onCheckedChange={(v) => set("headerInfo", v === true)} /> Rank and score in section names</label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground" title="Groups with fewer stocks are left out — their average is mostly noise">Min stocks per industry</span>
              <select value={st.minMembers} onChange={(e) => set("minMembers", Number(e.target.value))} className="h-7 rounded-md border border-border bg-background px-1.5">
                {[3, 5, 8].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
        </div>

        {movers && (
          <div className="flex items-center gap-2 border-b border-border bg-[hsl(40,90%,55%)]/10 px-5 py-1.5 text-xs text-[hsl(40,90%,70%)]">
            <AlertTriangle size={13} /> {tfLabel} shows short-term movers: it mostly reflects recent news, and there's no evidence these group ranks persist. Use 1M–6M or Overall for leadership.
          </div>
        )}

        {/* Preview */}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {showText ? (
            <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">{out.text || "(empty)"}</pre>
          ) : sections.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No industries to show. Check that RS has been calculated for the universe.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-[1] bg-background text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-2 py-1.5 text-left">#</th>
                  <th className="px-2 py-1.5 text-left">{GROUP_MODE_LABEL[st.mode]}</th>
                  <th className="px-2 py-1.5 text-right" title="1–99 among industries on this timeframe">Score</th>
                  <th className="px-2 py-1.5 text-right" title={st.tf === "blend" ? "" : "Average RS of the members (return minus SPY, %), before shrinking"}>Avg RS</th>
                  <th className="px-2 py-1.5 text-right" title="Share of members beating SPY on this timeframe">Breadth</th>
                  <th className="px-2 py-1.5 text-left">Stocks, in export order</th>
                </tr>
              </thead>
              <tbody>
                {sections.map(({ g, stocks: ss, total }) => (
                  <tr key={g.group} className="border-b border-border/40 align-top">
                    <td className="px-2 py-1.5 font-mono text-xs text-muted-foreground">{g.rank}</td>
                    <td className="max-w-[260px] px-2 py-1.5">
                      <div className="truncate font-medium" title={g.group}>{g.group}</div>
                      <div className="text-[11px] text-muted-foreground">{g.members} stocks{g.lowConfidence ? <span className="text-[hsl(40,90%,62%)]" title="Fewer than 5 stocks with RS: rank pulled toward the market average"> · small group</span> : null}</div>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-xs font-semibold">{g.pct}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-xs text-muted-foreground">{nf(g.rawMean)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-xs text-muted-foreground">{Math.round(g.breadth)}%</td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {ss.map((x, i) => (
                          <span key={x.sym} title={x.lowData ? "Not enough data to rank — placed at the end by RS rating" : st.sort === "fund" ? `Fundamentals vs peers ${x.key}` : `${x.key}`}
                            className={`rounded px-1.5 py-px font-mono text-[11px] ${x.lowData ? "border border-dashed border-border text-muted-foreground" : i === 0 ? "bg-[hsl(40,90%,55%)]/15 text-[hsl(40,90%,68%)]" : "bg-muted/60"}`}>
                            {x.sym}{x.key !== null && st.sort !== "rs" ? <span className="ml-1 text-[10px] opacity-60">{Math.round(x.key)}</span> : null}
                          </span>
                        ))}
                        {total > ss.length && <span className="text-[11px] text-muted-foreground">+{total - ss.length} more</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer: counter + actions */}
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-2.5 text-xs">
          <span className={out.cut > 0 ? "text-[hsl(25,90%,62%)]" : "text-muted-foreground"}>
            <b className="font-mono text-foreground">{out.symbols}</b> symbols · {out.sections} sections · limit {TV_SAFE_LIMIT}
            {out.cut > 0 ? ` · ${out.cut} cut to fit TradingView's 1,000-symbol limit` : ""}
            {out.dupes > 0 ? ` · ${out.dupes} duplicates removed` : ""}
          </span>
          <button onClick={() => setShowText((v) => !v)} className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">{showText ? "Show table" : "Show file text"}</button>
          <span className="ml-auto flex gap-2">
            <button onClick={copy} disabled={!out.symbols} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 hover:bg-accent disabled:opacity-40"><Copy size={12} /> Copy</button>
            <button onClick={download} disabled={!out.symbols} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"><Download size={12} /> Download .txt</button>
          </span>
          <p className="basis-full text-[11px] leading-snug text-muted-foreground">
            Import into a <b className="font-medium text-foreground">new, empty</b> TradingView watchlist (⋯ → Import list) and clear any column sort, or TradingView will re-sort inside each section. Free TradingView accounts can't import lists.
            {" "}Industry score = average RS of the members, outliers capped, small groups pulled toward the market average. Fundamentals vs peers = the Industry Leaders score; stocks without enough data go to the end of their section.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
