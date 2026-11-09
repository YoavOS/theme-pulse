import { useEffect, useMemo, useState } from "react";
import { Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { savedScore, type ProfileKey, type SavedRow } from "@/lib/superperfProfiles";
import type { IndustrySummary } from "@/lib/industryLeaders";
import { TV_SAFE_LIMIT, buildTvText, tvSectionHeader, type GroupRank } from "@/lib/industryRanking";

/**
 * Export tab of the Industry Leaders panel: industries in the panel's order (strongest first on the
 * chosen timeframe), and inside each one, stocks from best to worst fundamentals vs their peers.
 */

type SortKey = "fund" | "rs" | ProfileKey;
const SORTS: { key: SortKey; label: string; tip: string }[] = [
  { key: "fund", label: "Fundamentals vs peers", tip: "The Industry Leaders score: growth, trend, quality and strength, each ranked against the stock's own industry." },
  { key: "rs", label: "RS on the timeframe", tip: "The stock's RS (return minus SPY) on the selected timeframe." },
  { key: "current", label: "Current profile", tip: "Saved Current fundamentals score (absolute, not vs peers)." },
  { key: "minervini", label: "Minervini profile", tip: "Saved Minervini SEPA score." },
  { key: "oneil", label: "O'Neil profile", tip: "Saved O'Neil CAN SLIM score." },
  { key: "momentum", label: "Earnings momentum", tip: "Saved Earnings-momentum score (surprises, revisions, acceleration)." },
  { key: "quality", label: "Quality profile", tip: "Saved Quality score." },
];

interface Settings { topGroups: number; perGroup: number; sort: SortKey; dropNoData: boolean; headerInfo: boolean }
const DEFAULTS: Settings = { topGroups: 20, perGroup: 5, sort: "fund", dropNoData: false, headerInfo: true };
const KEY = "industry-export-v1";
const ALL = 0;

export default function IndustryExportTab({ groups, fundBy, membersOf, rating, savedBy, tfRs, tfLabel }: {
  groups: GroupRank[];                       // already in display order (strongest first)
  fundBy: Map<string, IndustrySummary>;
  membersOf: (group: string) => string[];    // upper-case symbols
  rating: Map<string, number>;
  savedBy: Map<string, SavedRow>;
  tfRs: (sym: string) => number | null;
  tfLabel: string;
}) {
  const [st, setSt] = useState<Settings>(() => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return DEFAULTS; } });
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ } }, [st]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSt((p) => ({ ...p, [k]: v }));
  const [showText, setShowText] = useState(false);

  const sections = useMemo(() => {
    const top = st.topGroups === ALL ? groups : groups.slice(0, st.topGroups);
    const byRating = (a: { sym: string }, b: { sym: string }) => (rating.get(b.sym) ?? 0) - (rating.get(a.sym) ?? 0);
    return top.map((g) => {
      let ranked: { sym: string; key: number | null; lowData: boolean }[];
      if (st.sort === "fund") {
        const f = fundBy.get(g.group);
        ranked = [
          ...(f?.leaders ?? []).map((r) => ({ sym: r.symbol, key: r.score, lowData: false })),
          ...(f?.unranked ?? []).map((r) => ({ sym: r.symbol, key: null as number | null, lowData: true })).sort(byRating),
        ];
      } else {
        const val = (sym: string) => (st.sort === "rs" ? tfRs(sym) : savedScore(savedBy.get(sym), st.sort as ProfileKey));
        const all = membersOf(g.group).map((sym) => { const v = val(sym); return { sym, key: v, lowData: v === null }; });
        ranked = all.filter((x) => !x.lowData).sort((a, b) => (b.key as number) - (a.key as number)).concat(all.filter((x) => x.lowData).sort(byRating));
      }
      if (st.dropNoData) ranked = ranked.filter((x) => !x.lowData);
      return { g, stocks: st.perGroup === ALL ? ranked : ranked.slice(0, st.perGroup), total: ranked.length };
    }).filter((s) => s.stocks.length > 0);
  }, [groups, fundBy, membersOf, rating, savedBy, tfRs, st]);

  const out = useMemo(() => buildTvText(sections.map((s) => ({
    name: st.headerInfo ? tvSectionHeader(s.g.rank, s.g.group, `${tfLabel} ${s.g.pct}`) : s.g.group,
    symbols: s.stocks.map((x) => x.sym),
  }))), [sections, st.headerInfo, tfLabel]);

  const fileName = `industries_ranked_${tfLabel}_top${st.topGroups || "all"}x${st.perGroup || "all"}_${new Date().toISOString().slice(0, 10)}.txt`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(out.text); toast.success(`Copied ${out.symbols} symbols in ${out.sections} sections`, { description: "TradingView → new watchlist → ⋯ → Import list." }); }
    catch { toast.error("Clipboard blocked — use Download instead."); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([out.text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = fileName; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Settings */}
      <div className="grid gap-x-8 gap-y-3 border-b border-border px-5 py-3 text-xs md:grid-cols-[1fr_1fr_1.1fr]">
        <div className="space-y-1">
          <div className="flex justify-between"><span className="font-medium">Industries</span><span className="font-mono text-[hsl(40,90%,60%)]">{st.topGroups === ALL ? `all ${groups.length}` : `top ${Math.min(st.topGroups, groups.length)} of ${groups.length}`}</span></div>
          <Slider min={0} max={60} step={5} value={[st.topGroups]} onValueChange={([v]) => set("topGroups", v)} aria-label="Industries to include" />
          <div className="text-[11px] text-muted-foreground">In the order shown on the Industries tab. 0 = all.</div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between"><span className="font-medium">Stocks per industry</span><span className="font-mono text-[hsl(40,90%,60%)]">{st.perGroup === ALL ? "all" : `top ${st.perGroup}`}</span></div>
          <Slider min={0} max={20} step={1} value={[st.perGroup]} onValueChange={([v]) => set("perGroup", v)} aria-label="Stocks per industry" />
          <div className="text-[11px] text-muted-foreground">0 = every stock in the industry.</div>
        </div>
        <div className="space-y-1.5">
          <label className="flex items-center gap-2">
            <span className="shrink-0 font-medium">Order inside each industry</span>
            <select value={st.sort} onChange={(e) => set("sort", e.target.value as SortKey)} title={SORTS.find((s) => s.key === st.sort)?.tip} className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2">
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5"><Checkbox checked={st.dropNoData} onCheckedChange={(v) => set("dropNoData", v === true)} /> Leave out stocks without enough data</label>
          <label className="flex items-center gap-1.5"><Checkbox checked={st.headerInfo} onCheckedChange={(v) => set("headerInfo", v === true)} /> Rank and score in section names</label>
        </div>
      </div>

      {/* Preview */}
      <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
        {showText ? (
          <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">{out.text || "(empty)"}</pre>
        ) : !sections.length ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Nothing to export with these settings.</div>
        ) : (
          <ol className="space-y-1.5">
            {sections.map(({ g, stocks, total }) => (
              <li key={g.group} className="grid grid-cols-[2rem_minmax(0,16rem)_minmax(0,1fr)] items-start gap-3 rounded-md border border-border/50 px-2 py-1.5">
                <span className="pt-0.5 text-right font-mono text-xs text-muted-foreground">{g.rank}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium" title={g.group}>{g.group}</span>
                  <span className="text-[11px] text-muted-foreground">score {g.pct} · {Math.round(g.breadth)}% up · {g.members} stocks</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {stocks.map((x, i) => (
                    <span key={x.sym} title={x.lowData ? "Not enough data to rank — placed at the end by RS rating" : x.key !== null ? String(Math.round(x.key * 10) / 10) : undefined}
                      className={`rounded px-1.5 py-px font-mono text-[11px] ${x.lowData ? "border border-dashed border-border text-muted-foreground" : i === 0 ? "bg-[hsl(40,90%,55%)]/15 text-[hsl(40,90%,68%)]" : "bg-muted/60"}`}>
                      {x.sym}{x.key !== null && st.sort !== "rs" ? <span className="ml-1 text-[10px] opacity-60">{Math.round(x.key)}</span> : null}
                    </span>
                  ))}
                  {total > stocks.length && <span className="self-center text-[11px] text-muted-foreground">+{total - stocks.length} more</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-2.5 text-xs">
        <span className={out.cut > 0 ? "text-[hsl(25,90%,62%)]" : "text-muted-foreground"}>
          <b className="font-mono text-foreground">{out.symbols}</b> symbols · {out.sections} sections · limit {TV_SAFE_LIMIT}
          {out.cut > 0 ? ` · ${out.cut} cut to fit TradingView's 1,000-symbol limit` : ""}
          {out.dupes > 0 ? ` · ${out.dupes} duplicates removed` : ""}
        </span>
        <button onClick={() => setShowText((v) => !v)} className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">{showText ? "Show preview" : "Show file text"}</button>
        <span className="ml-auto flex gap-2">
          <button onClick={copy} disabled={!out.symbols} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 hover:bg-accent disabled:opacity-40"><Copy size={12} /> Copy</button>
          <button onClick={download} disabled={!out.symbols} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"><Download size={12} /> Download .txt</button>
        </span>
        <p className="basis-full text-[11px] leading-snug text-muted-foreground">
          Import into a <b className="font-medium text-foreground">new, empty</b> TradingView watchlist (⋯ → Import list) and clear any column sort, or TradingView re-sorts inside each section. Free TradingView accounts can't import lists.
        </p>
      </div>
    </div>
  );
}
