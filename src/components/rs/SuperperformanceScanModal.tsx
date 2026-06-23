import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, Play, Pause, Square, Copy, Download, Trophy, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSuperperformance } from "@/hooks/useSuperperformance";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Symbols to scan (current qualified universe). */
  universe: string[];
}

type Status = "idle" | "running" | "paused" | "done" | "cancelled";

export default function SuperperformanceScanModal({ open, onOpenChange, universe }: Props) {
  const { rows, loading, reload } = useSuperperformance();
  const [status, setStatus] = useState<Status>("idle");
  const [index, setIndex] = useState(0);
  const [currentSymbol, setCurrentSymbol] = useState<string | null>(null);
  const [qualifiers, setQualifiers] = useState<{ symbol: string; score: number }[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const cancelRef = useRef(false);
  const pauseRef = useRef(false);

  // Reset on close
  useEffect(() => {
    if (!open) {
      cancelRef.current = true;
      pauseRef.current = false;
    }
  }, [open]);

  const total = universe.length;

  const runScan = async (fromIndex = 0) => {
    if (total === 0) {
      toast.error("Universe is empty — rebuild RS Alpha first.");
      return;
    }
    cancelRef.current = false;
    pauseRef.current = false;
    setStatus("running");
    setIndex(fromIndex);
    if (fromIndex === 0) {
      setQualifiers([]);
      setFailed([]);
    }

    for (let i = fromIndex; i < total; i++) {
      if (cancelRef.current) { setStatus("cancelled"); setCurrentSymbol(null); return; }
      while (pauseRef.current) {
        setStatus("paused");
        await new Promise((r) => setTimeout(r, 250));
        if (cancelRef.current) { setStatus("cancelled"); setCurrentSymbol(null); return; }
      }
      setStatus("running");

      const sym = universe[i];
      setIndex(i);
      setCurrentSymbol(sym);

      try {
        const { data, error } = await supabase.functions.invoke("minervini-analysis", {
          body: { symbol: sym, minimal: true },
        });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);
        const score = typeof data?.minerviniScore === "number" ? data.minerviniScore : null;

        if (score !== null && score >= 80) {
          await supabase
            .from("superperformance_stocks" as any)
            .upsert(
              { symbol: sym, minervini_score: score, last_scanned: new Date().toISOString() },
              { onConflict: "symbol" },
            );
          setQualifiers((q) => [...q, { symbol: sym, score }]);
        } else if (score !== null) {
          // Score dropped below threshold — purge any stale entry so the list stays clean.
          await supabase
            .from("superperformance_stocks" as any)
            .delete()
            .eq("symbol", sym);
        }
      } catch (e) {
        setFailed((f) => [...f, sym]);
        console.warn("superperformance scan: failed", sym, e);
      }

      // Light pacing to stay friendly with upstream APIs (FMP/Yahoo/Finnhub).
      await new Promise((r) => setTimeout(r, 150));
    }

    setCurrentSymbol(null);
    setStatus("done");
    await reload();
    toast.success("Superperformance scan complete");
  };

  const handleStart = () => runScan(0);
  const handlePause = () => { pauseRef.current = true; };
  const handleResume = () => { pauseRef.current = false; runScan(index); };
  const handleCancel = () => { cancelRef.current = true; pauseRef.current = false; };

  const handleClear = async () => {
    if (!window.confirm("Delete ALL Superperformance Stocks entries?")) return;
    const { error } = await supabase.from("superperformance_stocks" as any).delete().neq("symbol", "");
    if (error) { toast.error(error.message); return; }
    await reload();
    toast.success("Cleared Superperformance list");
  };

  const progressPct = total > 0 ? Math.round((index / total) * 100) : 0;
  const sortedRows = useMemo(() => [...rows].sort((a, b) => b.minervini_score - a.minervini_score), [rows]);
  const tickerString = sortedRows.map((r) => r.symbol).join(",");

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(tickerString); toast.success(`${sortedRows.length} tickers copied`); }
    catch { toast.error("Copy failed"); }
  };
  const handleDownload = () => {
    const blob = new Blob([sortedRows.map((r) => r.symbol).join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Superperformance_${sortedRows.length}tickers.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy size={18} className="text-[hsl(40,90%,55%)]" />
            Superperformance Stocks (Minervini ≥ 80)
          </DialogTitle>
          <DialogDescription>
            Manually scan the qualified RS universe through the Minervini profile. Stocks scoring 80+ are saved.
            Fundamentals are pulled per ticker and discarded immediately — only ticker, score, and last-scanned date are stored.
          </DialogDescription>
        </DialogHeader>

        {/* Scan controls */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm">
              Universe: <span className="font-mono font-bold">{total}</span> tickers
              {status !== "idle" && (
                <span className="ml-3 text-muted-foreground">
                  · Scanned <span className="font-mono">{index}</span>/{total}
                  · Qualifiers <span className="font-mono text-[hsl(40,90%,55%)]">{qualifiers.length}</span>
                  {failed.length > 0 && <> · Failed <span className="font-mono text-loss-medium">{failed.length}</span></>}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {status === "idle" || status === "done" || status === "cancelled" ? (
                <Button size="sm" onClick={handleStart} className="bg-[hsl(40,90%,55%)] text-black hover:bg-[hsl(40,90%,50%)] font-semibold">
                  <Play size={14} className="mr-1" /> Start Scan
                </Button>
              ) : status === "running" ? (
                <>
                  <Button size="sm" variant="outline" onClick={handlePause}><Pause size={14} className="mr-1" /> Pause</Button>
                  <Button size="sm" variant="outline" onClick={handleCancel}><Square size={14} className="mr-1" /> Cancel</Button>
                </>
              ) : (
                <>
                  <Button size="sm" onClick={handleResume}><Play size={14} className="mr-1" /> Resume</Button>
                  <Button size="sm" variant="outline" onClick={handleCancel}><Square size={14} className="mr-1" /> Cancel</Button>
                </>
              )}
            </div>
          </div>

          {(status === "running" || status === "paused") && (
            <>
              <Progress value={progressPct} className="h-2" />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {status === "running" && <Loader2 size={12} className="animate-spin" />}
                {status === "paused" ? "Paused" : currentSymbol ? `Analyzing ${currentSymbol}…` : "Preparing…"}
              </div>
            </>
          )}
        </div>

        {/* Saved list */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-3 max-h-[40vh] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">
              Saved Superperformance List
              <span className="ml-2 text-muted-foreground font-normal">({sortedRows.length})</span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => reload()} disabled={loading}>
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              </Button>
              <Button size="sm" variant="outline" onClick={handleCopy} disabled={sortedRows.length === 0}>
                <Copy size={14} className="mr-1" /> Copy
              </Button>
              <Button size="sm" variant="outline" onClick={handleDownload} disabled={sortedRows.length === 0}>
                <Download size={14} className="mr-1" /> .txt
              </Button>
              <Button size="sm" variant="ghost" onClick={handleClear} disabled={sortedRows.length === 0} className="text-loss-medium hover:text-loss-medium">
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
          <div className="overflow-y-auto">
            {sortedRows.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-6">No qualifying stocks yet. Run a scan to populate.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="text-left px-2 py-1.5">Ticker</th>
                    <th className="text-right px-2 py-1.5">Minervini Score</th>
                    <th className="text-right px-2 py-1.5">Last Scanned</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => (
                    <tr key={r.symbol} className="border-b border-border/40 hover:bg-muted/30">
                      <td className="px-2 py-1 font-mono font-bold">{r.symbol}</td>
                      <td className="px-2 py-1 text-right font-mono text-[hsl(40,90%,55%)] font-bold">{r.minervini_score}</td>
                      <td className="px-2 py-1 text-right text-xs text-muted-foreground">{new Date(r.last_scanned).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
