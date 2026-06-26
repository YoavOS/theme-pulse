import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Play, Pause, Square, Copy, Download, Trophy, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSuperperformance, type SuperperformanceProfileKey } from "@/hooks/useSuperperformance";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Symbols to scan (current qualified universe). */
  universe: string[];
}

type Status = "idle" | "running" | "paused" | "done" | "cancelled";

const PROFILE_OPTIONS: { key: SuperperformanceProfileKey; label: string; col: "minervini_score" | "oneil_score" | "ryan_score" | "current_score" }[] = [
  { key: "current",   label: "Current",   col: "current_score" },
  { key: "minervini", label: "Minervini", col: "minervini_score" },
  { key: "oneil",     label: "O'Neil",    col: "oneil_score" },
  { key: "ryan",      label: "Ryan",      col: "ryan_score" },
];

const THRESHOLD = 80;

const scoreKeys: Record<SuperperformanceProfileKey, string[]> = {
  current: ["current", "currentScore", "current_score"],
  minervini: ["minervini", "minerviniScore", "minervini_score"],
  oneil: ["oneil", "oneilScore", "oneil_score"],
  ryan: ["ryan", "ryanScore", "ryan_score"],
};

const normalizeScores = (data: any, profiles: SuperperformanceProfileKey[]) => {
  const out: Partial<Record<SuperperformanceProfileKey, number>> = {};
  const scoreBag = data?.scores && typeof data.scores === "object" ? data.scores : {};
  for (const profile of profiles) {
    const candidates = [
      ...scoreKeys[profile].map((k) => scoreBag?.[k]),
      ...scoreKeys[profile].map((k) => data?.[k]),
      data?.reports?.[profile]?.overallScore,
    ];
    const value = candidates.find((v) => typeof v === "number" && Number.isFinite(v));
    if (typeof value === "number") out[profile] = value;
  }
  return out;
};

