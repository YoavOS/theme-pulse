import { useMemo, useState } from "react";
import { Copy, Download, ExternalLink, ListChecks, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { RsStock } from "@/hooks/useRsAlpha";
import type { StockFundamentals } from "@/hooks/useStockFundamentalsMap";
import {
  DEFAULT_GROWTH_FILTERS,
  GrowthFiltersState,
  passesAllActiveFilters,
  anyActive,
  passesGrowth,
  passesHighGrowth,
  passesONeil,
} from "@/lib/growthFilters";
import { computeRsRatings } from "@/components/rs/RsRatingBadge";
import RsRatingBadge from "@/components/rs/RsRatingBadge";

export type AnalyzerTab = "overall" | "1d" | "1w" | "1m" | "3m" | "6m";

export interface CoilScoreInfo {
  score: number | null;
  recentAvgRangePct?: number | null;
  baselineAvgRangePct?: number | null;
}

type SortBy =
  | "rs"
  | "rating"
  | "coil"
  | "return"
  | "marketCap"
  | "dollarVol"
  | "growth"
  | "input";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tabId: AnalyzerTab;
  tabLabel: string;
  /** Full qualified universe (already keyed by symbol). */
  universe: RsStock[];
  getRsForTab: (s: RsStock, t: AnalyzerTab) => number | null;
  getReturnField: (s: RsStock, t: AnalyzerTab) => number | null;
  isOtcSymbol: (sym: string) => boolean;
  fundamentalsMap?: Map<string, StockFundamentals>;
  coilScores?: Map<string, CoilScoreInfo>;
  coilShortDays?: number;
  coilLongDays?: number;
}

