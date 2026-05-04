import { useMemo, useState } from "react";
import { Layers, Sparkles, Loader2, Plus, Check, Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Sector } from "recharts";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { RsStock } from "@/hooks/useRsAlpha";
import { useCuratedThemes } from "@/hooks/useCuratedThemes";
import RsRatingBadge from "@/components/rs/RsRatingBadge";
import type { SectorTab } from "@/components/rs/SectorDistributionModal";

const TOPN_MIN = 10;
const TOPN_MAX = 500;

const SLICE_COLORS = [
  "hsl(160, 70%, 50%)", "hsl(200, 80%, 55%)", "hsl(280, 65%, 60%)",
  "hsl(30, 85%, 55%)",  "hsl(340, 75%, 60%)", "hsl(50, 85%, 55%)",
  "hsl(180, 70%, 50%)", "hsl(260, 70%, 65%)", "hsl(15, 80%, 60%)",
  "hsl(100, 55%, 50%)", "hsl(220, 70%, 60%)", "hsl(320, 60%, 60%)",
  "hsl(0, 70%, 60%)", "hsl(140, 60%, 50%)", "hsl(240, 70%, 65%)",
  "hsl(60, 80%, 55%)", "hsl(190, 75%, 55%)", "hsl(300, 65%, 60%)",
];
const UNASSIGNED_COLOR = "hsl(0, 0%, 40%)";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tabId: SectorTab;
  tabLabel: string;
  stocks: RsStock[];
  ratingMap: Map<string, number | null>;
  getRsForTab: (s: RsStock, t: SectorTab) => number | null;
  getReturnField: (s: RsStock, t: SectorTab) => number | null;
  isOtcSymbol: (sym: string) => boolean;
}

interface SliceStock {
  symbol: string;
  rs: number | null;
  rating: number | null;
  ret: number | null;
  industry: string | null;
}
interface Slice {
  name: string;
  count: number;
  pct: number;
  stocks: SliceStock[];
  isUnassigned?: boolean;
}

interface NewThemeSuggestion {
  theme_name: string;
  rationale: string;
  tickers: string[];
}
interface ThemeAddition {
  existing_theme: string;
  rationale: string;
  tickers: string[];
}

