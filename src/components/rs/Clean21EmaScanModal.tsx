import { useEffect, useMemo, useState } from "react";
import { Copy, Download, Loader2, Play, Save, PieChart as PieChartIcon, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Sector } from "recharts";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { gicsForIndustry } from "@/lib/sectorTaxonomy";
import GroupConcentrationPanel, { type ConcentrationItem } from "@/components/shared/GroupConcentrationPanel";
import type { GroupMode } from "@/lib/groupColors";
import { useCuratedThemes } from "@/hooks/useCuratedThemes";
import type { RsStock } from "@/hooks/useRsAlpha";
import type { FundamentalsData } from "@/hooks/useFundamentals";

type EmaLength = 9 | 21 | 50 | 200;
type EmaTimeframe = "daily" | "weekly";
type SortKey = "gain" | "rating" | "fundamentals" | "emaDistance";

interface Clean21EmaRow {
  symbol: string;
  gainPct: number;
  latestClose: number | null;
  startClose: number | null;
  ema21: number | null;
  emaValue?: number | null;
  emaLength?: EmaLength;
  timeframe?: EmaTimeframe;
  daysWithoutBelow?: number;
  periodsWithoutBelow?: number;
  source: "cache" | "yahoo" | "none";
}

interface SavedScan {
  at: number;
  emaLength: EmaLength;
  timeframe: EmaTimeframe;
  minGainPct: number;
  minPeriod: number;
  rows: Clean21EmaRow[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  universe: RsStock[];
  ratingMap?: Map<string, number | null>;
}

const LS_KEY = "rs-clean-ema-uptrend-v4";

const SLICE_COLORS = [
  "hsl(160, 70%, 50%)", "hsl(200, 80%, 55%)", "hsl(280, 65%, 60%)",
  "hsl(30, 85%, 55%)",  "hsl(340, 75%, 60%)", "hsl(50, 85%, 55%)",
  "hsl(180, 70%, 50%)", "hsl(260, 70%, 65%)", "hsl(15, 80%, 60%)",
  "hsl(100, 55%, 50%)", "hsl(220, 70%, 60%)", "hsl(320, 60%, 60%)",
];

function readSaved(): SavedScan | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) as SavedScan : null;
  } catch {
    return null;
  }
}

function writeSaved(scan: SavedScan) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(scan)); } catch { /* ignore quota */ }
}

function emaDistancePct(row: Clean21EmaRow): number | null {
  const ema = row.emaValue ?? row.ema21;
  if (!ema || !row.latestClose) return null;
  return ((row.latestClose - ema) / ema) * 100;
}

function fundamentalScoreColor(score: number | null): string {
  if (score === null || score === undefined) return "text-muted-foreground";
  if (score >= 70) return "text-primary";
  if (score >= 50) return "text-gain-medium";
  if (score >= 30) return "text-[#f5a623]";
  return "text-destructive";
}