export default function SuperperformanceScanModal({ open, onOpenChange, universe }: Props) {
  const { rows, loading, reload } = useSuperperformance();
  const [status, setStatus] = useState<Status>("idle");
  const [index, setIndex] = useState(0);
  const [currentSymbol, setCurrentSymbol] = useState<string | null>(null);
  const [qualifierCount, setQualifierCount] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const [selectedProfiles, setSelectedProfiles] = useState<SuperperformanceProfileKey[]>(["current", "minervini"]);
  const cancelRef = useRef(false);
  const pauseRef = useRef(false);
  const qualifierSymbolsRef = useRef<Set<string>>(new Set());

  // Reset on close
  useEffect(() => {
    if (!open) {
      cancelRef.current = true;
      pauseRef.current = false;
    }
  }, [open]);

  const total = universe.length;

  const toggleProfile = (key: SuperperformanceProfileKey) => {
    setSelectedProfiles((prev) => prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]);
  };

  const runScan = async (fromIndex = 0) => {
    if (total === 0) {
      toast.error("Universe is empty — rebuild RS Alpha first.");
      return;
    }
    if (selectedProfiles.length === 0) {
      toast.error("Select at least one profile to scan.");
      return;
    }
    cancelRef.current = false;
    pauseRef.current = false;
    setStatus("running");
    setIndex(fromIndex);
    if (fromIndex === 0) {
      qualifierSymbolsRef.current = new Set();
      setQualifierCount(0);
      setFailed([]);
    }

    const existingBySymbol = new Map<string, any>(rows.map((r) => [r.symbol, { ...r }]));

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
          body: { symbol: sym, minimal: true, profiles: selectedProfiles },
        });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);
        const scores = normalizeScores(data, selectedProfiles);

        // Build the upsert payload — only columns for selected profiles get updated.
        const payload: Record<string, any> = {
          symbol: sym,
          last_scanned: new Date().toISOString(),
        };
        let anyQualified = false;
        for (const p of selectedProfiles) {
          const s = typeof scores[p] === "number" ? scores[p] : null;
          const col = PROFILE_OPTIONS.find((o) => o.key === p)!.col;
          payload[col] = s;
          if (s !== null && s >= THRESHOLD) anyQualified = true;
        }

        if (anyQualified) {
          await supabase
            .from("superperformance_stocks" as any)
            .upsert(payload, { onConflict: "symbol" });
          qualifierSymbolsRef.current.add(sym);
          setQualifierCount(qualifierSymbolsRef.current.size);
          existingBySymbol.set(sym, { ...(existingBySymbol.get(sym) ?? {}), ...payload });
        } else {
          // No selected profile qualified — purge any stale entry so the list stays clean,
          // but only if this row has no qualifying score in any *other* profile column.
          const existing = existingBySymbol.get(sym);
          const otherProfileKeeps = existing
            ? PROFILE_OPTIONS
                .filter((o) => !selectedProfiles.includes(o.key))
                .some((o) => {
                  const v = (existing as any)[o.col];
                  return typeof v === "number" && v >= THRESHOLD;
                })
            : false;
          if (otherProfileKeeps) {
            // Update only the columns we scanned (clear them since they didn't qualify).
            await supabase
              .from("superperformance_stocks" as any)
              .update(payload)
              .eq("symbol", sym);
            existingBySymbol.set(sym, { ...existing, ...payload });
          } else {
            await supabase
              .from("superperformance_stocks" as any)
              .delete()
              .eq("symbol", sym);
            existingBySymbol.delete(sym);
          }
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
  /** Show rows that qualify on at least one profile (>=80 in any column). */
  const sortedRows = useMemo(() => {
    const bestScore = (r: any) => Math.max(
      r.current_score ?? -1,
      r.minervini_score ?? -1,
      r.oneil_score ?? -1,
      r.ryan_score ?? -1,
    );
    return [...rows].sort((a, b) => bestScore(b) - bestScore(a));
  }, [rows]);
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

  const renderScoreCell = (val: number | null | undefined) => {
    if (typeof val !== "number") return <span className="text-muted-foreground">—</span>;
    const cls = val >= THRESHOLD ? "text-[hsl(40,90%,55%)] font-bold" : val >= 60 ? "text-foreground" : "text-muted-foreground";
    return <span className={`font-mono ${cls}`}>{val}</span>;
  };

  const scanning = status === "running" || status === "paused";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy size={18} className="text-[hsl(40,90%,55%)]" />
            Superperformance Stocks (multi-profile ≥ {THRESHOLD})
          </DialogTitle>
          <DialogDescription>
            Scans the qualified RS universe through each selected profile. For every ticker, fundamentals are pulled,
            scored against the chosen profiles, and discarded immediately — only the ticker, per-profile scores, and
            last-scanned date are persisted.
          </DialogDescription>
        </DialogHeader>

        {/* Profile selector */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Profiles to score</div>
          <div className="flex flex-wrap gap-3">
            {PROFILE_OPTIONS.map((p) => (
              <label
                key={p.key}
                className={`flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm ${scanning ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-muted/50"}`}
              >
                <Checkbox
                  checked={selectedProfiles.includes(p.key)}
                  onCheckedChange={() => toggleProfile(p.key)}
                  disabled={scanning}
                />
                <span className="font-medium">{p.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Scan controls */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm">
              Universe: <span className="font-mono font-bold">{total}</span> tickers
              {status !== "idle" && (
                <span className="ml-3 text-muted-foreground">
                  · Scanned <span className="font-mono">{index}</span>/{total}
                  · Qualifiers <span className="font-mono text-[hsl(40,90%,55%)]">{qualifierCount}</span>
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
                    <th className="text-right px-2 py-1.5">Current</th>
                    <th className="text-right px-2 py-1.5">Minervini</th>
                    <th className="text-right px-2 py-1.5">O'Neil</th>
                    <th className="text-right px-2 py-1.5">Ryan</th>
                    <th className="text-right px-2 py-1.5">Last Scanned</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => (
                    <tr key={r.symbol} className="border-b border-border/40 hover:bg-muted/30">
                      <td className="px-2 py-1 font-mono font-bold">{r.symbol}</td>
                      <td className="px-2 py-1 text-right">{renderScoreCell(r.current_score)}</td>
                      <td className="px-2 py-1 text-right">{renderScoreCell(r.minervini_score)}</td>
                      <td className="px-2 py-1 text-right">{renderScoreCell(r.oneil_score)}</td>
                      <td className="px-2 py-1 text-right">{renderScoreCell(r.ryan_score)}</td>
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