export default function ThemeDistributionModal({
  open, onOpenChange, tabId, tabLabel, stocks, ratingMap,
  getRsForTab, getReturnField, isOtcSymbol,
}: Props) {
  const { themes: curated, reload: reloadThemes } = useCuratedThemes();

  const [minRating, setMinRating] = useState(60);
  const [topN, setTopN] = useState(TOPN_MAX);
  const [acceleratingOnly, setAcceleratingOnly] = useState(false);
  const [minAdr, setMinAdr] = useState(3.0);
  const [excludeOtc, setExcludeOtc] = useState(true);

  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [created, setCreated] = useState<Set<string>>(new Set());

  // Apply filters → sort by RS → top N
  const filteredStocks = useMemo(() => {
    let list = stocks.filter(s => {
      if (excludeOtc && isOtcSymbol(s.symbol)) return false;
      const rating = ratingMap.get(s.symbol);
      if (rating === null || rating === undefined || rating < minRating) return false;
      if (s.adrPercent === null || s.adrPercent < minAdr) return false;
      if (acceleratingOnly) {
        if (s.rs1m === null || s.rs3m === null || !(s.rs1m > s.rs3m)) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => (getRsForTab(b, tabId) ?? -999) - (getRsForTab(a, tabId) ?? -999));
    if (topN < TOPN_MAX) list = list.slice(0, topN);
    return list;
  }, [stocks, ratingMap, minRating, minAdr, acceleratingOnly, excludeOtc, topN, tabId, getRsForTab, isOtcSymbol]);

  const stockMap = useMemo(() => {
    const m = new Map<string, RsStock>();
    filteredStocks.forEach(s => m.set(s.symbol.toUpperCase(), s));
    return m;
  }, [filteredStocks]);

  const { slices, unassignedSymbols } = useMemo(() => {
    const universe = new Set(filteredStocks.map(s => s.symbol.toUpperCase()));
    const total = universe.size || 1;

    const buildStock = (sym: string): SliceStock => {
      const s = stockMap.get(sym);
      return {
        symbol: sym,
        rs: s ? getRsForTab(s, tabId) : null,
        rating: ratingMap.get(sym) ?? null,
        ret: s ? getReturnField(s, tabId) : null,
        industry: s?.sector ?? null,
      };
    };

    const buckets: Slice[] = [];
    const assigned = new Set<string>();
    for (const t of curated) {
      const matched = t.symbols.filter(sym => universe.has(sym));
      if (matched.length === 0) continue;
      matched.forEach(s => assigned.add(s));
      const stocksArr = matched.map(buildStock).sort((a, b) => (b.rs ?? -999) - (a.rs ?? -999));
      buckets.push({ name: t.name, count: matched.length, pct: (matched.length / total) * 100, stocks: stocksArr });
    }
    buckets.sort((a, b) => b.count - a.count);

    const unassigned = [...universe].filter(s => !assigned.has(s)).sort();
    if (unassigned.length > 0) {
      buckets.push({
        name: "Unassigned", count: unassigned.length, pct: (unassigned.length / total) * 100,
        stocks: unassigned.map(buildStock).sort((a, b) => (b.rs ?? -999) - (a.rs ?? -999)),
        isUnassigned: true,
      });
    }
    return { slices: buckets, unassignedSymbols: unassigned };
  }, [curated, filteredStocks, stockMap, ratingMap, tabId, getRsForTab, getReturnField]);

  const expandedSlice = expanded ? slices.find(s => s.name === expanded) ?? null : null;
  const totalCount = filteredStocks.length;
  const topNLabel = topN >= TOPN_MAX ? "All" : `Top ${topN}`;
  const topNPresets = [10, 25, 50, 100, 200, TOPN_MAX];

  const renderActiveShape = (props: any) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
    return (
      <g>
        <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 6} startAngle={startAngle} endAngle={endAngle} fill={fill} />
        <Sector cx={cx} cy={cy} innerRadius={outerRadius + 8} outerRadius={outerRadius + 11} startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.4} />
      </g>
    );
  };

  const copySymbols = async (syms: string[]) => {
    try {
      await navigator.clipboard.writeText(syms.join(","));
      toast.success(`${syms.length} symbols copied to clipboard.`, { description: "Paste into TradingView Watchlist → Import symbols." });
    } catch { toast.error("Could not copy to clipboard."); }
  };

  const downloadSymbols = (syms: string[], name: string) => {
    const blob = new Blob([syms.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const safeTab = tabLabel.replace(/\s+/g, "");
    const safeName = name.replace(/[^A-Za-z0-9]+/g, "_");
    const a = document.createElement("a");
    a.href = url;
    a.download = `RS_Theme_${safeName}_${safeTab}_${syms.length}tickers.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${syms.length} symbols.`, { description: "One ticker per line — ready for TradingView import." });
  };

  const handleSuggest = async () => {
    if (unassignedSymbols.length < 3) { toast.info("Not enough unassigned tickers for AI suggestions."); return; }
    setSuggesting(true); setSuggestions(null);
    try {
      const payload = {
        existingThemes: curated.map(c => c.name),
        unassigned: unassignedSymbols.slice(0, 200).map(sym => {
          const s = stockMap.get(sym);
          return { symbol: sym, company: s?.companyName ?? null, sector: s?.sector ?? null };
        }),
      };
      const { data, error } = await supabase.functions.invoke("suggest-themes-from-tickers", { body: payload });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const list: Suggestion[] = Array.isArray(data?.suggestions) ? data.suggestions : [];
      setSuggestions(list);
      if (list.length === 0) toast.info(data?.note || "AI could not find coherent new themes.");
      else toast.success(`AI proposed ${list.length} new theme${list.length === 1 ? "" : "s"}.`);
    } catch (e) {
      console.error("suggest-themes error:", e);
      toast.error(e instanceof Error ? e.message : "Failed to fetch AI suggestions.");
    } finally { setSuggesting(false); }
  };

  const handleCreate = async (s: Suggestion) => {
    setCreating(s.theme_name);
    try {
      const { data: themeRow, error: insErr } = await supabase
        .from("themes").insert({ name: s.theme_name, description: s.rationale }).select("id").maybeSingle();
      if (insErr || !themeRow?.id) throw insErr || new Error("Insert failed");
      const rows = s.tickers.map(t => ({ theme_id: themeRow.id, ticker_symbol: t }));
      const { error: tErr } = await supabase.from("theme_tickers").insert(rows);
      if (tErr) throw tErr;
      setCreated(prev => new Set(prev).add(s.theme_name));
      toast.success(`Added "${s.theme_name}" with ${s.tickers.length} tickers.`);
      reloadThemes();
    } catch (e: any) {
      const msg = e?.message?.includes("authent") || e?.code === "42501"
        ? "Sign in required to add themes." : (e?.message || "Failed to create theme.");
      toast.error(msg);
    } finally { setCreating(null); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-['Syne',sans-serif]">
            <Layers size={16} className="text-primary" />
            Theme Distribution · {tabLabel}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Curated theme breakdown of <strong className="text-foreground">{totalCount}</strong> stocks matching your filters. Hover a slice for details, click to expand.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 py-2 lg:grid-cols-[1fr_320px]">
          {/* LEFT: Pie + legend + drill-down */}
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-card/50 p-3">
              {totalCount === 0 ? (
                <div className="flex h-[320px] items-center justify-center text-xs text-muted-foreground">
                  No stocks match the current filters.
                </div>
              ) : (
                <div className="h-[340px] w-full animate-fade-in">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={slices}
                        dataKey="count"
                        nameKey="name"
                        cx="50%" cy="50%" innerRadius={70} outerRadius={120} paddingAngle={1}
                        activeIndex={activeIndex ?? undefined}
                        activeShape={renderActiveShape}
                        onMouseEnter={(_, i) => setActiveIndex(i)}
                        onMouseLeave={() => setActiveIndex(null)}
                        onClick={(d: any) => setExpanded(prev => prev === d.name ? null : d.name)}
                        isAnimationActive
                      >
                        {slices.map((s, i) => (
                          <Cell key={i}
                            fill={s.isUnassigned ? UNASSIGNED_COLOR : SLICE_COLORS[i % SLICE_COLORS.length]}
                            stroke="hsl(var(--background))" strokeWidth={2} className="cursor-pointer" />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        cursor={false}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0].payload as Slice;
                          const top = d.stocks.slice(0, 5);
                          return (
                            <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-xl">
                              <div className="mb-1 flex items-center justify-between gap-3">
                                <span className="font-semibold text-foreground">{d.name}</span>
                                <span className="font-mono text-primary">{d.pct.toFixed(1)}%</span>
                              </div>
                              <div className="mb-2 text-[10px] text-muted-foreground">{d.count} stock{d.count === 1 ? "" : "s"}</div>
                              <div className="space-y-0.5 border-t border-border/50 pt-1.5">
                                {top.map(s => (
                                  <div key={s.symbol} className="flex items-center justify-between gap-3 text-[11px]">
                                    <span className="font-mono font-semibold text-foreground">{s.symbol}</span>
                                    <span className="font-mono text-muted-foreground">
                                      RS {s.rs !== null ? `${s.rs >= 0 ? "+" : ""}${s.rs.toFixed(1)}` : "—"} · #{s.rating ?? "—"}
                                    </span>
                                  </div>
                                ))}
                                {d.stocks.length > top.length && (
                                  <div className="pt-1 text-[10px] italic text-muted-foreground">
                                    +{d.stocks.length - top.length} more · click to expand
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}

              {slices.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2 border-t border-border/50 pt-2">
                  {slices.map((d, i) => {
                    const active = expanded === d.name;
                    return (
                      <button
                        key={d.name}
                        onMouseEnter={() => setActiveIndex(i)}
                        onMouseLeave={() => setActiveIndex(null)}
                        onClick={() => setExpanded(prev => prev === d.name ? null : d.name)}
                        className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] transition-all hover:scale-105 ${active ? "border-primary bg-primary/10" : "border-border bg-muted/20"}`}
                      >
                        <span className="h-2 w-2 rounded-full" style={{ background: d.isUnassigned ? UNASSIGNED_COLOR : SLICE_COLORS[i % SLICE_COLORS.length] }} />
                        <span className="font-medium text-foreground">{d.name}</span>
                        <span className="font-mono text-muted-foreground">{d.pct.toFixed(1)}% ({d.count})</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Drilldown */}
            {expandedSlice && (
              <div className="animate-fade-in rounded-lg border border-primary/30 bg-card p-3">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">{expandedSlice.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {expandedSlice.count} stocks · {expandedSlice.pct.toFixed(1)}% of selection
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => copySymbols(expandedSlice.stocks.map(s => s.symbol))}
                      className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/20"
                      title="Copy all tickers in this theme"
                    >
                      <Copy size={11} /> Copy
                    </button>
                    <button
                      onClick={() => downloadSymbols(expandedSlice.stocks.map(s => s.symbol), expandedSlice.name)}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[10px] font-medium text-foreground hover:bg-accent"
                      title="Download all tickers in this theme as .txt"
                    >
                      <Download size={11} /> .txt
                    </button>
                    <span className="hidden lg:inline text-[10px] font-medium text-muted-foreground px-1">
                      Export Theme to TradingView
                    </span>
                    <button
                      onClick={() => setExpanded(null)}
                      className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      Close
                    </button>
                  </div>
                </div>
                <div className="mb-2 text-[10px] italic text-muted-foreground">
                  Exports all {expandedSlice.count} tickers in this theme from the current timeframe list ({tabLabel}).
                </div>
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-border text-[10px] text-muted-foreground">
                        <th className="px-2 py-1 text-left">#</th>
                        <th className="px-2 py-1 text-left">Ticker</th>
                        <th className="px-2 py-1 text-center">Rating</th>
                        <th className="px-2 py-1 text-right">RS</th>
                        <th className="px-2 py-1 text-right">Return</th>
                        <th className="px-2 py-1 text-left">Industry</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expandedSlice.stocks.map((s, i) => (
                        <tr key={s.symbol} className="border-b border-border/40 hover:bg-muted/20">
                          <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                          <td className="px-2 py-1 font-mono font-semibold text-foreground">{s.symbol}</td>
                          <td className="px-2 py-1 text-center"><RsRatingBadge rating={s.rating} /></td>
                          <td className={`px-2 py-1 text-right font-mono ${s.rs !== null && s.rs >= 0 ? "text-[hsl(160,70%,50%)]" : "text-destructive/80"}`}>
                            {s.rs !== null ? `${s.rs >= 0 ? "+" : ""}${s.rs.toFixed(2)}%` : "—"}
                          </td>
                          <td className={`px-2 py-1 text-right font-mono ${s.ret !== null && s.ret >= 0 ? "text-[hsl(160,60%,55%)]" : "text-destructive/80"}`}>
                            {s.ret !== null ? `${s.ret >= 0 ? "+" : ""}${s.ret.toFixed(2)}%` : "—"}
                          </td>
                          <td className="px-2 py-1 text-muted-foreground">{s.industry ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: Filters + AI suggestions */}
          <div className="space-y-3">
            <div className="space-y-3 rounded-lg border border-border bg-muted/10 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Filters</div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-medium text-foreground">Min RS Rating</label>
                  <span className="font-mono text-primary">{minRating}</span>
                </div>
                <Slider min={1} max={99} step={1} value={[minRating]} onValueChange={(v) => setMinRating(v[0])} />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-medium text-foreground">Min ADR</label>
                  <span className="font-mono text-primary">{minAdr.toFixed(1)}%</span>
                </div>
                <Slider min={1} max={10} step={0.1} value={[minAdr]} onValueChange={(v) => setMinAdr(v[0])} />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-medium text-foreground">Top N</label>
                  <span className="font-mono text-primary">{topNLabel}</span>
                </div>
                <Slider min={TOPN_MIN} max={TOPN_MAX} step={1} value={[topN]} onValueChange={(v) => setTopN(v[0])} />
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {topNPresets.map(v => {
                    const label = v >= TOPN_MAX ? "All" : `${v}`;
                    const active = topN === v;
                    return (
                      <button key={v} onClick={() => setTopN(v)}
                        className={`rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors ${active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-2.5 py-1.5 text-xs cursor-pointer">
                <Checkbox checked={acceleratingOnly} onCheckedChange={(v) => setAcceleratingOnly(!!v)} />
                <span>
                  <span className="font-medium text-foreground">Accelerating Only</span>
                  <span className="block text-[10px] text-muted-foreground">1M RS &gt; 3M RS</span>
                </span>
              </label>

              <label className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-2.5 py-1.5 text-xs cursor-pointer">
                <Checkbox checked={excludeOtc} onCheckedChange={(v) => setExcludeOtc(!!v)} />
                <span>
                  <span className="font-medium text-foreground">Exclude OTC Stocks</span>
                  <span className="block text-[10px] text-muted-foreground">Hide foreign / pink sheets</span>
                </span>
              </label>

              <div className="rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-[11px] text-foreground">
                <span className="font-mono font-semibold text-primary">{totalCount}</span> stock{totalCount === 1 ? "" : "s"} across <span className="font-mono font-semibold text-primary">{slices.filter(s => !s.isUnassigned).length}</span> theme{slices.length === 1 ? "" : "s"}
              </div>
            </div>

            {/* AI Suggestions */}
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles size={14} className="text-primary" />
                <span className="text-sm font-semibold text-foreground">Discover New Themes</span>
              </div>
              <div className="mb-3 text-[11px] text-muted-foreground">
                <strong className="text-foreground">{unassignedSymbols.length}</strong> stocks here aren't in any of your{" "}
                <strong className="text-foreground">{curated.length}</strong> curated themes.
              </div>
              <button
                onClick={handleSuggest}
                disabled={suggesting || unassignedSymbols.length < 3}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-primary/60 bg-primary/15 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {suggesting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {suggesting ? "Analyzing with Groq…" : "Suggest New Themes with Groq"}
              </button>
            </div>

            {suggestions && suggestions.length > 0 && (
              <div className="space-y-2 animate-fade-in">
                {suggestions.map((s) => {
                  const isCreated = created.has(s.theme_name);
                  const isCreating = creating === s.theme_name;
                  return (
                    <div key={s.theme_name} className="rounded-lg border border-border bg-card p-3">
                      <div className="mb-1 text-sm font-semibold text-foreground">{s.theme_name}</div>
                      <div className="mb-2 text-[11px] italic text-muted-foreground">{s.rationale}</div>
                      <div className="mb-2 flex flex-wrap gap-1">
                        {s.tickers.map(t => (
                          <span key={t} className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground">{t}</span>
                        ))}
                      </div>
                      <button
                        onClick={() => handleCreate(s)}
                        disabled={isCreating || isCreated}
                        className={`inline-flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                          isCreated
                            ? "border-[hsl(160,70%,50%)]/40 bg-[hsl(160,70%,50%)]/10 text-[hsl(160,70%,50%)]"
                            : "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        {isCreating ? <Loader2 size={11} className="animate-spin" /> : isCreated ? <Check size={11} /> : <Plus size={11} />}
                        {isCreated ? "Added to Dashboard" : isCreating ? "Creating…" : "Create & Add to Dashboard"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