export default function Clean21EmaScanModal({ open, onOpenChange, universe, ratingMap }: Props) {
  const [emaLength, setEmaLength] = useState<EmaLength>(21);
  const [timeframe, setTimeframe] = useState<EmaTimeframe>("daily");
  const [minGainPct, setMinGainPct] = useState(70);
  const [minPeriod, setMinPeriod] = useState(60);
  const [rows, setRows] = useState<Clean21EmaRow[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("gain");
  const [activeSliceIdx, setActiveSliceIdx] = useState<number | null>(null);
  const [expandedSector, setExpandedSector] = useState<string | null>(null);
  const [fundMap, setFundMap] = useState<Record<string, FundamentalsData>>({});
  const [fundRunning, setFundRunning] = useState(false);
  const [fundProgress, setFundProgress] = useState<{ done: number; total: number } | null>(null);

  const symbols = useMemo(
    () => Array.from(new Set(universe.map((s) => s.symbol).filter(Boolean))).sort(),
    [universe],
  );

  const universeMap = useMemo(() => {
    const m = new Map<string, RsStock>();
    for (const s of universe) m.set(s.symbol, s);
    return m;
  }, [universe]);

  useEffect(() => {
    const saved = readSaved();
    if (!saved) return;
    setEmaLength(saved.emaLength ?? 21);
    setTimeframe(saved.timeframe ?? "daily");
    setMinGainPct(saved.minGainPct);
    setMinPeriod(saved.minPeriod ?? 60);
    setRows(saved.rows ?? []);
    setSavedAt(saved.at);
  }, []);

  const periodUnit = timeframe === "weekly" ? "weeks" : "days";
  const minAllowedPeriod = timeframe === "weekly" ? 1 : 5;
  const maxAllowedPeriod = timeframe === "weekly" ? 260 : 504;

  const changeTimeframe = (next: EmaTimeframe) => {
    if (next === timeframe) return;
    setTimeframe(next);
    setMinPeriod((current) => next === "weekly"
      ? Math.max(1, Math.round(current / 5))
      : Math.max(5, current * 5));
  };

  const runScan = async () => {
    if (symbols.length === 0) {
      toast.error("No qualified universe stocks available to scan.");
      return;
    }
    const gain = Math.max(0, Math.min(500, Number(minGainPct) || 0));
    const period = Math.max(minAllowedPeriod, Math.min(maxAllowedPeriod, Math.round(Number(minPeriod) || (timeframe === "weekly" ? 12 : 60))));
    setMinGainPct(gain);
    setMinPeriod(period);
    setRows([]);
    setFundMap({});
    setExpandedSector(null);
    setProcessed(0);
    setTotal(symbols.length);
    setRunning(true);
    const next: Clean21EmaRow[] = [];
    try {
      const CHUNK = emaLength >= 200 || timeframe === "weekly" ? 125 : 250;
      for (let i = 0; i < symbols.length; i += CHUNK) {
        const slice = symbols.slice(i, i + CHUNK);
        const { data, error } = await supabase.functions.invoke("clean-21-ema-scan", {
          body: { symbols: slice, minGainPct: gain, minPeriod: period, emaLength, timeframe },
        });
        if (error) throw new Error(error.message);
        if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
        const qualifying = ((data as { rows?: Clean21EmaRow[] } | null)?.rows ?? [])
          .filter((row) => Number.isFinite(row.gainPct));
        next.push(...qualifying);
        next.sort((a, b) => b.gainPct - a.gainPct);
        setRows([...next]);
        setProcessed(Math.min(symbols.length, i + slice.length));
        if ((data as { partial?: boolean } | null)?.partial) {
          toast.warning("A scan chunk timed out; saved all completed matches. Run again to warm the remaining symbols.");
        }
      }
      const saved: SavedScan = { at: Date.now(), emaLength, timeframe, minGainPct: gain, minPeriod: period, rows: next };
      writeSaved(saved);
      setSavedAt(saved.at);
      toast.success(`Saved Clean ${emaLength} EMA Uptrend Stocks: ${next.length} tickers.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Clean EMA scan failed.");
    } finally {
      setRunning(false);
    }
  };

  // ── Fundamentals overlay ─────────────────────────────────────────
  const runFundamentalsCheck = async () => {
    if (rows.length === 0) {
      toast.error("Run a scan first.");
      return;
    }
    setFundRunning(true);
    setFundProgress({ done: 0, total: rows.length });
    try {
      const syms = rows.map(r => r.symbol);
      const CHUNK = 15;
      const merged: Record<string, FundamentalsData> = {};
      for (let i = 0; i < syms.length; i += CHUNK) {
        let slice = syms.slice(i, i + CHUNK);
        // The edge function returns partial results if it hits its time budget.
        let guard = 0;
        while (slice.length > 0 && guard++ < 10) {
          const { data, error } = await supabase.functions.invoke("fetch-fundamentals", {
            body: { symbols: slice },
          });
          if (error) throw new Error(error.message);
          const res = data as { fundamentals?: Record<string, FundamentalsData>; remaining?: string[] } | null;
          Object.assign(merged, res?.fundamentals ?? {});
          setFundMap({ ...merged });
          slice = res?.remaining ?? [];
        }
        setFundProgress({ done: Math.min(syms.length, i + CHUNK), total: syms.length });
      }
      const covered = Object.values(merged).filter(f => f?.fundamental_score != null).length;
      toast.success(`Fundamentals loaded for ${covered}/${syms.length} tickers.`);
      setSortKey("fundamentals");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fundamentals check failed.");
    } finally {
      setFundRunning(false);
    }
  };

  const hasFundamentals = Object.keys(fundMap).length > 0;

  // ── Sorting ──────────────────────────────────────────────────────
  const sortedRows = useMemo(() => {
    const arr = [...rows];
    switch (sortKey) {
      case "gain":
        arr.sort((a, b) => b.gainPct - a.gainPct);
        break;
      case "rating":
        arr.sort((a, b) => (ratingMap?.get(b.symbol) ?? -1) - (ratingMap?.get(a.symbol) ?? -1));
        break;
      case "fundamentals":
        arr.sort((a, b) => (fundMap[b.symbol]?.fundamental_score ?? -1) - (fundMap[a.symbol]?.fundamental_score ?? -1));
        break;
      case "emaDistance": {
        arr.sort((a, b) => {
          const av = emaDistancePct(a);
          const bv = emaDistancePct(b);
          const aa = av === null ? Infinity : Math.abs(av);
          const bb = bv === null ? Infinity : Math.abs(bv);
          return aa - bb;
        });
        break;
      }
    }
    return arr;
  }, [rows, sortKey, ratingMap, fundMap]);

  // ── Sector distribution ─────────────────────────────────────────
  interface SliceDatum {
    gics: string;
    count: number;
    pct: number;
    symbols: string[];
  }

  const sliceData: SliceDatum[] = useMemo(() => {
    if (rows.length === 0) return [];
    const buckets = new Map<string, string[]>();
    for (const r of rows) {
      const stock = universeMap.get(r.symbol);
      const gics = gicsForIndustry(stock?.sector ?? null) ?? (stock?.sector ? "Other" : "Unknown");
      const arr = buckets.get(gics) ?? [];
      arr.push(r.symbol);
      buckets.set(gics, arr);
    }
    const total = rows.length || 1;
    const out: SliceDatum[] = [];
    buckets.forEach((syms, gics) => {
      out.push({ gics, count: syms.length, pct: (syms.length / total) * 100, symbols: syms });
    });
    out.sort((a, b) => b.count - a.count);
    return out;
  }, [rows, universeMap]);

  const [groupMode, setGroupMode] = useState<GroupMode>("sector");
  const { themes: curatedThemes } = useCuratedThemes();
  const themeBySymbol = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of curatedThemes) for (const sym of t.symbols) if (!m.has(sym)) m.set(sym.toUpperCase(), t.name);
    return m;
  }, [curatedThemes]);

  const concentrationItems: ConcentrationItem[] = useMemo(
    () => rows.map(r => ({
      symbol: r.symbol,
      industry: universeMap.get(r.symbol)?.sector ?? null,
      theme: themeBySymbol.get(r.symbol.toUpperCase()) ?? null,
      rating: ratingMap?.get(r.symbol) ?? null,
      ret: r.gainPct,
    })),
    [rows, universeMap, themeBySymbol, ratingMap],
  );

  const leadingSector = sliceData[0] ?? null;
  const expandedDatum = expandedSector ? sliceData.find(d => d.gics === expandedSector) ?? null : null;

  // ── Exports ─────────────────────────────────────────────────────
  const exportSymbols = sortedRows.map((r) => r.symbol);

  const copy = async (syms?: string[]) => {
    const list = syms ?? exportSymbols;
    try {
      await navigator.clipboard.writeText(list.join(","));
      toast.success(`${list.length} symbols copied to clipboard.`);
    } catch {
      toast.error("Could not copy symbols.");
    }
  };

  const download = (syms?: string[], suffix?: string) => {
    const list = syms ?? exportSymbols;
    const blob = new Blob([list.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suffix
      ? `Clean_${emaLength}EMA_${timeframe}_${suffix}_${list.length}tickers.txt`
      : `Clean_${emaLength}EMA_${timeframe}_Uptrend_Stocks_${list.length}tickers.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${list.length} symbols.`);
  };

  const renderActiveShape = (props: any) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
    return (
      <g>
        <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 6} startAngle={startAngle} endAngle={endAngle} fill={fill} />
        <Sector cx={cx} cy={cy} innerRadius={outerRadius + 8} outerRadius={outerRadius + 11} startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.4} />
      </g>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-['Syne',sans-serif]">
            <Save size={16} className="text-primary" /> Clean EMA Uptrend Scan
          </DialogTitle>
          <DialogDescription className="text-xs">
            Finds qualified-universe stocks with large gains during the current uninterrupted run above the selected EMA.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Settings */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span className="font-medium text-foreground">EMA Type</span>
              <Select value={String(emaLength)} onValueChange={(value) => setEmaLength(Number(value) as EmaLength)}>
                <SelectTrigger className="h-9 font-mono">
                  <SelectValue placeholder="Select EMA" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="9">9 EMA</SelectItem>
                  <SelectItem value="21">21 EMA</SelectItem>
                  <SelectItem value="50">50 EMA</SelectItem>
                  <SelectItem value="200">200 EMA</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-foreground">EMA Timeframe</span>
              <Select value={timeframe} onValueChange={(value) => changeTimeframe(value as EmaTimeframe)}>
                <SelectTrigger className="h-9 font-mono capitalize">
                  <SelectValue placeholder="Select timeframe" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-foreground">Minimum Gain %</span>
              <Input
                type="number"
                min={0}
                max={500}
                value={minGainPct}
                onChange={(e) => setMinGainPct(Number(e.target.value))}
                className="h-9 font-mono"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-foreground">Minimum Period Above EMA</span>
              <Input
                type="number"
                min={minAllowedPeriod}
                max={maxAllowedPeriod}
                value={minPeriod}
                onChange={(e) => setMinPeriod(Number(e.target.value))}
                className="h-9 font-mono"
              />
              <span className="block text-[10px] text-muted-foreground">{periodUnit}; supports short daily windows down to 5 days.</span>
            </label>
          </div>

          {/* Scan bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
            <div className="text-muted-foreground">
              Universe: <span className="font-mono text-foreground">{symbols.length.toLocaleString()}</span>
              <span className="ml-2">· {emaLength} EMA · {timeframe}</span>
              {savedAt && <span className="ml-2">· saved {new Date(savedAt).toLocaleString()}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={runScan}
                disabled={running || symbols.length === 0}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
              >
                {running ? <><Loader2 size={12} className="animate-spin" /> {processed}/{total}</> : <><Play size={12} /> Run Scan</>}
              </button>
              <button
                onClick={runFundamentalsCheck}
                disabled={fundRunning || running || rows.length === 0}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#facc15]/40 bg-[#facc15]/10 px-3 py-1.5 text-xs font-semibold text-[#facc15] transition-colors hover:bg-[#facc15]/20 disabled:opacity-50"
                title="Runs the Current fundamentals profile on the stocks in this list only."
              >
                {fundRunning
                  ? <><Loader2 size={12} className="animate-spin" /> {fundProgress?.done ?? 0}/{fundProgress?.total ?? 0}</>
                  : <><Sparkles size={12} /> Run Fundamentals Check (Current Profile)</>}
              </button>
            </div>
          </div>

          {/* Concentration — Sector / Industry / Theme */}
          {rows.length > 0 && (
            <div className="rounded-lg border border-border bg-card/50 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
                <PieChartIcon size={13} className="text-primary" /> Concentration — Sector · Industry · Theme
              </div>
              <GroupConcentrationPanel
                items={concentrationItems}
                mode={groupMode}
                onModeChange={setGroupMode}
                availableModes={["sector", "industry", "subIndustry", "theme"]}
                height={260}
              />
            </div>
          )}

          {/* Results */}
          <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-semibold text-foreground">Clean {emaLength} EMA Uptrend Stocks</div>
                <div className="text-[10px] text-muted-foreground">Sorted by {sortKey === "gain" ? "gain across the clean EMA run" : sortKey === "rating" ? "RS Rating" : sortKey === "fundamentals" ? "Fundamentals score" : "distance to EMA (closest first)"}.</div>
              </div>
              <div className="flex items-center gap-2">
                <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                  <SelectTrigger className="h-8 w-[180px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gain">Sort · Performance %</SelectItem>
                    <SelectItem value="rating">Sort · RS Rating</SelectItem>
                    <SelectItem value="fundamentals" disabled={!hasFundamentals}>
                      Sort · Fundamentals {hasFundamentals ? "" : "(run check)"}
                    </SelectItem>
                    <SelectItem value="emaDistance">Sort · EMA Distance</SelectItem>
                  </SelectContent>
                </Select>
                <div className="font-mono text-lg font-bold text-primary">{rows.length}</div>
              </div>
            </div>

            {sortedRows.length > 0 && (
              <div className="mt-2 max-h-72 overflow-y-auto rounded border border-border/60 bg-background/50">
                <div className="sticky top-0 z-10 grid grid-cols-[70px_1fr_50px_60px_70px_60px] items-center gap-2 border-b border-border bg-background/95 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>Ticker</span>
                  <span>Run</span>
                  <span className="text-right">Rating</span>
                  <span className="text-right">EMA Δ</span>
                  <span className="text-right">Fund.</span>
                  <span className="text-right">Gain</span>
                </div>
                {sortedRows.map((row) => {
                  const dist = emaDistancePct(row);
                  const rating = ratingMap?.get(row.symbol);
                  const fs = fundMap[row.symbol]?.fundamental_score ?? null;
                  return (
                    <div key={row.symbol} className="grid grid-cols-[70px_1fr_50px_60px_70px_60px] items-center gap-2 border-b border-border/40 px-2 py-1 last:border-b-0">
                      <span className="font-mono font-semibold text-foreground">{row.symbol}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {row.periodsWithoutBelow ?? row.daysWithoutBelow ?? 0}{timeframe === "weekly" ? "w" : "d"} above {row.emaLength ?? emaLength} EMA
                      </span>
                      <span className="text-right font-mono text-[11px] text-muted-foreground">{rating ?? "—"}</span>
                      <span className={`text-right font-mono text-[11px] ${dist !== null && dist < 5 ? "text-primary" : "text-muted-foreground"}`}>
                        {dist !== null ? `${dist >= 0 ? "+" : ""}${dist.toFixed(1)}%` : "—"}
                      </span>
                      <span className={`text-right font-mono text-[11px] ${fundamentalScoreColor(fs)}`}>
                        {fs !== null ? fs : (hasFundamentals ? "—" : "·")}
                      </span>
                      <span className="text-right font-mono text-[11px] text-[hsl(var(--gain-strong))]">+{row.gainPct.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
            <button
              onClick={() => copy()}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              <Copy size={12} /> Copy for TradingView
            </button>
            <button
              onClick={() => download()}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <Download size={12} /> Download .txt
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
