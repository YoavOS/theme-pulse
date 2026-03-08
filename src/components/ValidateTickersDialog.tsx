import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, AlertTriangle, CheckCircle2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface InvalidTicker {
  symbol: string;
  theme_name: string;
  theme_id: string;
  ticker_id: string;
  valid: boolean;
}

interface ValidateTickersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CACHE_KEY = "validate_tickers_cache";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export default function ValidateTickersDialog({ open, onOpenChange }: ValidateTickersDialogProps) {
  const { toast } = useToast();
  const [isValidating, setIsValidating] = useState(false);
  const [results, setResults] = useState<InvalidTicker[] | null>(null);
  const [totalChecked, setTotalChecked] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isRemoving, setIsRemoving] = useState(false);

  const runValidation = useCallback(async () => {
    // Check cache first
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < CACHE_TTL_MS) {
          console.log("Using cached validation results");
          setResults(parsed.invalid_tickers);
          setTotalChecked(parsed.total_checked);
          return;
        }
      }
    } catch { /* ignore */ }

    setIsValidating(true);
    setResults(null);
    setSelected(new Set());

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const res = await fetch(`${supabaseUrl}/functions/v1/validate-tickers`, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      setResults(data.invalid_tickers || []);
      setTotalChecked(data.total_checked || 0);

      // Cache results
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        invalid_tickers: data.invalid_tickers || [],
        total_checked: data.total_checked || 0,
        timestamp: Date.now(),
      }));

      if ((data.invalid_tickers || []).length === 0) {
        toast({ title: "All tickers valid!", description: `Checked ${data.total_checked} unique symbols — all exist on Finnhub.` });
      }
    } catch (err) {
      console.error("Validation failed:", err);
      toast({ title: "Validation failed", description: String(err), variant: "destructive" });
    } finally {
      setIsValidating(false);
    }
  }, [toast]);

  const toggleSelect = (tickerId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tickerId)) next.delete(tickerId);
      else next.add(tickerId);
      return next;
    });
  };

  const selectAll = () => {
    if (!results) return;
    setSelected(new Set(results.map((r) => r.ticker_id)));
  };

  const selectNone = () => setSelected(new Set());

  const removeSelected = async () => {
    if (selected.size === 0) return;
    setIsRemoving(true);

    try {
      const ids = [...selected];
      // Delete in batches of 50
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const { error } = await supabase.from("theme_tickers").delete().in("id", batch);
        if (error) throw error;
      }

      toast({
        title: "Tickers removed",
        description: `Removed ${selected.size} invalid ticker(s). Rescan recommended.`,
      });

      // Update results to remove deleted ones
      setResults((prev) => prev ? prev.filter((r) => !selected.has(r.ticker_id)) : null);
      setSelected(new Set());

      // Clear cache so next validation is fresh
      localStorage.removeItem(CACHE_KEY);
    } catch (err) {
      console.error("Remove failed:", err);
      toast({ title: "Remove failed", description: String(err), variant: "destructive" });
    } finally {
      setIsRemoving(false);
    }
  };

  // Group results by theme
  const grouped = results
    ? results.reduce<Record<string, InvalidTicker[]>>((acc, item) => {
        if (!acc[item.theme_name]) acc[item.theme_name] = [];
        acc[item.theme_name].push(item);
        return acc;
      }, {})
    : {};

  const themeNames = Object.keys(grouped).sort();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-primary" />
            Validate Tickers
          </DialogTitle>
          <DialogDescription>
            Checks which tickers do not exist on Finnhub — helps clean up bad symbols.
          </DialogDescription>
        </DialogHeader>

        {/* Not yet run */}
        {!isValidating && results === null && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="text-sm text-muted-foreground text-center">
              Scan all tickers across all themes to find invalid or non-existent symbols.
              This may take a minute with many tickers.
            </p>
            <Button onClick={runValidation}>Start Validation</Button>
          </div>
        )}

        {/* Loading */}
        {isValidating && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 size={24} className="animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Validating tickers against Finnhub...</p>
            <p className="text-xs text-muted-foreground">This may take a while with many tickers (rate limit safe)</p>
          </div>
        )}

        {/* Results */}
        {!isValidating && results !== null && (
          <>
            {results.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <CheckCircle2 size={32} className="text-primary" />
                <p className="text-sm font-medium text-foreground">All tickers valid!</p>
                <p className="text-xs text-muted-foreground">
                  Checked {totalChecked} unique symbols — all exist on Finnhub.
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-hidden flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">
                    Found {results.length} invalid ticker{results.length !== 1 ? "s" : ""} across{" "}
                    {themeNames.length} theme{themeNames.length !== 1 ? "s" : ""}
                  </p>
                  <div className="flex items-center gap-2">
                    <button onClick={selectAll} className="text-xs text-primary hover:underline">All</button>
                    <button onClick={selectNone} className="text-xs text-muted-foreground hover:underline">None</button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto max-h-[40vh] space-y-3 pr-1">
                  {themeNames.map((themeName) => (
                    <div key={themeName} className="rounded-md border border-border bg-secondary/30 p-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {themeName}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {grouped[themeName].map((ticker) => (
                          <label
                            key={ticker.ticker_id}
                            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-mono transition-colors ${
                              selected.has(ticker.ticker_id)
                                ? "border-destructive/50 bg-destructive/10 text-destructive"
                                : "border-border bg-background text-foreground hover:bg-accent"
                            }`}
                          >
                            <Checkbox
                              checked={selected.has(ticker.ticker_id)}
                              onCheckedChange={() => toggleSelect(ticker.ticker_id)}
                              className="h-3.5 w-3.5"
                            />
                            {ticker.symbol}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <DialogFooter className="gap-2">
          {results && results.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={removeSelected}
              disabled={selected.size === 0 || isRemoving}
            >
              {isRemoving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} />
              )}
              Remove Selected ({selected.size})
            </Button>
          )}
          {!isValidating && results !== null && (
            <Button variant="outline" size="sm" onClick={() => { localStorage.removeItem(CACHE_KEY); setResults(null); }}>
              Re-validate
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
