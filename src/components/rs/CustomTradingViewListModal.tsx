import { useMemo, useState } from "react";
import { Copy, Download, Settings2, X, Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { RsStock } from "@/hooks/useRsAlpha";

export type CustomListTab = "overall" | "1d" | "1m" | "3m" | "6m";
type SortBy = "rs" | "rating" | "return";
const TOPN_MIN = 10;
const TOPN_MAX = 500; // values >= MAX mean "All"

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tabId: CustomListTab;
  tabLabel: string;
  /** Stocks already filtered for this timeframe (RS not null), with rating map. */
  stocks: RsStock[];
  ratingMap: Map<string, number | null>;
  getRsForTab: (s: RsStock, t: CustomListTab) => number | null;
  getReturnField: (s: RsStock, t: CustomListTab) => number | null;
  isOtcSymbol: (sym: string) => boolean;
}

export default function CustomTradingViewListModal({
  open, onOpenChange, tabId, tabLabel, stocks, ratingMap,
  getRsForTab, getReturnField, isOtcSymbol,
}: Props) {
  const [minRating, setMinRating] = useState<number>(60);
  const [topN, setTopN] = useState<number>(50);
  const [acceleratingOnly, setAcceleratingOnly] = useState<boolean>(false);
  const [minAdr, setMinAdr] = useState<number>(3.0);
  const [excludeOtc, setExcludeOtc] = useState<boolean>(true);
  const [sortBy, setSortBy] = useState<SortBy>("rs");

  const filtered = useMemo(() => {
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

    list = [...list].sort((a, b) => {
      if (sortBy === "rs") return (getRsForTab(b, tabId) ?? -999) - (getRsForTab(a, tabId) ?? -999);
      if (sortBy === "rating") return (ratingMap.get(b.symbol) ?? -1) - (ratingMap.get(a.symbol) ?? -1);
      return (getReturnField(b, tabId) ?? -999) - (getReturnField(a, tabId) ?? -999);
    });

    if (topN < TOPN_MAX) list = list.slice(0, topN);
    return list;
  }, [stocks, ratingMap, minRating, minAdr, acceleratingOnly, excludeOtc, sortBy, topN, tabId, getRsForTab, getReturnField, isOtcSymbol]);

  const symbols = filtered.map(s => s.symbol);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(symbols.join(","));
      toast.success(`${symbols.length} symbols copied to clipboard.`, {
        description: "Paste into TradingView Watchlist → Import symbols.",
      });
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  };

  const handleDownload = () => {
    const blob = new Blob([symbols.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const safe = tabLabel.replace(/\s+/g, "");
    const a = document.createElement("a");
    a.href = url;
    a.download = `RS_Custom_${safe}_${symbols.length}tickers.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${symbols.length} symbols.`, {
      description: "One ticker per line — ready for TradingView import.",
    });
  };

  const isAll = topN >= TOPN_MAX;
  const topNLabel = isAll ? "All" : `Top ${topN}`;
  const topNPresets = [10, 25, 50, 100, 200, TOPN_MAX];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-['Syne',sans-serif]">
            <Settings2 size={16} className="text-primary" />
            Create Custom TradingView List · {tabLabel}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Refine the qualified universe with custom filters before exporting.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Min RS Rating */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label className="font-medium text-foreground">Min RS Rating</label>
              <span className="font-mono text-primary">{minRating}</span>
            </div>
            <Slider min={1} max={99} step={1} value={[minRating]} onValueChange={(v) => setMinRating(v[0])} />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>1 (weakest)</span><span>99 (strongest)</span>
            </div>
          </div>

          {/* Min ADR % */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label className="font-medium text-foreground">Min Average Daily Range (ADR)</label>
              <span className="font-mono text-primary">{minAdr.toFixed(1)}%</span>
            </div>
            <Slider min={1} max={10} step={0.1} value={[minAdr]} onValueChange={(v) => setMinAdr(v[0])} />
          </div>

          {/* Top N */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label className="font-medium text-foreground">Top N stocks</label>
              <span className="font-mono text-primary">{topNLabel}</span>
            </div>
            <Slider
              min={TOPN_MIN}
              max={TOPN_MAX}
              step={1}
              value={[topN]}
              onValueChange={(v) => setTopN(v[0])}
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {topNPresets.map(v => {
                const label = v >= TOPN_MAX ? "All" : `Top ${v}`;
                const active = topN === v;
                return (
                  <button
                    key={v}
                    onClick={() => setTopN(v)}
                    className={`rounded-md border px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                      active
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sort by */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Sort by</label>
            <div className="flex flex-wrap gap-1.5">
              {[
                { v: "rs" as SortBy, label: "RS Score" },
                { v: "rating" as SortBy, label: "RS Rating" },
                { v: "return" as SortBy, label: "Stock Return %" },
              ].map(opt => (
                <button
                  key={opt.v}
                  onClick={() => setSortBy(opt.v)}
                  className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors ${
                    sortBy === opt.v
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Checkbox filters */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs cursor-pointer">
              <Checkbox checked={acceleratingOnly} onCheckedChange={(v) => setAcceleratingOnly(!!v)} />
              <span>
                <span className="font-medium text-foreground">Accelerating Only</span>
                <span className="block text-[10px] text-muted-foreground">1M RS &gt; 3M RS</span>
              </span>
            </label>
            <label className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs cursor-pointer">
              <Checkbox checked={excludeOtc} onCheckedChange={(v) => setExcludeOtc(!!v)} />
              <span>
                <span className="font-medium text-foreground">Exclude OTC Stocks</span>
                <span className="block text-[10px] text-muted-foreground">Hide foreign / pink sheets</span>
              </span>
            </label>
          </div>

          {/* Live preview */}
          <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Live preview</span>
              <span className="font-mono">
                <strong className="text-primary text-base">{symbols.length}</strong>
                <span className="text-muted-foreground"> stocks will be exported</span>
              </span>
            </div>
            {symbols.length > 0 && (
              <div className="mt-1.5 truncate font-mono text-[10px] text-muted-foreground" title={symbols.join(", ")}>
                {symbols.slice(0, 12).join(", ")}{symbols.length > 12 ? ` …+${symbols.length - 12} more` : ""}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <X size={12} className="mr-1 inline" /> Close
          </button>
          <button
            onClick={handleDownload}
            disabled={symbols.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
          >
            <Download size={12} /> Download .txt
          </button>
          <button
            onClick={handleCopy}
            disabled={symbols.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            <Copy size={12} /> Copy to Clipboard
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
