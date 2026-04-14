import { useState, useMemo, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Loader2, Info, ChevronDown, ChevronUp, ArrowUpDown } from "lucide-react";
import { useRsAlpha, RsStock } from "@/hooks/useRsAlpha";
import { useFullScan } from "@/hooks/useFullScan";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import HelpButton from "@/components/HelpButton";

type TabId = "overall" | "1m" | "3m" | "6m";
type SortField = "rank" | "symbol" | "themeName" | "rs" | "stockReturn" | "spyReturn" | "price";
type SortDir = "asc" | "desc";

const TABS: { id: TabId; label: string }[] = [
  { id: "overall", label: "Overall Best RS" },
  { id: "1m", label: "1 Month Best RS" },
  { id: "3m", label: "3 Month Best RS" },
  { id: "6m", label: "6 Month Best RS" },
];

function getRsField(stock: RsStock, tab: TabId): number | null {
  switch (tab) {
    case "1m": return stock.rs1m;
    case "3m": return stock.rs3m;
    case "6m": return stock.rs6m;
    default: return stock.rsOverall;
  }
}

function getReturnField(stock: RsStock, tab: TabId): number | null {
  switch (tab) {
    case "1m": return stock.return1m;
    case "3m": return stock.return3m;
    case "6m": return stock.return6m;
    default: return stock.return1m; // show 1M for overall
  }
}

function getSpyField(stock: RsStock, tab: TabId): number | null {
  switch (tab) {
    case "1m": return stock.spyReturn1m;
    case "3m": return stock.spyReturn3m;
    case "6m": return stock.spyReturn6m;
    default: return stock.spyReturn1m;
  }
}

function rsColor(val: number | null): string {
  if (val === null) return "text-muted-foreground";
  if (val >= 10) return "text-[hsl(160,80%,45%)] font-bold";
  if (val >= 5) return "text-[hsl(160,70%,50%)]";
  if (val > 0) return "text-[hsl(160,60%,55%)]";
  if (val < -5) return "text-destructive font-semibold";
  if (val < 0) return "text-destructive/80";
  return "text-muted-foreground";
}

function rsBg(val: number | null): string {
  if (val === null) return "";
  if (val >= 10) return "bg-[hsl(160,80%,45%)]/10";
  if (val >= 5) return "bg-[hsl(160,70%,50%)]/5";
  if (val < -5) return "bg-destructive/5";
  return "";
}

function pctDisplay(val: number | null): string {
  if (val === null) return "N/A";
  const sign = val >= 0 ? "+" : "";
  return `${sign}${val.toFixed(2)}%`;
}