function parseTickers(raw: string): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of raw.split(/[\s,;|]+/)) {
    const t = tok.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function growthScore(f?: StockFundamentals): { score: number; emoji: string | null; label: string | null } {
  if (!f) return { score: 0, emoji: null, label: null };
  let s = 0;
  let emoji: string | null = null;
  let label: string | null = null;
  if (passesHighGrowth(f)) { s = 3; emoji = "🚀"; label = "High Growth"; }
  else if (passesGrowth(f)) { s = 2; emoji = "🔥"; label = "Growth Stock"; }
  else if (passesONeil(f)) { s = 1; emoji = "💎"; label = "O'Neil Growth"; }
  return { score: s, emoji, label };
}

const SORT_OPTIONS: { id: SortBy; label: string }[] = [
  { id: "rs", label: "RS Score (highest)" },
  { id: "rating", label: "RS Rating (highest)" },
  { id: "coil", label: "Tight Range / Coil (tightest)" },
  { id: "return", label: "Stock Return (highest)" },
  { id: "growth", label: "Fundamentals / Growth Strength" },
  { id: "marketCap", label: "Market Cap (largest)" },
  { id: "dollarVol", label: "Avg $ Volume (highest)" },
  { id: "input", label: "Original Input Order" },
];

export default function CustomListAnalyzerModal({
  open, onOpenChange, tabId, tabLabel, universe,
  getRsForTab, getReturnField, isOtcSymbol, fundamentalsMap,
  coilScores, coilShortDays, coilLongDays,
}: Props) {
  const [raw, setRaw] = useState<string>("");
  const [analyzed, setAnalyzed] = useState<boolean>(false);

  // Filters
  const [sortBy, setSortBy] = useState<SortBy>("rs");
  const [minRating, setMinRating] = useState<number>(0);
  const [minAdr, setMinAdr] = useState<number>(0);
  const [minMcapM, setMinMcapM] = useState<number>(0); // millions
  const [excludeOtc, setExcludeOtc] = useState<boolean>(true);
  const [hideMissing, setHideMissing] = useState<boolean>(false);
  const [growthFilters, setGrowthFilters] = useState<GrowthFiltersState>({ ...DEFAULT_GROWTH_FILTERS });
  const [coilFilterOn, setCoilFilterOn] = useState<boolean>(false);
  const [maxCoil, setMaxCoil] = useState<number>(0.85);

  const universeMap = useMemo(() => {
    const m = new Map<string, RsStock>();
    universe.forEach((s) => m.set(s.symbol.toUpperCase(), s));
    return m;
  }, [universe]);

  const inputTickers = useMemo(() => parseTickers(raw), [raw]);

  const fundamentalsAvailable = (fundamentalsMap?.size ?? 0) > 0;
  const coilAvailable = (coilScores?.size ?? 0) > 0;
  const growthActive = anyActive(growthFilters);

  // Compute matched stocks + ratings (rating computed within this list, not the global universe)
  const { rows, matched, missing, ratingMap } = useMemo(() => {
    const matchedStocks: RsStock[] = [];
    const missingTickers: string[] = [];
    const inputOrder = new Map<string, number>();
    inputTickers.forEach((t, i) => {
      inputOrder.set(t, i);
      const s = universeMap.get(t);
      if (s) matchedStocks.push(s);
      else missingTickers.push(t);
    });

    const rsValues = matchedStocks.map((s) => getRsForTab(s, tabId));
    const ratings = computeRsRatings(rsValues);
    const rMap = new Map<string, number | null>();
    matchedStocks.forEach((s, i) => rMap.set(s.symbol, ratings[i]));

    // Apply filters
    const filtered = matchedStocks.filter((s) => {
      const r = rMap.get(s.symbol);
      if (excludeOtc && isOtcSymbol(s.symbol)) return false;
      if (minRating > 0 && (r === null || r === undefined || r < minRating)) return false;
      if (minAdr > 0 && (s.adrPercent === null || s.adrPercent < minAdr)) return false;
      if (minMcapM > 0 && (s.marketCap === null || s.marketCap < minMcapM)) return false;
      if (growthActive) {
        const f = fundamentalsMap?.get(s.symbol);
        if (!passesAllActiveFilters(growthFilters, f)) return false;
      }
      if (coilFilterOn) {
        const c = coilScores?.get(s.symbol)?.score;
        if (c === null || c === undefined || !Number.isFinite(c)) return false;
        if (c > maxCoil) return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "rs": return (getRsForTab(b, tabId) ?? -999) - (getRsForTab(a, tabId) ?? -999);
        case "rating": return (rMap.get(b.symbol) ?? -1) - (rMap.get(a.symbol) ?? -1);
        case "coil": {
          const av = coilScores?.get(a.symbol)?.score ?? 999;
          const bv = coilScores?.get(b.symbol)?.score ?? 999;
          return av - bv;
        }
        case "return": return (getReturnField(b, tabId) ?? -999) - (getReturnField(a, tabId) ?? -999);
        case "marketCap": return (b.marketCap ?? -1) - (a.marketCap ?? -1);
        case "dollarVol": return (b.avgDollarVolume ?? -1) - (a.avgDollarVolume ?? -1);
        case "growth": {
          const ag = growthScore(fundamentalsMap?.get(a.symbol)).score;
          const bg = growthScore(fundamentalsMap?.get(b.symbol)).score;
          if (bg !== ag) return bg - ag;
          return (getRsForTab(b, tabId) ?? -999) - (getRsForTab(a, tabId) ?? -999);
        }
        case "input": return (inputOrder.get(a.symbol) ?? 0) - (inputOrder.get(b.symbol) ?? 0);
      }
    });

    return { rows: sorted, matched: matchedStocks, missing: missingTickers, ratingMap: rMap };
  }, [
    inputTickers, universeMap, tabId, getRsForTab, getReturnField, isOtcSymbol,
    minRating, minAdr, minMcapM, excludeOtc, growthFilters, growthActive,
    fundamentalsMap, coilFilterOn, maxCoil, coilScores, sortBy,
  ]);

  const visibleMissing = hideMissing ? [] : missing;
  const exportSymbols = rows.map((s) => s.symbol);

  const handleAnalyze = () => {
    if (inputTickers.length === 0) {
      toast.error("Paste at least one ticker.");
      return;
    }
    setAnalyzed(true);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportSymbols.join(","));
      toast.success(`${exportSymbols.length} symbols copied.`, { description: "Paste into TradingView → Import symbols." });
    } catch { toast.error("Could not copy."); }
  };

  const handleDownload = () => {
    const blob = new Blob([exportSymbols.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Analyzed_List_${exportSymbols.length}tickers.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${exportSymbols.length} symbols.`);
  };

  const handleOpenTV = () => {
    if (exportSymbols.length === 0) { toast.error("Nothing to open."); return; }
    const first = exportSymbols[0];
    window.open(`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(first)}`, "_blank", "noopener,noreferrer");
    void navigator.clipboard?.writeText(exportSymbols.join(",")).then(() => {
      toast.success("List copied — paste into TradingView Watchlist.");
    }).catch(() => {});
  };

  const handleReset = () => { setAnalyzed(false); };

  const pctDisplay = (v: number | null | undefined) =>
    v === null || v === undefined ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
  const fmtMcap = (v: number | null) => {
    if (v === null) return "—";
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}T`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(2)}B`;
    return `$${v.toFixed(0)}M`;
  };
  const fmtDollarVol = (v: number | null) => {
    if (v === null) return "—";
    if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    return `$${v.toFixed(0)}`;
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setAnalyzed(false); }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks size={18} /> Custom List Analyzer · {tabLabel}
          </DialogTitle>
          <DialogDescription>
            Paste any list of tickers, then sort &amp; filter using the same RS, Tight Range, Growth and Fundamentals data as the main view.
          </DialogDescription>
        </DialogHeader>

        {!analyzed ? (
          <div className="space-y-3">
            <label className="text-xs font-medium text-muted-foreground">Tickers (comma, space, or newline-separated)</label>
            <Textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={"AAPL, MSFT, NVDA\nTSLA AMD\nMETA, GOOGL"}
              className="min-h-[180px] font-mono text-sm"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{inputTickers.length} unique ticker{inputTickers.length === 1 ? "" : "s"} detected</span>
              <button
                onClick={handleAnalyze}
                disabled={inputTickers.length === 0}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Sparkles size={14} /> Analyze List
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Settings panel */}
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted/20 p-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Sort By</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option
                      key={o.id}
                      value={o.id}
                      disabled={(o.id === "coil" && !coilAvailable) || (o.id === "growth" && !fundamentalsAvailable)}
                    >
                      {o.label}{(o.id === "coil" && !coilAvailable) ? " (loading…)" : ""}{(o.id === "growth" && !fundamentalsAvailable) ? " (no fundamentals)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Min RS Rating: {minRating}</label>
                <Slider value={[minRating]} min={0} max={99} step={1} onValueChange={(v) => setMinRating(v[0])} />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Min ADR %: {minAdr.toFixed(1)}</label>
                <Slider value={[minAdr]} min={0} max={15} step={0.5} onValueChange={(v) => setMinAdr(v[0])} />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Min Market Cap ($M)</label>
                <Input
                  type="number"
                  value={minMcapM}
                  onChange={(e) => setMinMcapM(Math.max(0, Number(e.target.value) || 0))}
                  className="h-9 text-xs"
                  placeholder="0 = no limit"
                />
              </div>
              <div className="flex flex-col gap-2 pt-2">
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox checked={excludeOtc} onCheckedChange={(v) => setExcludeOtc(!!v)} /> Exclude OTC
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox checked={hideMissing} onCheckedChange={(v) => setHideMissing(!!v)} /> Hide unmatched tickers
                </label>
              </div>
              <div className="flex flex-col gap-1.5 pt-2">
                <span className="text-[11px] font-medium text-muted-foreground">Growth Filters</span>
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox checked={growthFilters.growth} onCheckedChange={(v) => setGrowthFilters({ ...growthFilters, growth: !!v })} disabled={!fundamentalsAvailable} /> 🔥 Growth
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox checked={growthFilters.highGrowth} onCheckedChange={(v) => setGrowthFilters({ ...growthFilters, highGrowth: !!v })} disabled={!fundamentalsAvailable} /> 🚀 High Growth
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox checked={growthFilters.oneil} onCheckedChange={(v) => setGrowthFilters({ ...growthFilters, oneil: !!v })} disabled={!fundamentalsAvailable} /> 💎 O'Neil
                </label>
              </div>
              <div className="md:col-span-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs">
                    <Checkbox checked={coilFilterOn} onCheckedChange={(v) => setCoilFilterOn(!!v)} disabled={!coilAvailable} />
                    Tight Range / Coil filter {coilShortDays && coilLongDays ? `(${coilShortDays}d / ${coilLongDays}d)` : ""}
                  </label>
                  <span className="font-mono text-xs text-muted-foreground">≤ {maxCoil.toFixed(2)}x</span>
                </div>
                <Slider value={[maxCoil]} min={0.4} max={1.5} step={0.05} onValueChange={(v) => setMaxCoil(v[0])} disabled={!coilFilterOn || !coilAvailable} className="mt-1" />
              </div>
            </div>

            {/* Summary + actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <span><span className="font-semibold text-foreground">{rows.length}</span> shown</span>
                <span className="text-muted-foreground">· {matched.length} matched in universe · {missing.length} unmatched · {inputTickers.length} input</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={handleReset} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent">← Edit list</button>
                <button onClick={handleCopy} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"><Copy size={12} /> Copy</button>
                <button onClick={handleDownload} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"><Download size={12} /> .txt</button>
                <button onClick={handleOpenTV} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"><ExternalLink size={12} /> Open in TradingView</button>
              </div>
            </div>

            {/* Preview table */}
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/40 backdrop-blur">
                    <tr className="border-b border-border">
                      <th className="px-2 py-2 text-left text-muted-foreground">#</th>
                      <th className="px-2 py-2 text-left text-muted-foreground">Ticker</th>
                      <th className="px-2 py-2 text-center text-muted-foreground">Rating</th>
                      <th className="px-2 py-2 text-left text-muted-foreground">Company</th>
                      <th className="px-2 py-2 text-right text-muted-foreground">RS</th>
                      <th className="px-2 py-2 text-right text-muted-foreground">Return</th>
                      <th className="px-2 py-2 text-right text-muted-foreground">Coil</th>
                      <th className="px-2 py-2 text-right text-muted-foreground">ADR%</th>
                      <th className="px-2 py-2 text-right text-muted-foreground">Mkt Cap</th>
                      <th className="px-2 py-2 text-right text-muted-foreground">$Vol</th>
                      <th className="px-2 py-2 text-center text-muted-foreground">Growth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s, idx) => {
                      const rs = getRsForTab(s, tabId);
                      const ret = getReturnField(s, tabId);
                      const rating = ratingMap.get(s.symbol) ?? null;
                      const coil = coilScores?.get(s.symbol)?.score ?? null;
                      const g = growthScore(fundamentalsMap?.get(s.symbol));
                      return (
                        <tr key={s.symbol} className="border-b border-border/40 hover:bg-muted/20">
                          <td className="px-2 py-1.5 text-muted-foreground">{idx + 1}</td>
                          <td className="px-2 py-1.5 font-mono font-semibold">{s.symbol}</td>
                          <td className="px-2 py-1.5 text-center"><RsRatingBadge rating={rating} /></td>
                          <td className="px-2 py-1.5 max-w-[200px] truncate text-muted-foreground" title={s.companyName ?? ""}>{s.companyName ?? "—"}</td>
                          <td className={`px-2 py-1.5 text-right font-mono ${rs !== null && rs >= 0 ? "text-[hsl(160,60%,55%)]" : "text-destructive/80"}`}>{pctDisplay(rs)}</td>
                          <td className={`px-2 py-1.5 text-right font-mono ${ret !== null && ret >= 0 ? "text-[hsl(160,60%,55%)]" : "text-destructive/80"}`}>{pctDisplay(ret)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{coil !== null ? `${coil.toFixed(2)}x` : "—"}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{s.adrPercent !== null ? `${s.adrPercent.toFixed(1)}%` : "—"}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{fmtMcap(s.marketCap)}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{fmtDollarVol(s.avgDollarVolume)}</td>
                          <td className="px-2 py-1.5 text-center" title={g.label ?? ""}>{g.emoji ?? <span className="text-muted-foreground">—</span>}</td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && (
                      <tr><td colSpan={11} className="px-2 py-6 text-center text-muted-foreground">No tickers match the current filters.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {visibleMissing.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                <span className="font-semibold text-amber-500">{visibleMissing.length} ticker{visibleMissing.length === 1 ? "" : "s"} not in qualified universe:</span>{" "}
                <span className="font-mono text-muted-foreground">{visibleMissing.join(", ")}</span>
                <div className="mt-1 text-[10px] text-muted-foreground">These are excluded from sorting/export. Run "Update Stock List" to expand the universe.</div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
