import { useMemo, useState } from "react";
import { ThemeData } from "@/data/themeData";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Copy, Download, Check, Trophy } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  themes: ThemeData[];
  timeframe: string;
}

export default function ExportTopLeadersDialog({ open, onOpenChange, themes, timeframe }: Props) {
  const [copied, setCopied] = useState(false);

  const { tickers, breakdown } = useMemo(() => {
    // Themes are pre-sorted by performance for the active timeframe.
    // Use absolute strongest performers (positive) — sort defensively.
    const sorted = [...themes]
      .filter(t => t.tickers.some(tk => !tk.skipped))
      .sort((a, b) => b.performance_pct - a.performance_pct);
    const top10 = sorted.slice(0, 10);

    const seen = new Set<string>();
    const out: string[] = [];
    const breakdown: { theme: string; perf: number; picks: { sym: string; pct: number }[] }[] = [];

    for (const theme of top10) {
      const validTickers = theme.tickers.filter(tk => !tk.skipped);
      const top3 = [...validTickers]
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 3);
      const picks: { sym: string; pct: number }[] = [];
      for (const tk of top3) {
        const sym = tk.symbol.toUpperCase();
        picks.push({ sym, pct: tk.pct });
        if (!seen.has(sym)) {
          seen.add(sym);
          out.push(sym);
        }
      }
      breakdown.push({ theme: theme.theme_name, perf: theme.performance_pct, picks });
    }
    return { tickers: out, breakdown };
  }, [themes]);

  const csvLine = tickers.join(",");
  const txtLines = tickers.join("\n");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(csvLine);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const handleDownload = () => {
    const blob = new Blob([txtLines], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `top_themes_leaders_${timeframe}_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy size={18} className="text-primary" />
            Top Themes Leaders — {timeframe}
          </DialogTitle>
          <DialogDescription>
            Top 3 performers from each of the top 10 themes ({tickers.length} unique tickers).
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied!" : "Copy to Clipboard"}
          </button>
          <button
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent"
          >
            <Download size={12} />
            Download .txt
          </button>
        </div>

        <div className="rounded-md border border-border bg-secondary/30 p-3 font-mono text-xs text-foreground break-all">
          {csvLine || <span className="text-muted-foreground">No tickers available</span>}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Breakdown</p>
          {breakdown.map((b, i) => (
            <div key={b.theme} className="rounded-md border border-border bg-card/50 p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-foreground">
                  #{i + 1} {b.theme}
                </span>
                <span className={`text-xs font-mono ${b.perf >= 0 ? "text-gain-medium" : "text-destructive"}`}>
                  {b.perf >= 0 ? "+" : ""}{b.perf.toFixed(2)}%
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {b.picks.map(p => (
                  <span
                    key={p.sym}
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono ${
                      p.pct >= 0
                        ? "border-gain-medium/30 bg-gain-medium/10 text-gain-medium"
                        : "border-destructive/30 bg-destructive/10 text-destructive"
                    }`}
                  >
                    {p.sym} {p.pct >= 0 ? "+" : ""}{p.pct.toFixed(2)}%
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
