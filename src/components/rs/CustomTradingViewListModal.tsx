import { useMemo, useState } from "react";
import { Copy, Download, Settings2, X, Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { RsStock } from "@/hooks/useRsAlpha";
import { ALL_GICS_SECTORS, GICS_SECTORS, expandSelectedToIndustries } from "@/lib/sectorTaxonomy";
import type { StockFundamentals } from "@/hooks/useStockFundamentalsMap";
import {
  DEFAULT_GROWTH_FILTERS,
  GrowthFiltersState,
  passesAllActiveFilters,
  anyActive,
} from "@/lib/growthFilters";

export type CustomListTab = "overall" | "1d" | "1w" | "1m" | "3m" | "6m";
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
  const [excludeSectorsOn, setExcludeSectorsOn] = useState<boolean>(false);
  const [excludedSectors, setExcludedSectors] = useState<Set<string>>(new Set());
  const [sectorSearch, setSectorSearch] = useState<string>("");
  const [sectorPopoverOpen, setSectorPopoverOpen] = useState<boolean>(false);

  // Industries actually present in the qualified universe (used to show counts and an "Other" group)
  const universeIndustries = useMemo(() => {
    const set = new Set<string>();
    stocks.forEach(s => { if (s.sector && s.sector.trim()) set.add(s.sector.trim()); });
    return set;
  }, [stocks]);

  // Build groups: GICS sector -> [industries], plus an "Other" bucket for unmapped strings present in the data.
  const groupedSectors = useMemo(() => {
    const groups: { gics: string; industries: string[] }[] = [];
    const mappedLower = new Set<string>();
    for (const gics of ALL_GICS_SECTORS) {
      const industries = [...GICS_SECTORS[gics]].sort((a, b) => a.localeCompare(b));
      industries.forEach(i => mappedLower.add(i.toLowerCase().trim()));
      groups.push({ gics, industries });
    }
    // Anything in the universe that isn't mapped → "Other"
    const other: string[] = [];
    universeIndustries.forEach(ind => {
      if (!mappedLower.has(ind.toLowerCase().trim())) other.push(ind);
    });
    if (other.length > 0) {
      groups.push({ gics: "Other", industries: other.sort((a, b) => a.localeCompare(b)) });
    }
    return groups;
  }, [universeIndustries]);

  const filteredGroups = useMemo(() => {
    const q = sectorSearch.trim().toLowerCase();
    if (!q) return groupedSectors;
    return groupedSectors
      .map(g => ({
        gics: g.gics,
        industries: g.industries.filter(i => i.toLowerCase().includes(q)),
        match: g.gics.toLowerCase().includes(q),
      }))
      .filter(g => g.match || g.industries.length > 0)
      .map(g => ({ gics: g.gics, industries: g.match && g.industries.length === 0 ? GICS_SECTORS[g.gics] ?? [] : g.industries }));
  }, [groupedSectors, sectorSearch]);

  const toggleSector = (sec: string) => {
    setExcludedSectors(prev => {
      const next = new Set(prev);
      if (next.has(sec)) next.delete(sec); else next.add(sec);
      return next;
    });
  };

  // Expanded set (lowercased industry strings) for fast membership testing
  const expandedExclusions = useMemo(
    () => expandSelectedToIndustries(excludedSectors),
    [excludedSectors]
  );

  const filtered = useMemo(() => {
    let list = stocks.filter(s => {
      if (excludeOtc && isOtcSymbol(s.symbol)) return false;
      const rating = ratingMap.get(s.symbol);
      if (rating === null || rating === undefined || rating < minRating) return false;
      if (s.adrPercent === null || s.adrPercent < minAdr) return false;
      if (acceleratingOnly) {
        if (s.rs1m === null || s.rs3m === null || !(s.rs1m > s.rs3m)) return false;
      }
      if (excludeSectorsOn && excludedSectors.size > 0) {
        const expanded = expandedExclusions;
        if (s.sector && expanded.has(s.sector.toLowerCase().trim())) return false;
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
  }, [stocks, ratingMap, minRating, minAdr, acceleratingOnly, excludeOtc, sortBy, topN, tabId, getRsForTab, getReturnField, isOtcSymbol, excludeSectorsOn, excludedSectors]);

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

          {/* Exclude Sector / Industry */}
          <div className="space-y-2 rounded-md border border-border bg-muted/20 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <Checkbox checked={excludeSectorsOn} onCheckedChange={(v) => setExcludeSectorsOn(!!v)} />
                <span>
                  <span className="font-medium text-foreground">Exclude Sector / Industry</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {excludeSectorsOn
                      ? excludedSectors.size > 0
                        ? `${excludedSectors.size} excluded`
                        : "Pick sectors to exclude"
                      : "Off"}
                  </span>
                </span>
              </label>
              <Popover open={sectorPopoverOpen} onOpenChange={setSectorPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    disabled={!excludeSectorsOn}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {excludedSectors.size > 0 ? `${excludedSectors.size} selected` : "Choose sectors"}
                    <ChevronDown size={12} />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="end">
                  <div className="border-b border-border p-2">
                    <Input
                      autoFocus
                      placeholder="Search GICS sectors or industries…"
                      value={sectorSearch}
                      onChange={(e) => setSectorSearch(e.target.value)}
                      className="h-7 text-xs"
                    />
                  </div>
                  <div className="max-h-72 overflow-y-auto py-1">
                    {filteredGroups.length === 0 ? (
                      <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
                        No matches
                      </div>
                    ) : filteredGroups.map(group => {
                      const gicsChecked = excludedSectors.has(group.gics);
                      const childCount = group.industries.filter(i => universeIndustries.has(i)).length;
                      return (
                        <div key={group.gics} className="border-b border-border/40 last:border-b-0">
                          {/* GICS sector header — clickable to toggle the whole group */}
                          <button
                            onClick={() => toggleSector(group.gics)}
                            className="flex w-full items-center justify-between gap-2 bg-muted/40 px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide hover:bg-accent"
                          >
                            <span className={gicsChecked ? "text-primary" : "text-foreground"}>
                              {group.gics}
                              {childCount > 0 && (
                                <span className="ml-1.5 font-normal normal-case text-[10px] text-muted-foreground">
                                  ({childCount} in universe)
                                </span>
                              )}
                            </span>
                            {gicsChecked && <Check size={12} className="text-primary" />}
                          </button>
                          {/* Child industries */}
                          {group.industries.map(ind => {
                            const checked = excludedSectors.has(ind);
                            const inUniverse = universeIndustries.has(ind);
                            const coveredByGics = gicsChecked;
                            return (
                              <button
                                key={`${group.gics}-${ind}`}
                                onClick={() => toggleSector(ind)}
                                disabled={coveredByGics}
                                className="flex w-full items-center justify-between gap-2 pl-6 pr-3 py-1 text-left text-xs hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <span className={
                                  checked || coveredByGics
                                    ? "font-medium text-foreground"
                                    : inUniverse ? "text-foreground/80" : "text-muted-foreground"
                                }>
                                  {ind}
                                  {!inUniverse && <span className="ml-1 text-[9px] text-muted-foreground">·n/a</span>}
                                </span>
                                {(checked || coveredByGics) && <Check size={12} className="text-primary" />}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                  {excludedSectors.size > 0 && (
                    <div className="flex items-center justify-between border-t border-border px-2 py-1.5">
                      <span className="text-[10px] text-muted-foreground">{excludedSectors.size} selected</span>
                      <button
                        onClick={() => setExcludedSectors(new Set())}
                        className="text-[10px] font-medium text-primary hover:underline"
                      >
                        Clear all
                      </button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>
            {excludeSectorsOn && excludedSectors.size > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {Array.from(excludedSectors).map(sec => (
                  <button
                    key={sec}
                    onClick={() => toggleSector(sec)}
                    className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/20"
                    title="Click to remove"
                  >
                    {sec}
                    <X size={10} />
                  </button>
                ))}
              </div>
            )}
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
