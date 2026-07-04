import { useEffect, useMemo, useState } from "react";
import { Copy, Download, Loader2, Play, Save } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import type { RsStock } from "@/hooks/useRsAlpha";

interface Clean21EmaRow {
  symbol: string;
  gainPct: number;
  latestClose: number | null;
  startClose: number | null;
  ema21: number | null;
  daysWithoutBelow: number;
  source: "cache" | "yahoo" | "none";
}

interface SavedScan {
  at: number;
  minGainPct: number;
  minDays: number;
  rows: Clean21EmaRow[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  universe: RsStock[];
}

const LS_KEY = "rs-clean-21-ema-uptrend-v1";

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
  const [minGainPct, setMinGainPct] = useState(70);
  const [minDays, setMinDays] = useState(60);
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
    setMinGainPct(saved.minGainPct);
    setMinDays(saved.minDays);
    setRows(saved.rows ?? []);
    setSavedAt(saved.at);
  }, []);

  const exportSymbols = rows.map((r) => r.symbol);

  const runScan = async () => {
    if (symbols.length === 0) {
      toast.error("No qualified universe stocks available to scan.");
      return;
    }
    const gain = Math.max(0, Math.min(500, Number(minGainPct) || 0));
    const days = Math.max(30, Math.min(252, Math.round(Number(minDays) || 60)));
    setMinGainPct(gain);
    setMinDays(days);
    setRows([]);
    setProcessed(0);
    setTotal(symbols.length);
    setRunning(true);
    const next: Clean21EmaRow[] = [];
    try {
      const CHUNK = 350;
      for (let i = 0; i < symbols.length; i += CHUNK) {
        const slice = symbols.slice(i, i + CHUNK);
        const { data, error } = await supabase.functions.invoke("clean-21-ema-scan", {
          body: { symbols: slice, minGainPct: gain, minDays: days },
        });
        if (error) throw new Error(error.message);
        if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
        const qualifying = ((data as { rows?: Clean21EmaRow[] } | null)?.rows ?? [])
          .filter((row) => Number.isFinite(row.gainPct));
        next.push(...qualifying);
        next.sort((a, b) => b.gainPct - a.gainPct);
        setRows([...next]);
        setProcessed(Math.min(symbols.length, i + slice.length));
      }
      const saved: SavedScan = { at: Date.now(), minGainPct: gain, minDays: days, rows: next };
      writeSaved(saved);
      setSavedAt(saved.at);
      toast.success(`Saved Clean 21 EMA Uptrend Stocks: ${next.length} tickers.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Clean 21 EMA scan failed.");
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
    a.download = `Clean_21EMA_Uptrend_Stocks_${exportSymbols.length}tickers.txt`;
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
            <Save size={16} className="text-primary" /> Weekend Clean 21 EMA Scan
          </DialogTitle>
          <DialogDescription className="text-xs">
            Finds qualified-universe stocks with large gains that stayed above the 21-day EMA for the full window.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <span className="font-medium text-foreground">Minimum Days Above 21 EMA</span>
              <Input
                type="number"
                min={30}
                max={252}
                value={minDays}
                onChange={(e) => setMinDays(Number(e.target.value))}
                className="h-9 font-mono"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
            <div className="text-muted-foreground">
              Universe: <span className="font-mono text-foreground">{symbols.length.toLocaleString()}</span>
              {savedAt && <span className="ml-2">· saved {new Date(savedAt).toLocaleString()}</span>}
            </div>
            <button
              onClick={runScan}
              disabled={running || symbols.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              {running ? <><Loader2 size={12} className="animate-spin" /> {processed}/{total}</> : <><Play size={12} /> Run Weekend Scan</>}
            </button>
          </div>

          <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-semibold text-foreground">Clean 21 EMA Uptrend Stocks</div>
                <div className="text-[10px] text-muted-foreground">Sorted by gain over the selected window.</div>
              </div>
              <div className="font-mono text-lg font-bold text-primary">{rows.length}</div>
            </div>
            {rows.length > 0 && (
              <div className="mt-2 max-h-44 overflow-y-auto rounded border border-border/60 bg-background/50">
                {rows.slice(0, 120).map((row) => (
                  <div key={row.symbol} className="grid grid-cols-[70px_1fr_72px] items-center gap-2 border-b border-border/40 px-2 py-1 last:border-b-0">
                    <span className="font-mono font-semibold text-foreground">{row.symbol}</span>
                    <span className="text-[10px] text-muted-foreground">{row.daysWithoutBelow}d above 21 EMA</span>
                    <span className="text-right font-mono text-[hsl(160,70%,50%)]">+{row.gainPct.toFixed(1)}%</span>
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