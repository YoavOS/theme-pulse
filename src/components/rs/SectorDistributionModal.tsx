import { useMemo, useState } from "react";
import { PieChart as PieChartIcon, ChevronDown, Check, Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Sector } from "recharts";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { RsStock } from "@/hooks/useRsAlpha";
import { ALL_GICS_SECTORS, GICS_SECTORS, expandSelectedToIndustries, gicsForIndustry } from "@/lib/sectorTaxonomy";
import RsRatingBadge from "@/components/rs/RsRatingBadge";

export type SectorTab = "overall" | "1d" | "1w" | "1m" | "3m" | "6m";
type SortBy = "rs" | "rating" | "return";
const TOPN_MIN = 10;
const TOPN_MAX = 500;

// HSL palette tuned for dark background (good contrast, distinct hues)
const SLICE_COLORS = [
  "hsl(160, 70%, 50%)", "hsl(200, 80%, 55%)", "hsl(280, 65%, 60%)",
  "hsl(30, 85%, 55%)",  "hsl(340, 75%, 60%)", "hsl(50, 85%, 55%)",
  "hsl(180, 70%, 50%)", "hsl(260, 70%, 65%)", "hsl(15, 80%, 60%)",
  "hsl(100, 55%, 50%)", "hsl(220, 70%, 60%)", "hsl(320, 60%, 60%)",
];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tabId: SectorTab;
  tabLabel: string;
  stocks: RsStock[];
  ratingMap: Map<string, number | null>;
  getRsForTab: (s: RsStock, t: SectorTab) => number | null;
  getReturnField: (s: RsStock, t: SectorTab) => number | null;
  isOtcSymbol: (sym: string) => boolean;
}

interface SliceDatum {
  gics: string;
  count: number;
  pct: number;
  stocks: { symbol: string; rs: number | null; rating: number | null; ret: number | null; industry: string | null }[];
}