export default function RsAlpha() {
  const { stocks, isCalculating, lastCalculated, error, calculateRs } = useRsAlpha();
  const [activeTab, setActiveTab] = useState<TabId>("overall");
  const [showAll, setShowAll] = useState(false);
  const [sortField, setSortField] = useState<SortField>("rs");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [isScanning, setIsScanning] = useState(false);

  // Dummy handler for full scan (we just need startFullScan)
  const handleScanComplete = useCallback(() => {}, []);
  const { startFullScan, isRunning: isFullScanning, statusText: scanStatus } = useFullScan(handleScanComplete);

  // Auto-calculate on mount if no data
  useEffect(() => {
    if (stocks.length === 0 && !isCalculating) {
      calculateRs();
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsScanning(true);
    try {
      await startFullScan();
    } catch {}
    // After scan, recalculate RS
    await calculateRs();
    setIsScanning(false);
  }, [startFullScan, calculateRs]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const sortedStocks = useMemo(() => {
    const filtered = stocks.filter(s => {
      const rs = getRsField(s, activeTab);
      return rs !== null;
    });

    return [...filtered].sort((a, b) => {
      const mul = sortDir === "desc" ? -1 : 1;
      switch (sortField) {
        case "symbol":
          return mul * a.symbol.localeCompare(b.symbol);
        case "themeName":
          return mul * a.themeName.localeCompare(b.themeName);
        case "rs": {
          const aVal = getRsField(a, activeTab) ?? -999;
          const bVal = getRsField(b, activeTab) ?? -999;
          return mul * (aVal - bVal);
        }
        case "stockReturn": {
          const aVal = getReturnField(a, activeTab) ?? -999;
          const bVal = getReturnField(b, activeTab) ?? -999;
          return mul * (aVal - bVal);
        }
        case "price": {
          const aVal = a.price ?? 0;
          const bVal = b.price ?? 0;
          return mul * (aVal - bVal);
        }
        default:
          return 0;
      }
    });
  }, [stocks, activeTab, sortField, sortDir]);

  const displayStocks = showAll ? sortedStocks : sortedStocks.slice(0, 25);
  const hasMore = sortedStocks.length > 25;

  const SortHeader = ({ field, label, className = "" }: { field: SortField; label: string; className?: string }) => (
    <button
      onClick={() => toggleSort(field)}
      className={`inline-flex items-center gap-1 text-left font-medium text-muted-foreground hover:text-foreground transition-colors ${className}`}
    >
      {label}
      {sortField === field ? (
        sortDir === "desc" ? <ChevronDown size={12} /> : <ChevronUp size={12} />
      ) : (
        <ArrowUpDown size={10} className="opacity-40" />
      )}
    </button>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft size={16} />
            </Link>
            <h1 className="font-['Syne',sans-serif] text-xl font-bold tracking-tight text-foreground">
              RS Alpha Watchlist
            </h1>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help text-muted-foreground"><Info size={14} /></span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[320px] text-xs">
                  <p className="font-semibold mb-1">Relative Strength Score</p>
                  <p className="text-muted-foreground">
                    RS = Stock % return − SPY % return over the same period.
                    Overall score weights: 50% on 1M, 30% on 3M, 20% on 6M — stronger bias toward recent performance.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {lastCalculated && (
              <span className="text-xs text-muted-foreground">
                Updated {lastCalculated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={isCalculating || isFullScanning || isScanning}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              {isCalculating || isFullScanning || isScanning ? (
                <><Loader2 size={12} className="animate-spin" /> Updating…</>
              ) : (
                <><RefreshCw size={12} /> Refresh & Update All</>
              )}
            </button>
            <HelpButton />
          </div>
        </div>

        {/* Loading status */}
        {(isCalculating || isFullScanning || isScanning) && (
          <div className="container pb-2">
            <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
              <Loader2 size={12} className="mr-1.5 inline animate-spin" />
              {isFullScanning ? scanStatus || "Updating historical data for all stocks…" : "Calculating RS scores…"}
              <span className="text-muted-foreground ml-2">(this may take a while)</span>
            </div>
          </div>
        )}

        {/* Tab navigation */}
        <div className="container pb-2">
          <div className="flex items-center gap-1 rounded-lg bg-muted/30 p-1 w-fit">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setShowAll(false); setSortField("rs"); setSortDir("desc"); }}
                className={`relative rounded-md px-3.5 py-1.5 text-xs font-medium transition-all ${
                  activeTab === tab.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-6 rounded-full bg-primary" />
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="container py-5">
        {error && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {isCalculating && stocks.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        ) : stocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-20 text-center">
            <h3 className="text-lg font-semibold text-foreground mb-1">No RS Data Yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Run a Full Scan first, then RS scores will be calculated automatically.
            </p>
            <button
              onClick={handleRefresh}
              disabled={isFullScanning}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              {isFullScanning ? "Scanning…" : "Refresh & Update All Dashboard Data"}
            </button>
          </div>
        ) : (
          <>
            {/* Summary stats */}
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-xs text-muted-foreground">Total Stocks</div>
                <div className="text-xl font-bold text-foreground">{sortedStocks.length}</div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-xs text-muted-foreground">Positive RS</div>
                <div className="text-xl font-bold text-[hsl(160,70%,50%)]">
                  {sortedStocks.filter(s => (getRsField(s, activeTab) ?? 0) > 0).length}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-xs text-muted-foreground">Negative RS</div>
                <div className="text-xl font-bold text-destructive">
                  {sortedStocks.filter(s => (getRsField(s, activeTab) ?? 0) < 0).length}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-xs text-muted-foreground">Top RS Score</div>
                <div className="text-xl font-bold text-[hsl(160,70%,50%)]">
                  {sortedStocks.length > 0 ? pctDisplay(getRsField(sortedStocks[0], activeTab)) : "—"}
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground w-12">#</th>
                      <th className="px-3 py-2.5 text-left"><SortHeader field="symbol" label="Ticker" /></th>
                      <th className="px-3 py-2.5 text-left"><SortHeader field="themeName" label="Theme" /></th>
                      <th className="px-3 py-2.5 text-right"><SortHeader field="rs" label="RS Score" className="justify-end" /></th>
                      <th className="px-3 py-2.5 text-right"><SortHeader field="stockReturn" label="Stock Return" className="justify-end" /></th>
                      <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground">SPY Return</th>
                      <th className="px-3 py-2.5 text-right"><SortHeader field="price" label="Price" className="justify-end" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayStocks.map((stock, idx) => {
                      const rs = getRsField(stock, activeTab);
                      const ret = getReturnField(stock, activeTab);
                      const spy = getSpyField(stock, activeTab);
                      return (
                        <tr
                          key={stock.symbol}
                          className={`border-b border-border/50 transition-colors hover:bg-muted/20 ${rsBg(rs)}`}
                        >
                          <td className="px-3 py-2 text-xs text-muted-foreground">{idx + 1}</td>
                          <td className="px-3 py-2 font-mono font-semibold text-foreground">{stock.symbol}</td>
                          <td className="px-3 py-2 text-muted-foreground max-w-[180px] truncate">{stock.themeName}</td>
                          <td className={`px-3 py-2 text-right font-mono font-semibold ${rsColor(rs)}`}>
                            {pctDisplay(rs)}
                          </td>
                          <td className={`px-3 py-2 text-right font-mono ${
                            ret !== null && ret >= 0 ? "text-[hsl(160,60%,55%)]" : "text-destructive/80"
                          }`}>
                            {pctDisplay(ret)}
                          </td>
                          <td className={`px-3 py-2 text-right font-mono text-xs ${
                            spy !== null && spy >= 0 ? "text-[hsl(160,60%,55%)]" : "text-destructive/80"
                          }`}>
                            {pctDisplay(spy)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                            {stock.price !== null ? `$${stock.price.toFixed(2)}` : "N/A"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Load more */}
              {hasMore && !showAll && (
                <div className="border-t border-border p-3 text-center">
                  <button
                    onClick={() => setShowAll(true)}
                    className="rounded-md border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    Show All {sortedStocks.length} Stocks
                  </button>
                </div>
              )}
              {showAll && hasMore && (
                <div className="border-t border-border p-3 text-center">
                  <button
                    onClick={() => setShowAll(false)}
                    className="rounded-md border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    Show Top 25 Only
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
