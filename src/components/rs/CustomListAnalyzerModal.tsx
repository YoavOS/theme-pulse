import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { Copy, Download, ExternalLink, ListChecks, Sparkles, Upload, FileText, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { RsStock } from "@/hooks/useRsAlpha";
import { supabase } from "@/integrations/supabase/client";
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
import { useDailyCandles } from "@/hooks/useDailyCandles";

export type AnalyzerTab = "overall" | "1d" | "1w" | "1m" | "3m" | "6m";

export interface CoilScoreInfo {
  score: number | null;
  recentAvgRangePct?: number | null;
  baselineAvgRangePct?: number | null;
}

export interface EmaDistanceInfo {
  dist9d: number | null;
  dist21d: number | null;
  dist9w: number | null;
  ema9d?: number | null;
  ema21d?: number | null;
  ema9w?: number | null;
  price?: number | null;
}

interface EmaInfo {
  ema9d: number | null;
  ema21d: number | null;
  ema9w: number | null;
  dist9d: number | null;
  dist21d: number | null;
  dist9w: number | null;
  price: number | null;
}

type SortBy =
  | "rs"
  | "rating"
  | "ema9d"
  | "ema21d"
  | "ema9w"
  | "coil"
  | "return"
  | "marketCap"
  | "dollarVol"
  | "growth"
  | "input";

const RS_TABS: { id: AnalyzerTab; label: string }[] = [
  { id: "overall", label: "Overall RS" },
  { id: "1d", label: "1 Day RS" },
  { id: "1w", label: "1 Week RS" },
  { id: "1m", label: "1 Month RS" },
  { id: "3m", label: "3 Months RS" },
  { id: "6m", label: "6 Months RS" },
];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tabId: AnalyzerTab;
  tabLabel: string;
  universe: RsStock[];
  getRsForTab: (s: RsStock, t: AnalyzerTab) => number | null;
  getReturnField: (s: RsStock, t: AnalyzerTab) => number | null;
  isOtcSymbol: (sym: string) => boolean;
  fundamentalsMap?: Map<string, StockFundamentals>;
  coilScores?: Map<string, CoilScoreInfo>;
  coilShortDays?: number;
  coilLongDays?: number;
  /** Pre-loaded EMA distances from the parent (for instant rendering when available). */
  emaDistances?: Map<string, EmaDistanceInfo>;
}

// Strip exchange prefixes (NYSE:, NASDAQ:, AMEX:, BATS:, ARCA:, CBOE:, OTC:, etc.)
// and any common TradingView decorations.
function cleanTicker(raw: string): string {
  let t = raw.trim().toUpperCase();
  // Drop exchange prefix before colon
  const colonIdx = t.indexOf(":");
  if (colonIdx >= 0) t = t.slice(colonIdx + 1);
  // Strip any quotes/brackets/whitespace
  t = t.replace(/[^A-Z0-9.\-]/g, "");
  return t;
}

function parseTickers(raw: string): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of raw.split(/[\s,;|]+/)) {
    const t = cleanTicker(tok);
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
  { id: "ema9d", label: "Closest to 9D EMA (smallest |distance|)" },
  { id: "ema21d", label: "Closest to 21D EMA (smallest |distance|)" },
  { id: "ema9w", label: "Closest to 9W EMA (smallest |distance|)" },
  { id: "coil", label: "Tight Range / Coil (tightest)" },
  { id: "return", label: "Stock Return (highest)" },
  { id: "growth", label: "Fundamentals / Growth Strength" },
  { id: "marketCap", label: "Market Cap (largest)" },
  { id: "dollarVol", label: "Avg $ Volume (highest)" },
  { id: "input", label: "Original Input Order" },
];

function emaColor(d: number | null | undefined): string {
  if (d === null || d === undefined) return "text-muted-foreground";
  const a = Math.abs(d);
  if (a <= 2) return "text-[hsl(140,70%,55%)] font-semibold";
  if (a <= 5) return "text-[hsl(160,55%,55%)]";
  if (a <= 10) return "text-foreground";
  return d >= 0 ? "text-amber-400" : "text-destructive/80";
}