export default function SectorDistributionModal({
  open, onOpenChange, tabId, tabLabel, stocks, ratingMap,
  getRsForTab, getReturnField, isOtcSymbol,
}: Props) {
  const [minRating, setMinRating] = useState(60);
  const [topN, setTopN] = useState(TOPN_MAX); // default All
  const [acceleratingOnly, setAcceleratingOnly] = useState(false);
  const [minAdr, setMinAdr] = useState(3.0);
  const [excludeOtc, setExcludeOtc] = useState(true);
  const [excludeSectorsOn, setExcludeSectorsOn] = useState(false);
  const [excludedSectors, setExcludedSectors] = useState<Set<string>>(new Set());
  const [sectorSearch, setSectorSearch] = useState("");
  const [sectorPopoverOpen, setSectorPopoverOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [expandedSlice, setExpandedSlice] = useState<string | null>(null);

  const universeIndustries = useMemo(() => {
    const set = new Set<string>();
    stocks.forEach(s => { if (s.sector && s.sector.trim()) set.add(s.sector.trim()); });
    return set;
  }, [stocks]);

  const groupedSectors = useMemo(() => {
    const groups: { gics: string; industries: string[] }[] = [];
    const mappedLower = new Set<string>();
    for (const gics of ALL_GICS_SECTORS) {
      const industries = [...GICS_SECTORS[gics]].sort();
      industries.forEach(i => mappedLower.add(i.toLowerCase().trim()));
      groups.push({ gics, industries });
    }
    const other: string[] = [];
    universeIndustries.forEach(ind => {
      if (!mappedLower.has(ind.toLowerCase().trim())) other.push(ind);
    });
    if (other.length > 0) groups.push({ gics: "Other", industries: other.sort() });
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

  const expandedExclusions = useMemo(() => expandSelectedToIndustries(excludedSectors), [excludedSectors]);

  // Apply filters → sorted list (by RS desc) → top N
  const filteredStocks = useMemo(() => {
    let list = stocks.filter(s => {
      if (excludeOtc && isOtcSymbol(s.symbol)) return false;
      const rating = ratingMap.get(s.symbol);
      if (rating === null || rating === undefined || rating < minRating) return false;
      if (s.adrPercent === null || s.adrPercent < minAdr) return false;
      if (acceleratingOnly) {
        if (s.rs1m === null || s.rs3m === null || !(s.rs1m > s.rs3m)) return false;
      }
      if (excludeSectorsOn && excludedSectors.size > 0) {
        if (s.sector && expandedExclusions.has(s.sector.toLowerCase().trim())) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => (getRsForTab(b, tabId) ?? -999) - (getRsForTab(a, tabId) ?? -999));
    if (topN < TOPN_MAX) list = list.slice(0, topN);
    return list;
  }, [stocks, ratingMap, minRating, minAdr, acceleratingOnly, excludeOtc, excludeSectorsOn, excludedSectors, expandedExclusions, topN, tabId, getRsForTab, isOtcSymbol]);

  // Bucket by GICS sector
  const sliceData: SliceDatum[] = useMemo(() => {
    const buckets = new Map<string, SliceDatum["stocks"]>();
    for (const s of filteredStocks) {
      const gics = gicsForIndustry(s.sector) ?? (s.sector ? "Other" : "Unknown");
      const arr = buckets.get(gics) ?? [];
      arr.push({
        symbol: s.symbol,
        rs: getRsForTab(s, tabId),
        rating: ratingMap.get(s.symbol) ?? null,
        ret: getReturnField(s, tabId),
        industry: s.sector,
      });
      buckets.set(gics, arr);
    }
    const total = filteredStocks.length || 1;
    const out: SliceDatum[] = [];
    buckets.forEach((arr, gics) => {
      arr.sort((a, b) => (b.rs ?? -999) - (a.rs ?? -999));
      out.push({ gics, count: arr.length, pct: (arr.length / total) * 100, stocks: arr });
    });
    out.sort((a, b) => b.count - a.count);
    return out;
  }, [filteredStocks, getRsForTab, getReturnField, ratingMap, tabId]);

  const totalCount = filteredStocks.length;
  const topNLabel = topN >= TOPN_MAX ? "All" : `Top ${topN}`;
  const topNPresets = [10, 25, 50, 100, 200, TOPN_MAX];

  // Active shape: subtle outer ring on hover/click
  const renderActiveShape = (props: any) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
    return (
      <g>
        <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 6} startAngle={startAngle} endAngle={endAngle} fill={fill} />
        <Sector cx={cx} cy={cy} innerRadius={outerRadius + 8} outerRadius={outerRadius + 11} startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.4} />
      </g>
    );
  };

  const expandedDatum = expandedSlice ? sliceData.find(d => d.gics === expandedSlice) ?? null : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-['Syne',sans-serif]">
            <PieChartIcon size={16} className="text-primary" />
            Sector Distribution · {tabLabel}
          </DialogTitle>
          <DialogDescription className="text-xs">
            GICS sector breakdown of <strong className="text-foreground">{totalCount}</strong> stocks matching your filters. Hover a slice for details, click to expand.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 py-2 lg:grid-cols-[1fr_320px]">
          {/* LEFT: Pie + legend + expanded panel */}
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-card/50 p-3">
              {totalCount === 0 ? (
                <div className="flex h-[320px] items-center justify-center text-xs text-muted-foreground">
                  No stocks match the current filters.
                </div>
              ) : (
                <div className="h-[340px] w-full animate-fade-in">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={sliceData}
                        dataKey="count"
                        nameKey="gics"
                        cx="50%"
                        cy="50%"
                        innerRadius={70}
                        outerRadius={120}
                        paddingAngle={1}
                        activeIndex={activeIndex ?? undefined}
                        activeShape={renderActiveShape}
                        onMouseEnter={(_, i) => setActiveIndex(i)}
                        onMouseLeave={() => setActiveIndex(null)}
                        onClick={(d: any) => setExpandedSlice(prev => prev === d.gics ? null : d.gics)}
                        isAnimationActive
                      >
                        {sliceData.map((_, i) => (
                          <Cell key={i} fill={SLICE_COLORS[i % SLICE_COLORS.length]} stroke="hsl(var(--background))" strokeWidth={2} className="cursor-pointer" />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        cursor={false}
                        contentStyle={{
                          background: "hsl(var(--background))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                          padding: "8px 10px",
                        }}
                        content={({ active, payload }) => {
                          if (!active || !payload || !payload.length) return null;
                          const d = payload[0].payload as SliceDatum;
                          const top = d.stocks.slice(0, 5);
                          return (
                            <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-xl">
                              <div className="mb-1 flex items-center justify-between gap-3">
                                <span className="font-semibold text-foreground">{d.gics}</span>
                                <span className="font-mono text-primary">{d.pct.toFixed(1)}%</span>
                              </div>
                              <div className="mb-2 text-[10px] text-muted-foreground">{d.count} stock{d.count === 1 ? "" : "s"}</div>
                              <div className="space-y-0.5 border-t border-border/50 pt-1.5">
                                {top.map(s => (
                                  <div key={s.symbol} className="flex items-center justify-between gap-3 text-[11px]">
                                    <span className="font-mono font-semibold text-foreground">{s.symbol}</span>
                                    <span className="font-mono text-muted-foreground">
                                      RS {s.rs !== null ? `${s.rs >= 0 ? "+" : ""}${s.rs.toFixed(1)}` : "—"} · #{s.rating ?? "—"}
                                    </span>
                                  </div>
                                ))}
                                {d.stocks.length > top.length && (
                                  <div className="pt-1 text-[10px] italic text-muted-foreground">
                                    +{d.stocks.length - top.length} more · click slice to expand
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Legend */}
              {sliceData.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2 border-t border-border/50 pt-2">
                  {sliceData.map((d, i) => {
                    const active = expandedSlice === d.gics;
                    return (
                      <button
                        key={d.gics}
                        onMouseEnter={() => setActiveIndex(i)}
                        onMouseLeave={() => setActiveIndex(null)}
                        onClick={() => setExpandedSlice(prev => prev === d.gics ? null : d.gics)}
                        className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] transition-all hover:scale-105 ${active ? "border-primary bg-primary/10" : "border-border bg-muted/20"}`}
                      >
                        <span className="h-2 w-2 rounded-full" style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                        <span className="font-medium text-foreground">{d.gics}</span>
                        <span className="font-mono text-muted-foreground">{d.pct.toFixed(1)}% ({d.count})</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Expanded sector details */}
            {expandedDatum && (
              <div className="animate-fade-in rounded-lg border border-primary/30 bg-card p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-foreground">{expandedDatum.gics}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {expandedDatum.count} stocks · {expandedDatum.pct.toFixed(1)}% of selection
                    </div>
                  </div>
                  <button
                    onClick={() => setExpandedSlice(null)}
                    className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    Close
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-border text-[10px] text-muted-foreground">
                        <th className="px-2 py-1 text-left">#</th>
                        <th className="px-2 py-1 text-left">Ticker</th>
                        <th className="px-2 py-1 text-center">Rating</th>
                        <th className="px-2 py-1 text-right">RS</th>
                        <th className="px-2 py-1 text-right">Return</th>
                        <th className="px-2 py-1 text-left">Industry</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expandedDatum.stocks.map((s, i) => (
                        <tr key={s.symbol} className="border-b border-border/40 hover:bg-muted/20">
                          <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                          <td className="px-2 py-1 font-mono font-semibold text-foreground">{s.symbol}</td>
                          <td className="px-2 py-1 text-center"><RsRatingBadge rating={s.rating} /></td>
                          <td className={`px-2 py-1 text-right font-mono ${s.rs !== null && s.rs >= 0 ? "text-[hsl(160,70%,50%)]" : "text-destructive/80"}`}>
                            {s.rs !== null ? `${s.rs >= 0 ? "+" : ""}${s.rs.toFixed(2)}%` : "—"}
                          </td>
                          <td className={`px-2 py-1 text-right font-mono ${s.ret !== null && s.ret >= 0 ? "text-[hsl(160,60%,55%)]" : "text-destructive/80"}`}>
                            {s.ret !== null ? `${s.ret >= 0 ? "+" : ""}${s.ret.toFixed(2)}%` : "—"}
                          </td>
                          <td className="px-2 py-1 text-muted-foreground">{s.industry ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: Filter panel */}
          <div className="space-y-3 rounded-lg border border-border bg-muted/10 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Filters</div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label className="font-medium text-foreground">Min RS Rating</label>
                <span className="font-mono text-primary">{minRating}</span>
              </div>
              <Slider min={1} max={99} step={1} value={[minRating]} onValueChange={(v) => setMinRating(v[0])} />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label className="font-medium text-foreground">Min ADR</label>
                <span className="font-mono text-primary">{minAdr.toFixed(1)}%</span>
              </div>
              <Slider min={1} max={10} step={0.1} value={[minAdr]} onValueChange={(v) => setMinAdr(v[0])} />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label className="font-medium text-foreground">Top N</label>
                <span className="font-mono text-primary">{topNLabel}</span>
              </div>
              <Slider min={TOPN_MIN} max={TOPN_MAX} step={1} value={[topN]} onValueChange={(v) => setTopN(v[0])} />
              <div className="flex flex-wrap gap-1 pt-0.5">
                {topNPresets.map(v => {
                  const label = v >= TOPN_MAX ? "All" : `${v}`;
                  const active = topN === v;
                  return (
                    <button
                      key={v}
                      onClick={() => setTopN(v)}
                      className={`rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors ${active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-2.5 py-1.5 text-xs cursor-pointer">
              <Checkbox checked={acceleratingOnly} onCheckedChange={(v) => setAcceleratingOnly(!!v)} />
              <span>
                <span className="font-medium text-foreground">Accelerating Only</span>
                <span className="block text-[10px] text-muted-foreground">1M RS &gt; 3M RS</span>
              </span>
            </label>

            <label className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-2.5 py-1.5 text-xs cursor-pointer">
              <Checkbox checked={excludeOtc} onCheckedChange={(v) => setExcludeOtc(!!v)} />
              <span>
                <span className="font-medium text-foreground">Exclude OTC Stocks</span>
                <span className="block text-[10px] text-muted-foreground">Hide foreign / pink sheets</span>
              </span>
            </label>

            {/* Exclude sectors */}
            <div className="space-y-1.5 rounded-md border border-border bg-muted/20 px-2.5 py-2">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox checked={excludeSectorsOn} onCheckedChange={(v) => setExcludeSectorsOn(!!v)} />
                  <span className="font-medium text-foreground">Exclude Sectors</span>
                </label>
                <Popover open={sectorPopoverOpen} onOpenChange={setSectorPopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      disabled={!excludeSectorsOn}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {excludedSectors.size > 0 ? `${excludedSectors.size}` : "Pick"}
                      <ChevronDown size={10} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-0" align="end">
                    <div className="border-b border-border p-2">
                      <Input
                        autoFocus
                        placeholder="Search sectors…"
                        value={sectorSearch}
                        onChange={(e) => setSectorSearch(e.target.value)}
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="max-h-64 overflow-y-auto py-1">
                      {filteredGroups.map(group => {
                        const gicsChecked = excludedSectors.has(group.gics);
                        return (
                          <div key={group.gics} className="border-b border-border/40 last:border-b-0">
                            <button
                              onClick={() => toggleSector(group.gics)}
                              className="flex w-full items-center justify-between gap-2 bg-muted/40 px-2.5 py-1 text-left text-[10px] font-semibold uppercase tracking-wide hover:bg-accent"
                            >
                              <span className={gicsChecked ? "text-primary" : "text-foreground"}>{group.gics}</span>
                              {gicsChecked && <Check size={11} className="text-primary" />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {excludedSectors.size > 0 && (
                      <div className="flex items-center justify-between border-t border-border px-2 py-1">
                        <span className="text-[10px] text-muted-foreground">{excludedSectors.size} selected</span>
                        <button onClick={() => setExcludedSectors(new Set())} className="text-[10px] font-medium text-primary hover:underline">Clear all</button>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
              {excludeSectorsOn && excludedSectors.size > 0 && (
                <div className="flex flex-wrap gap-1">
                  {Array.from(excludedSectors).map(sec => (
                    <button
                      key={sec}
                      onClick={() => toggleSector(sec)}
                      className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive hover:bg-destructive/20"
                    >
                      {sec} ✕
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-[11px] text-foreground">
              <span className="font-mono font-semibold text-primary">{totalCount}</span> stock{totalCount === 1 ? "" : "s"} across <span className="font-mono font-semibold text-primary">{sliceData.length}</span> sector{sliceData.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
