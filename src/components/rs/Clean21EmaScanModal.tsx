import { useEffect, useMemo, useState } from "react";
import { Copy, Download, Loader2, Play, Save } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import type { RsStock } from "@/hooks/useRsAlpha";

type EmaLength = 9 | 21 | 50 | 200;
type EmaTimeframe = "daily" | "weekly";

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
}

const LS_KEY = "rs-clean-ema-uptrend-v3";

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

export default function Clean21EmaScanModal({ open, onOpenChange, universe }: Props) {
  const [emaLength, setEmaLength] = useState<EmaLength>(21);
  const [timeframe, setTimeframe] = useState<EmaTimeframe>("daily");
  const [minGainPct, setMinGainPct] = useState(70);
  const [minPeriod, setMinPeriod] = useState(60);
  const [rows, setRows] = useState<Clean21EmaRow[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);

  const symbols = useMemo(
    () => Array.from(new Set(universe.map((s) => s.symbol).filter(Boolean))).sort(),
    [universe],
  );

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

  const exportSymbols = rows.map((r) => r.symbol);
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
        if ((data as { partial?: boolean } | null)?.partial) {
          throw new Error("Scan timed out before every symbol was checked. Run again after cache warms, or use a smaller universe slice.");
        }
        const qualifying = ((data as { rows?: Clean21EmaRow[] } | null)?.rows ?? [])
          .filter((row) => Number.isFinite(row.gainPct));
        next.push(...qualifying);
        next.sort((a, b) => b.gainPct - a.gainPct);
        setRows([...next]);
        setProcessed(Math.min(symbols.length, i + slice.length));
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

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportSymbols.join(","));
      toast.success(`${exportSymbols.length} symbols copied to clipboard.`);
    } catch {
      toast.error("Could not copy symbols.");
    }
  };

  const download = () => {
    const blob = new Blob([exportSymbols.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Clean_${emaLength}EMA_${timeframe}_Uptrend_Stocks_${exportSymbols.length}tickers.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${exportSymbols.length} symbols.`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-['Syne',sans-serif]">
            <Save size={16} className="text-primary" /> Clean EMA Uptrend Scan
          </DialogTitle>
          <DialogDescription className="text-xs">
            Finds qualified-universe stocks with large gains during the current uninterrupted run above the selected EMA.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
            <div className="text-muted-foreground">
              Universe: <span className="font-mono text-foreground">{symbols.length.toLocaleString()}</span>
              <span className="ml-2">· {emaLength} EMA · {timeframe}</span>
              {savedAt && <span className="ml-2">· saved {new Date(savedAt).toLocaleString()}</span>}
            </div>
            <button
              onClick={runScan}
              disabled={running || symbols.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              {running ? <><Loader2 size={12} className="animate-spin" /> {processed}/{total}</> : <><Play size={12} /> Run Scan</>}
            </button>
          </div>

          <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-semibold text-foreground">Clean {emaLength} EMA Uptrend Stocks</div>
                <div className="text-[10px] text-muted-foreground">Sorted by gain across the current clean EMA run after the minimum {periodUnit} requirement is met.</div>
              </div>
              <div className="font-mono text-lg font-bold text-primary">{rows.length}</div>
            </div>
            {rows.length > 0 && (
              <div className="mt-2 max-h-44 overflow-y-auto rounded border border-border/60 bg-background/50">
                {rows.map((row) => (
                  <div key={row.symbol} className="grid grid-cols-[70px_1fr_72px] items-center gap-2 border-b border-border/40 px-2 py-1 last:border-b-0">
                    <span className="font-mono font-semibold text-foreground">{row.symbol}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {row.periodsWithoutBelow ?? row.daysWithoutBelow ?? 0}{timeframe === "weekly" ? "w" : "d"} above {row.emaLength ?? emaLength} EMA
                    </span>
                    <span className="text-right font-mono text-[hsl(var(--gain-strong))]">+{row.gainPct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
            <button
              onClick={copy}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              <Copy size={12} /> Copy for TradingView
            </button>
            <button
              onClick={download}
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