export default function CustomListAnalyzerModal({
  open, onOpenChange, tabId, tabLabel, universe,
  getRsForTab, getReturnField, isOtcSymbol, fundamentalsMap,
  coilScores, coilShortDays, coilLongDays,
}: Props) {
  const [raw, setRaw] = useState<string>("");
  const [analyzed, setAnalyzed] = useState<boolean>(false);
  const [dragOver, setDragOver] = useState<boolean>(false);
  const [lastFileName, setLastFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // RS timeframe used for filter + sort (defaults to current tab; user can override)
  const [filterRsTab, setFilterRsTab] = useState<AnalyzerTab>(tabId);
  useEffect(() => { setFilterRsTab(tabId); }, [tabId]);

  // Filters
  const [sortBy, setSortBy] = useState<SortBy>("rs");
  const [minRating, setMinRating] = useState<number>(0);
  const [minAdr, setMinAdr] = useState<number>(0);
  const [minMcapM, setMinMcapM] = useState<number>(0);
  const [excludeOtc, setExcludeOtc] = useState<boolean>(true);
  const [hideMissing, setHideMissing] = useState<boolean>(false);
  const [growthFilters, setGrowthFilters] = useState<GrowthFiltersState>({ ...DEFAULT_GROWTH_FILTERS });
  const [coilFilterOn, setCoilFilterOn] = useState<boolean>(false);
  const [maxCoil, setMaxCoil] = useState<number>(0.85);

  // EMA filters (9D, 21D, 9W)
  const [ema9dFilterOn, setEma9dFilterOn] = useState<boolean>(false);
  const [maxEma9dAbs, setMaxEma9dAbs] = useState<number>(3);
  const [ema21dFilterOn, setEma21dFilterOn] = useState<boolean>(false);
  const [maxEma21dAbs, setMaxEma21dAbs] = useState<number>(3);
  const [ema9wFilterOn, setEma9wFilterOn] = useState<boolean>(false);
  const [maxEma9wAbs, setMaxEma9wAbs] = useState<number>(5);
  const [emaFilterMode, setEmaFilterMode] = useState<"AND" | "OR">("OR");
  const [emaMap, setEmaMap] = useState<Map<string, EmaInfo>>(new Map());
  const [emaLoading, setEmaLoading] = useState<boolean>(false);
  // Price-vs-EMA direction filters
  const [priceVs9dOn, setPriceVs9dOn] = useState<boolean>(false);
  const [priceVs9dDir, setPriceVs9dDir] = useState<"above" | "below">("above");
  const [priceVs21dOn, setPriceVs21dOn] = useState<boolean>(false);
  const [priceVs21dDir, setPriceVs21dDir] = useState<"above" | "below">("above");
  const [priceVs9wOn, setPriceVs9wOn] = useState<boolean>(false);
  const [priceVs9wDir, setPriceVs9wDir] = useState<"above" | "below">("above");
  const emaAvailable = emaMap.size > 0;
  const activeEmaFilters =
    (ema9dFilterOn ? 1 : 0) + (ema21dFilterOn ? 1 : 0) + (ema9wFilterOn ? 1 : 0);

  const universeMap = useMemo(() => {
    const m = new Map<string, RsStock>();
    universe.forEach((s) => m.set(s.symbol.toUpperCase(), s));
    return m;
  }, [universe]);

  const inputTickers = useMemo(() => parseTickers(raw), [raw]);

  const fundamentalsAvailable = (fundamentalsMap?.size ?? 0) > 0;
  const coilAvailable = (coilScores?.size ?? 0) > 0;
  const growthActive = anyActive(growthFilters);

  // ---------- File upload ----------
  const ingestFile = useCallback(async (file: File) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File too large (max 5MB).");
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseTickers(text);
      if (parsed.length === 0) {
        toast.error("No tickers found in file.");
        return;
      }
      setRaw(parsed.join(", "));
      setLastFileName(file.name);
      toast.success(`Loaded ${parsed.length} tickers successfully`, { description: file.name });
    } catch (e) {
      toast.error("Could not read file.", { description: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void ingestFile(f);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void ingestFile(f);
  };

  // ---------- Fetch EMA distances (9D / 21D / 9W) on Analyze ----------
  const fetchEmaForSymbols = useCallback(async (symbols: string[]) => {
    if (symbols.length === 0) return;
    setEmaLoading(true);
    try {
      const next = new Map(emaMap);
      const need = symbols.filter((s) => !next.has(s));
      if (need.length === 0) { setEmaLoading(false); return; }
      const CHUNK = 200;
      for (let i = 0; i < need.length; i += CHUNK) {
        const slice = need.slice(i, i + CHUNK);
        const { data, error } = await supabase.functions.invoke("ema-distances", { body: { symbols: slice } });
        if (error) throw new Error(error.message);
        const rows = (data as { rows?: Array<{ symbol: string; ema9d: number | null; ema21d: number | null; ema9w: number | null; price: number | null; dist9d: number | null; dist21d: number | null; dist9w: number | null }> })?.rows ?? [];
        for (const r of rows) {
          next.set(r.symbol.toUpperCase(), {
            ema9d: r.ema9d, ema21d: r.ema21d, ema9w: r.ema9w,
            dist9d: r.dist9d, dist21d: r.dist21d, dist9w: r.dist9w,
            price: r.price,
          });
        }
        setEmaMap(new Map(next));
      }
      const scored = Array.from(next.values()).filter((v) => v.dist9w !== null || v.dist21d !== null || v.dist9d !== null).length;
      toast.success(`EMA distances loaded for ${scored} stocks.`);
    } catch (e) {
      toast.error("EMA distances fetch failed.", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setEmaLoading(false);
    }
  }, [emaMap]);

  // Compute matched stocks + ratings
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

    // Ratings computed against the SELECTED filter timeframe (not display tab)
    const rsValues = matchedStocks.map((s) => getRsForTab(s, filterRsTab));
    const ratings = computeRsRatings(rsValues);
    const rMap = new Map<string, number | null>();
    matchedStocks.forEach((s, i) => rMap.set(s.symbol, ratings[i]));

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
      if (activeEmaFilters > 0) {
        const e = emaMap.get(s.symbol);
        const checks: Array<boolean> = [];
        if (ema9dFilterOn) {
          const d = e?.dist9d;
          checks.push(d !== null && d !== undefined && Number.isFinite(d) && Math.abs(d) <= maxEma9dAbs);
        }
        if (ema21dFilterOn) {
          const d = e?.dist21d;
          checks.push(d !== null && d !== undefined && Number.isFinite(d) && Math.abs(d) <= maxEma21dAbs);
        }
        if (ema9wFilterOn) {
          const d = e?.dist9w;
          checks.push(d !== null && d !== undefined && Number.isFinite(d) && Math.abs(d) <= maxEma9wAbs);
        }
        const pass = emaFilterMode === "OR" ? checks.some(Boolean) : checks.every(Boolean);
        if (!pass) return false;
      }
      // Price vs EMA direction filters (sign of dist: >0 above, <0 below)
      const e2 = emaMap.get(s.symbol);
      const priceVsChecks: Array<{ on: boolean; dist: number | null | undefined; dir: "above" | "below" }> = [
        { on: priceVs9dOn, dist: e2?.dist9d, dir: priceVs9dDir },
        { on: priceVs21dOn, dist: e2?.dist21d, dir: priceVs21dDir },
        { on: priceVs9wOn, dist: e2?.dist9w, dir: priceVs9wDir },
      ];
      for (const c of priceVsChecks) {
        if (!c.on) continue;
        if (c.dist === null || c.dist === undefined || !Number.isFinite(c.dist)) return false;
        if (c.dir === "above" && !(c.dist > 0)) return false;
        if (c.dir === "below" && !(c.dist < 0)) return false;
      }
      return true;
    });

    const absDist = (v: number | null | undefined) => (v === null || v === undefined ? Infinity : Math.abs(v));

    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "rs": return (getRsForTab(b, filterRsTab) ?? -999) - (getRsForTab(a, filterRsTab) ?? -999);
        case "rating": return (rMap.get(b.symbol) ?? -1) - (rMap.get(a.symbol) ?? -1);
        case "ema9d": return absDist(emaMap.get(a.symbol)?.dist9d) - absDist(emaMap.get(b.symbol)?.dist9d);
        case "ema21d": return absDist(emaMap.get(a.symbol)?.dist21d) - absDist(emaMap.get(b.symbol)?.dist21d);
        case "ema9w": return absDist(emaMap.get(a.symbol)?.dist9w) - absDist(emaMap.get(b.symbol)?.dist9w);
        case "coil": {
          const av = coilScores?.get(a.symbol)?.score ?? 999;
          const bv = coilScores?.get(b.symbol)?.score ?? 999;
          return av - bv;
        }
        case "return": return (getReturnField(b, filterRsTab) ?? -999) - (getReturnField(a, filterRsTab) ?? -999);
        case "marketCap": return (b.marketCap ?? -1) - (a.marketCap ?? -1);
        case "dollarVol": return (b.avgDollarVolume ?? -1) - (a.avgDollarVolume ?? -1);
        case "growth": {
          const ag = growthScore(fundamentalsMap?.get(a.symbol)).score;
          const bg = growthScore(fundamentalsMap?.get(b.symbol)).score;
          if (bg !== ag) return bg - ag;
          return (getRsForTab(b, filterRsTab) ?? -999) - (getRsForTab(a, filterRsTab) ?? -999);
        }
        case "input": return (inputOrder.get(a.symbol) ?? 0) - (inputOrder.get(b.symbol) ?? 0);
      }
    });

    return { rows: sorted, matched: matchedStocks, missing: missingTickers, ratingMap: rMap };
  }, [
    inputTickers, universeMap, filterRsTab, getRsForTab, getReturnField, isOtcSymbol,
    minRating, minAdr, minMcapM, excludeOtc, growthFilters, growthActive,
    fundamentalsMap, coilFilterOn, maxCoil, coilScores,
    activeEmaFilters, ema9dFilterOn, ema21dFilterOn, ema9wFilterOn,
    maxEma9dAbs, maxEma21dAbs, maxEma9wAbs, emaFilterMode, emaMap, sortBy,
    priceVs9dOn, priceVs9dDir, priceVs21dOn, priceVs21dDir, priceVs9wOn, priceVs9wDir,
  ]);

  const visibleMissing = hideMissing ? [] : missing;
  const exportSymbols = rows.map((s) => s.symbol);

  const handleAnalyze = () => {
    if (inputTickers.length === 0) { toast.error("Paste at least one ticker."); return; }
    setAnalyzed(true);
    // Kick off EMA fetch for matched symbols in universe (skip ones that won't be displayed anyway)
    const matchedSyms = inputTickers.filter((t) => universeMap.has(t));
    void fetchEmaForSymbols(matchedSyms);
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
    a.href = url; a.download = `Analyzed_List_${exportSymbols.length}tickers.txt`;
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
            Paste, upload (.txt) or drop a TradingView list. Exchange prefixes like <code>NYSE:</code> / <code>NASDAQ:</code> are stripped automatically.
          </DialogDescription>
        </DialogHeader>

        {!analyzed ? (
          <div className="space-y-3">
            {/* Drag & drop / upload zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`flex items-center justify-between gap-3 rounded-lg border-2 border-dashed p-3 text-xs transition ${dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/20"}`}
            >
              <div className="flex items-center gap-2 text-muted-foreground">
                <Upload size={16} />
                <span>Drag &amp; drop a <code>.txt</code> here, or</span>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-accent"
                >
                  <FileText size={12} /> Upload File
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,text/plain,.csv,text/csv"
                  className="hidden"
                  onChange={handleFileInput}
                />
                {lastFileName && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded bg-background px-2 py-0.5 font-mono text-[10px]">
                    {lastFileName}
                    <button onClick={() => { setLastFileName(null); setRaw(""); }} className="text-muted-foreground hover:text-foreground"><X size={10} /></button>
                  </span>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground">Supports TradingView exports (NYSE:DAN,NASDAQ:TSEM,…)</span>
            </div>

            <label className="text-xs font-medium text-muted-foreground">Or paste tickers (comma, space, newline-separated)</label>
            <Textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={"NYSE:DAN,NASDAQ:TSEM,NYSE:CIEN\nAAPL MSFT NVDA\nTSLA, AMD"}
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
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">RS Timeframe (filter &amp; sort)</label>
                <select
                  value={filterRsTab}
                  onChange={(e) => setFilterRsTab(e.target.value as AnalyzerTab)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  {RS_TABS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Sort By</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  {SORT_OPTIONS.map((o) => {
                    const isEma = o.id === "ema9d" || o.id === "ema21d" || o.id === "ema9w";
                    return (
                      <option
                        key={o.id}
                        value={o.id}
                        disabled={
                          (o.id === "coil" && !coilAvailable) ||
                          (o.id === "growth" && !fundamentalsAvailable) ||
                          (isEma && !emaAvailable && !emaLoading)
                        }
                      >
                        {o.label}
                        {o.id === "coil" && !coilAvailable ? " (loading…)" : ""}
                        {o.id === "growth" && !fundamentalsAvailable ? " (no fundamentals)" : ""}
                        {isEma && emaLoading && !emaAvailable ? " (loading…)" : ""}
                      </option>
                    );
                  })}
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

              {/* EMA distance filters (9D / 21D / 9W) with AND/OR mode */}
              <div className="md:col-span-3 space-y-2 rounded-md border border-border/60 bg-muted/10 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-muted-foreground inline-flex items-center gap-1">
                    EMA Pullback Filters
                    {emaLoading && <Loader2 size={11} className="animate-spin" />}
                  </span>
                  {activeEmaFilters >= 2 && (
                    <div className="inline-flex overflow-hidden rounded-md border border-border text-[10px]">
                      <button
                        type="button"
                        onClick={() => setEmaFilterMode("OR")}
                        className={`px-2 py-1 ${emaFilterMode === "OR" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
                      >Match ANY (OR)</button>
                      <button
                        type="button"
                        onClick={() => setEmaFilterMode("AND")}
                        className={`px-2 py-1 ${emaFilterMode === "AND" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}
                      >Match ALL (AND)</button>
                    </div>
                  )}
                </div>
                {([
                  { on: ema9dFilterOn, setOn: setEma9dFilterOn, max: maxEma9dAbs, setMax: setMaxEma9dAbs, label: "9D EMA" },
                  { on: ema21dFilterOn, setOn: setEma21dFilterOn, max: maxEma21dAbs, setMax: setMaxEma21dAbs, label: "21D EMA" },
                  { on: ema9wFilterOn, setOn: setEma9wFilterOn, max: maxEma9wAbs, setMax: setMaxEma9wAbs, label: "9W EMA" },
                ] as const).map((row) => (
                  <div key={row.label} className="grid grid-cols-12 items-center gap-2">
                    <label className="col-span-4 flex items-center gap-2 text-xs">
                      <Checkbox checked={row.on} onCheckedChange={(v) => row.setOn(!!v)} disabled={!emaAvailable && !emaLoading} />
                      Distance to {row.label}
                    </label>
                    <div className="col-span-7">
                      <Slider value={[row.max]} min={0.5} max={20} step={0.5} onValueChange={(v) => row.setMax(v[0])} disabled={!row.on || (!emaAvailable && !emaLoading)} />
                    </div>
                    <span className="col-span-1 text-right font-mono text-[10px] text-muted-foreground">±{row.max.toFixed(1)}%</span>
                  </div>
                ))}
              </div>

              {/* Price vs EMA direction filters */}
              <div className="md:col-span-3 space-y-2 rounded-md border border-border/60 bg-muted/10 p-2">
                <span className="text-[11px] font-semibold text-muted-foreground">Price vs EMA</span>
                {([
                  { key: "9d", on: priceVs9dOn, dir: priceVs9dDir, setOn: setPriceVs9dOn, setDir: setPriceVs9dDir, label: "9 EMA" },
                  { key: "21d", on: priceVs21dOn, dir: priceVs21dDir, setOn: setPriceVs21dOn, setDir: setPriceVs21dDir, label: "21 EMA" },
                  { key: "9w", on: priceVs9wOn, dir: priceVs9wDir, setOn: setPriceVs9wOn, setDir: setPriceVs9wDir, label: "9 Week EMA" },
                ] as const).map((row) => (
                  <div key={row.key} className="flex items-center justify-between text-xs">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox checked={row.on} onCheckedChange={(v) => row.setOn(!!v)} disabled={!emaAvailable && !emaLoading} />
                      Price {row.dir} {row.label}
                    </label>
                    <div className="inline-flex overflow-hidden rounded-md border border-border text-[10px]">
                      <button type="button" onClick={() => row.setDir("above")} disabled={!row.on}
                        className={`px-2 py-0.5 ${row.dir === "above" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"} disabled:opacity-40`}>
                        Above
                      </button>
                      <button type="button" onClick={() => row.setDir("below")} disabled={!row.on}
                        className={`px-2 py-0.5 ${row.dir === "below" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"} disabled:opacity-40`}>
                        Below
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>


            {/* Summary + actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <span><span className="font-semibold text-foreground">{rows.length}</span> shown</span>
                <span className="text-muted-foreground">· {matched.length} matched in universe · {missing.length} unmatched · {inputTickers.length} input</span>
                {emaLoading && <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 size={11} className="animate-spin" /> EMA distances loading…</span>}
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
                      <th className="px-2 py-2 text-right text-muted-foreground" title="Distance from current price to 9-Day EMA">9D EMA Δ</th>
                      <th className="px-2 py-2 text-right text-muted-foreground" title="Distance from current price to 21-Day EMA">21D EMA Δ</th>
                      <th className="px-2 py-2 text-right text-muted-foreground" title="Distance from current price to 9-Week EMA">9W EMA Δ</th>
                      <th className="px-2 py-2 text-right text-muted-foreground">Coil</th>
                      <th className="px-2 py-2 text-right text-muted-foreground">ADR%</th>
                      <th className="px-2 py-2 text-right text-muted-foreground">Mkt Cap</th>
                      <th className="px-2 py-2 text-right text-muted-foreground">$Vol</th>
                      <th className="px-2 py-2 text-center text-muted-foreground">Growth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s, idx) => {
                      const rs = getRsForTab(s, filterRsTab);
                      const ret = getReturnField(s, filterRsTab);
                      const rating = ratingMap.get(s.symbol) ?? null;
                      const coil = coilScores?.get(s.symbol)?.score ?? null;
                      const ema = emaMap.get(s.symbol);
                      const g = growthScore(fundamentalsMap?.get(s.symbol));
                      const emaCell = (d: number | null | undefined, ref: number | null | undefined, label: string) => (
                        <td className={`px-2 py-1.5 text-right font-mono ${emaColor(d ?? null)}`} title={ref ? `${label}: ${ref}` : ""}>
                          {d === null || d === undefined ? (emaLoading ? "…" : "—") : pctDisplay(d)}
                        </td>
                      );
                      return (
                        <tr key={s.symbol} className="border-b border-border/40 hover:bg-muted/20">
                          <td className="px-2 py-1.5 text-muted-foreground">{idx + 1}</td>
                          <td className="px-2 py-1.5 font-mono font-semibold">{s.symbol}</td>
                          <td className="px-2 py-1.5 text-center"><RsRatingBadge rating={rating} /></td>
                          <td className="px-2 py-1.5 max-w-[200px] truncate text-muted-foreground" title={s.companyName ?? ""}>{s.companyName ?? "—"}</td>
                          <td className={`px-2 py-1.5 text-right font-mono ${rs !== null && rs >= 0 ? "text-[hsl(160,60%,55%)]" : "text-destructive/80"}`}>{pctDisplay(rs)}</td>
                          <td className={`px-2 py-1.5 text-right font-mono ${ret !== null && ret >= 0 ? "text-[hsl(160,60%,55%)]" : "text-destructive/80"}`}>{pctDisplay(ret)}</td>
                          {emaCell(ema?.dist9d, ema?.ema9d, "9D EMA")}
                          {emaCell(ema?.dist21d, ema?.ema21d, "21D EMA")}
                          {emaCell(ema?.dist9w, ema?.ema9w, "9W EMA")}
                          <td className="px-2 py-1.5 text-right font-mono">{coil !== null ? `${coil.toFixed(2)}x` : "—"}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{s.adrPercent !== null ? `${s.adrPercent.toFixed(1)}%` : "—"}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{fmtMcap(s.marketCap)}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{fmtDollarVol(s.avgDollarVolume)}</td>
                          <td className="px-2 py-1.5 text-center" title={g.label ?? ""}>{g.emoji ?? <span className="text-muted-foreground">—</span>}</td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && (
                      <tr><td colSpan={14} className="px-2 py-6 text-center text-muted-foreground">No tickers match the current filters.</td></tr>
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
