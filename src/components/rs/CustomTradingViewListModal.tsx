import { useEffect, useMemo, useState } from "react";
import { Copy, Download, Settings2, X, Check, ChevronDown, Sparkles, Save, Trash2 } from "lucide-react";
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
import { useDailyCandles } from "@/hooks/useDailyCandles";
import CandleSummaryBar from "@/components/rs/CandleSummaryBar";

export type CustomListTab = "overall" | "1d" | "1w" | "1m" | "3m" | "6m";
type SortBy =
  | "rs"
  | "rating"
  | "return"
  | "coil"
  | "ema9d"
  | "ema21d"
  | "ema9w"
  | "relVsQqq";
const TOPN_MIN = 10;
const TOPN_MAX = 500; // values >= MAX mean "All"

export interface CoilScoreInfo {
  score: number | null;
  recentAvgRangePct?: number | null;
  baselineAvgRangePct?: number | null;
}

export interface EmaDistanceInfo {
  dist9d: number | null;
  dist21d: number | null;
  dist9w: number | null;
  ema9d?: number | null;
  ema21d?: number | null;
  ema9w?: number | null;
}

interface FilterState {
  minRating: number;
  topN: number;
  acceleratingOnly: boolean;
  minAdr: number;
  excludeOtc: boolean;
  sortBy: SortBy;
  excludeSectorsOn: boolean;
  excludedSectors: string[];
  growthFilters: GrowthFiltersState;
  coilFilterOn: boolean;
  maxCoil: number;
  ema9dFilterOn: boolean;
  maxEma9dAbs: number;
  ema21dFilterOn: boolean;
  maxEma21dAbs: number;
  ema9wFilterOn: boolean;
  maxEma9wAbs: number;
  emaFilterMode: "AND" | "OR";
  relVsQqqOn: boolean;
  minRelVsQqq: number;
  priceVs9dOn: boolean;
  priceVs9dDir: "above" | "below";
  priceVs21dOn: boolean;
  priceVs21dDir: "above" | "below";
  priceVs9wOn: boolean;
  priceVs9wDir: "above" | "below";
}

interface ScannerProfile {
  id: string;
  name: string;
  description?: string;
  isBuiltIn?: boolean;
  criteria: Partial<FilterState>;
}

const PROFILES_KEY = "rs_alpha_scanner_profiles_v1";

const BUILTIN_PROFILES: ScannerProfile[] = [
  {
    id: "builtin:red-day-leaders",
    name: "Red Day Leaders / Market Defiers",
    description: "RS ≥ 75 + outperforming QQQ today. Spot leadership when the market is weak.",
    isBuiltIn: true,
    criteria: {
      minRating: 75,
      relVsQqqOn: true,
      minRelVsQqq: 0,
      sortBy: "relVsQqq",
    },
  },
  {
    id: "builtin:coiled-leaders",
    name: "Coiled Leaders",
    description: "Strong RS + extreme tight range. Setting up for breakouts.",
    isBuiltIn: true,
    criteria: {
      minRating: 80,
      coilFilterOn: true,
      maxCoil: 0.7,
      sortBy: "coil",
    },
  },
  {
    id: "builtin:9w-ema-pullbacks",
    name: "9W EMA Pullbacks",
    description: "High-RS stocks pulling back to the 9-week EMA — buy-the-dip on leaders.",
    isBuiltIn: true,
    criteria: {
      minRating: 75,
      ema9wFilterOn: true,
      maxEma9wAbs: 3,
      sortBy: "ema9w",
    },
  },
  {
    id: "builtin:21d-pullbacks",
    name: "21D EMA Pullbacks",
    description: "High-RS leaders within ±3% of the 21-day EMA — short-term entries.",
    isBuiltIn: true,
    criteria: {
      minRating: 80,
      ema21dFilterOn: true,
      maxEma21dAbs: 3,
      sortBy: "ema21d",
    },
  },
  {
    id: "builtin:pullback-buys-or",
    name: "Pullback Buys (9W or 21D)",
    description: "Strong RS pulling back to the 9W EMA OR the 21D EMA — broad pullback hunting.",
    isBuiltIn: true,
    criteria: {
      minRating: 75,
      ema9wFilterOn: true,
      maxEma9wAbs: 3,
      ema21dFilterOn: true,
      maxEma21dAbs: 3,
      emaFilterMode: "OR",
      sortBy: "ema9w",
    },
  },
  {
    id: "builtin:high-rs-tight-range",
    name: "High RS + Tight Range",
    description: "Top-quintile RS combined with a tight coil — breakout candidates.",
    isBuiltIn: true,
    criteria: {
      minRating: 85,
      coilFilterOn: true,
      maxCoil: 0.8,
      sortBy: "rs",
    },
  },
];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tabId: CustomListTab;
  tabLabel: string;
  stocks: RsStock[];
  ratingMap: Map<string, number | null>;
  getRsForTab: (s: RsStock, t: CustomListTab) => number | null;
  getReturnField: (s: RsStock, t: CustomListTab) => number | null;
  isOtcSymbol: (sym: string) => boolean;
  fundamentalsMap?: Map<string, StockFundamentals>;
  coilScores?: Map<string, CoilScoreInfo>;
  coilShortDays?: number;
  coilLongDays?: number;
  emaDistances?: Map<string, EmaDistanceInfo>;
  /** Today's QQQ % change (used for "Red Day Leaders" / market-defiance filtering). */
  qqqPctChange?: number | null;
}

const DEFAULT_FILTERS: FilterState = {
  minRating: 60,
  topN: 50,
  acceleratingOnly: false,
  minAdr: 3.0,
  excludeOtc: true,
  sortBy: "rs",
  excludeSectorsOn: false,
  excludedSectors: [],
  growthFilters: { ...DEFAULT_GROWTH_FILTERS },
  coilFilterOn: false,
  maxCoil: 0.85,
  ema9dFilterOn: false,
  maxEma9dAbs: 3,
  ema21dFilterOn: false,
  maxEma21dAbs: 3,
  ema9wFilterOn: false,
  maxEma9wAbs: 5,
  emaFilterMode: "OR",
  relVsQqqOn: false,
  minRelVsQqq: 0,
  priceVs9dOn: false,
  priceVs9dDir: "above",
  priceVs21dOn: false,
  priceVs21dDir: "above",
  priceVs9wOn: false,
  priceVs9wDir: "above",
};

function loadUserProfiles(): ScannerProfile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && typeof p.id === "string" && typeof p.name === "string");
  } catch {
    return [];
  }
}

function saveUserProfiles(list: ScannerProfile[]) {
  try { localStorage.setItem(PROFILES_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

export default function CustomTradingViewListModal({
  open, onOpenChange, tabId, tabLabel, stocks, ratingMap,
  getRsForTab, getReturnField, isOtcSymbol, fundamentalsMap,
  coilScores, coilShortDays, coilLongDays, emaDistances, qqqPctChange,
}: Props) {
  const [state, setState] = useState<FilterState>({ ...DEFAULT_FILTERS });
  const [sectorSearch, setSectorSearch] = useState<string>("");
  const [sectorPopoverOpen, setSectorPopoverOpen] = useState<boolean>(false);
  const [userProfiles, setUserProfiles] = useState<ScannerProfile[]>(() => loadUserProfiles());
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [profilePopoverOpen, setProfilePopoverOpen] = useState(false);

  const allProfiles = useMemo(() => [...BUILTIN_PROFILES, ...userProfiles], [userProfiles]);
  const excludedSectorsSet = useMemo(() => new Set(state.excludedSectors), [state.excludedSectors]);

  const growthActive = anyActive(state.growthFilters);
  const fundamentalsAvailable = (fundamentalsMap?.size ?? 0) > 0;
  const coilAvailable = (coilScores?.size ?? 0) > 0;
  const emaAvailable = (emaDistances?.size ?? 0) > 0;
  const qqqAvailable = qqqPctChange !== null && qqqPctChange !== undefined;

  const set = <K extends keyof FilterState>(k: K, v: FilterState[K]) => setState((p) => ({ ...p, [k]: v }));

  // Apply a profile's criteria on top of defaults (so profiles don't carry stale state).
  const applyProfile = (p: ScannerProfile) => {
    setState({ ...DEFAULT_FILTERS, ...p.criteria, growthFilters: { ...DEFAULT_GROWTH_FILTERS, ...(p.criteria.growthFilters ?? {}) } });
    setSelectedProfileId(p.id);
    toast.success(`Applied: ${p.name}`);
  };

  const handleSaveProfile = () => {
    const name = window.prompt("Save current filters as a new scanner profile. Name?");
    if (!name || !name.trim()) return;
    const profile: ScannerProfile = {
      id: `user:${Date.now()}`,
      name: name.trim(),
      criteria: {
        minRating: state.minRating,
        topN: state.topN,
        acceleratingOnly: state.acceleratingOnly,
        minAdr: state.minAdr,
        excludeOtc: state.excludeOtc,
        sortBy: state.sortBy,
        excludeSectorsOn: state.excludeSectorsOn,
        excludedSectors: state.excludedSectors,
        growthFilters: state.growthFilters,
        coilFilterOn: state.coilFilterOn,
        maxCoil: state.maxCoil,
        ema9dFilterOn: state.ema9dFilterOn,
        maxEma9dAbs: state.maxEma9dAbs,
        ema21dFilterOn: state.ema21dFilterOn,
        maxEma21dAbs: state.maxEma21dAbs,
        ema9wFilterOn: state.ema9wFilterOn,
        maxEma9wAbs: state.maxEma9wAbs,
        relVsQqqOn: state.relVsQqqOn,
        minRelVsQqq: state.minRelVsQqq,
      },
    };
    const next = [...userProfiles, profile];
    setUserProfiles(next);
    saveUserProfiles(next);
    setSelectedProfileId(profile.id);
    toast.success(`Saved: ${profile.name}`);
  };

  const handleDeleteProfile = (id: string) => {
    const next = userProfiles.filter((p) => p.id !== id);
    setUserProfiles(next);
    saveUserProfiles(next);
    if (selectedProfileId === id) setSelectedProfileId("");
  };

  // Industries actually present in the qualified universe (used to show counts and an "Other" group)
  const universeIndustries = useMemo(() => {
    const setX = new Set<string>();
    stocks.forEach((s) => { if (s.sector && s.sector.trim()) setX.add(s.sector.trim()); });
    return setX;
  }, [stocks]);

  const groupedSectors = useMemo(() => {
    const groups: { gics: string; industries: string[] }[] = [];
    const mappedLower = new Set<string>();
    for (const gics of ALL_GICS_SECTORS) {
      const industries = [...GICS_SECTORS[gics]].sort((a, b) => a.localeCompare(b));
      industries.forEach((i) => mappedLower.add(i.toLowerCase().trim()));
      groups.push({ gics, industries });
    }
    const other: string[] = [];
    universeIndustries.forEach((ind) => {
      if (!mappedLower.has(ind.toLowerCase().trim())) other.push(ind);
    });
    if (other.length > 0) groups.push({ gics: "Other", industries: other.sort((a, b) => a.localeCompare(b)) });
    return groups;
  }, [universeIndustries]);

  const filteredGroups = useMemo(() => {
    const q = sectorSearch.trim().toLowerCase();
    if (!q) return groupedSectors;
    return groupedSectors
      .map((g) => ({
        gics: g.gics,
        industries: g.industries.filter((i) => i.toLowerCase().includes(q)),
        match: g.gics.toLowerCase().includes(q),
      }))
      .filter((g) => g.match || g.industries.length > 0)
      .map((g) => ({ gics: g.gics, industries: g.match && g.industries.length === 0 ? GICS_SECTORS[g.gics] ?? [] : g.industries }));
  }, [groupedSectors, sectorSearch]);

  const toggleSector = (sec: string) => {
    setState((p) => {
      const next = new Set(p.excludedSectors);
      if (next.has(sec)) next.delete(sec); else next.add(sec);
      return { ...p, excludedSectors: Array.from(next) };
    });
  };

  const expandedExclusions = useMemo(() => expandSelectedToIndustries(excludedSectorsSet), [excludedSectorsSet]);

  const filtered = useMemo(() => {
    let list = stocks.filter((s) => {
      if (state.excludeOtc && isOtcSymbol(s.symbol)) return false;
      const rating = ratingMap.get(s.symbol);
      if (rating === null || rating === undefined || rating < state.minRating) return false;
      if (s.adrPercent === null || s.adrPercent < state.minAdr) return false;
      if (state.acceleratingOnly) {
        if (s.rs1m === null || s.rs3m === null || !(s.rs1m > s.rs3m)) return false;
      }
      if (state.excludeSectorsOn && excludedSectorsSet.size > 0) {
        if (s.sector && expandedExclusions.has(s.sector.toLowerCase().trim())) return false;
      }
      if (growthActive) {
        const f = fundamentalsMap?.get(s.symbol);
        if (!passesAllActiveFilters(state.growthFilters, f)) return false;
      }
      if (state.coilFilterOn) {
        const c = coilScores?.get(s.symbol)?.score;
        if (c === null || c === undefined || !Number.isFinite(c)) return false;
        if (c > state.maxCoil) return false;
      }
      const ema = emaDistances?.get(s.symbol);
      const emaActiveCount = (state.ema9dFilterOn ? 1 : 0) + (state.ema21dFilterOn ? 1 : 0) + (state.ema9wFilterOn ? 1 : 0);
      if (emaActiveCount > 0) {
        const checks: boolean[] = [];
        if (state.ema9dFilterOn) {
          const d = ema?.dist9d;
          checks.push(d !== null && d !== undefined && Number.isFinite(d) && Math.abs(d) <= state.maxEma9dAbs);
      }
      // Price vs EMA direction filters (uses sign of distance: dist > 0 => price above EMA)
      const priceVsChecks: Array<{ on: boolean; dist: number | null | undefined; dir: "above" | "below" }> = [
        { on: state.priceVs9dOn, dist: ema?.dist9d, dir: state.priceVs9dDir },
        { on: state.priceVs21dOn, dist: ema?.dist21d, dir: state.priceVs21dDir },
        { on: state.priceVs9wOn, dist: ema?.dist9w, dir: state.priceVs9wDir },
      ];
      for (const c of priceVsChecks) {
        if (!c.on) continue;
        if (c.dist === null || c.dist === undefined || !Number.isFinite(c.dist)) return false;
        if (c.dir === "above" && !(c.dist > 0)) return false;
        if (c.dir === "below" && !(c.dist < 0)) return false;
      }
        if (state.ema21dFilterOn) {
          const d = ema?.dist21d;
          checks.push(d !== null && d !== undefined && Number.isFinite(d) && Math.abs(d) <= state.maxEma21dAbs);
        }
        if (state.ema9wFilterOn) {
          const d = ema?.dist9w;
          checks.push(d !== null && d !== undefined && Number.isFinite(d) && Math.abs(d) <= state.maxEma9wAbs);
        }
        const pass = state.emaFilterMode === "OR" ? checks.some(Boolean) : checks.every(Boolean);
        if (!pass) return false;
      }
      if (state.relVsQqqOn && qqqAvailable) {
        // s.return1d typically holds today's % change for the stock.
        const todayPct = s.return1d;
        if (todayPct === null || todayPct === undefined) return false;
        const rel = todayPct - (qqqPctChange ?? 0);
        if (rel < state.minRelVsQqq) return false;
      }
      return true;
    });

    list = [...list].sort((a, b) => {
      switch (state.sortBy) {
        case "rs":      return (getRsForTab(b, tabId) ?? -999) - (getRsForTab(a, tabId) ?? -999);
        case "rating":  return (ratingMap.get(b.symbol) ?? -1) - (ratingMap.get(a.symbol) ?? -1);
        case "return":  return (getReturnField(b, tabId) ?? -999) - (getReturnField(a, tabId) ?? -999);
        case "coil": {
          const av = coilScores?.get(a.symbol)?.score ?? 999;
          const bv = coilScores?.get(b.symbol)?.score ?? 999;
          return av - bv;
        }
        case "ema9d":
        case "ema21d":
        case "ema9w": {
          const key = state.sortBy === "ema9d" ? "dist9d" : state.sortBy === "ema21d" ? "dist21d" : "dist9w";
          const av = emaDistances?.get(a.symbol)?.[key];
          const bv = emaDistances?.get(b.symbol)?.[key];
          const aa = av === null || av === undefined ? Infinity : Math.abs(av);
          const bb = bv === null || bv === undefined ? Infinity : Math.abs(bv);
          return aa - bb;
        }
        case "relVsQqq": {
          const aPct = (a.return1d ?? -999) - (qqqPctChange ?? 0);
          const bPct = (b.return1d ?? -999) - (qqqPctChange ?? 0);
          return bPct - aPct;
        }
      }
    });

    if (state.topN < TOPN_MAX) list = list.slice(0, state.topN);
    return list;
  }, [stocks, ratingMap, state, excludedSectorsSet, expandedExclusions, growthActive, fundamentalsMap, coilScores, emaDistances, qqqPctChange, qqqAvailable, tabId, getRsForTab, getReturnField, isOtcSymbol]);

  const symbols = filtered.map((s) => s.symbol);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(symbols.join(","));
      toast.success(`${symbols.length} symbols copied to clipboard.`, { description: "Paste into TradingView Watchlist → Import symbols." });
    } catch { toast.error("Could not copy to clipboard."); }
  };

  const handleDownload = () => {
    const blob = new Blob([symbols.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const safe = tabLabel.replace(/\s+/g, "");
    const a = document.createElement("a");
    a.href = url; a.download = `RS_Custom_${safe}_${symbols.length}tickers.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${symbols.length} symbols.`, { description: "One ticker per line — ready for TradingView import." });
  };

  const isAll = state.topN >= TOPN_MAX;
  const topNLabel = isAll ? "All" : `Top ${state.topN}`;
  const topNPresets = [10, 25, 50, 100, 200, TOPN_MAX];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
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
          {/* ── Scanner Profiles ── */}
          <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <Sparkles size={13} className="text-primary" />
                Scanner Profiles
              </div>
              <button
                onClick={handleSaveProfile}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[10px] font-medium hover:bg-accent"
                title="Save current filters as a new profile"
              >
                <Save size={10} /> Save current as profile…
              </button>
            </div>
            <Popover open={profilePopoverOpen} onOpenChange={setProfilePopoverOpen}>
              <PopoverTrigger asChild>
                <button className="flex w-full items-center justify-between rounded-md border border-border bg-background px-2.5 py-1.5 text-xs hover:bg-accent">
                  <span className="text-foreground">
                    {selectedProfileId
                      ? allProfiles.find((p) => p.id === selectedProfileId)?.name ?? "Choose a profile…"
                      : "Choose a profile…"}
                  </span>
                  <ChevronDown size={12} className="text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-[420px] p-0" align="start">
                <div className="max-h-72 overflow-y-auto py-1">
                  <div className="border-b border-border/40 bg-muted/30 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Built-in profiles
                  </div>
                  {BUILTIN_PROFILES.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { applyProfile(p); setProfilePopoverOpen(false); }}
                      className="block w-full px-3 py-1.5 text-left text-xs hover:bg-accent"
                    >
                      <div className="font-medium text-foreground">{p.name}</div>
                      {p.description && <div className="text-[10px] text-muted-foreground leading-tight">{p.description}</div>}
                    </button>
                  ))}
                  {userProfiles.length > 0 && (
                    <>
                      <div className="border-y border-border/40 bg-muted/30 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Your profiles
                      </div>
                      {userProfiles.map((p) => (
                        <div key={p.id} className="flex items-center justify-between px-3 py-1.5 hover:bg-accent">
                          <button
                            onClick={() => { applyProfile(p); setProfilePopoverOpen(false); }}
                            className="flex-1 text-left text-xs"
                          >
                            <div className="font-medium text-foreground">{p.name}</div>
                          </button>
                          <button
                            onClick={() => handleDeleteProfile(p.id)}
                            className="ml-2 rounded p-1 text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
                            title="Delete profile"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            {!qqqAvailable && (
              <p className="text-[10px] italic text-muted-foreground">QQQ live change unavailable — Red Day Leaders profile will need it to filter.</p>
            )}
          </div>

          {/* Min RS Rating */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label className="font-medium text-foreground">Min RS Rating</label>
              <span className="font-mono text-primary">{state.minRating}</span>
            </div>
            <Slider min={1} max={99} step={1} value={[state.minRating]} onValueChange={(v) => set("minRating", v[0])} />
            <div className="flex justify-between text-[10px] text-muted-foreground"><span>1 (weakest)</span><span>99 (strongest)</span></div>
          </div>

          {/* Min ADR % */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label className="font-medium text-foreground">Min Average Daily Range (ADR)</label>
              <span className="font-mono text-primary">{state.minAdr.toFixed(1)}%</span>
            </div>
            <Slider min={1} max={10} step={0.1} value={[state.minAdr]} onValueChange={(v) => set("minAdr", v[0])} />
          </div>

          {/* Relative strength vs QQQ */}
          <div className="space-y-2 rounded-md border border-border bg-muted/20 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <Checkbox checked={state.relVsQqqOn} disabled={!qqqAvailable} onCheckedChange={(v) => set("relVsQqqOn", !!v)} />
                <span>
                  <span className="font-medium text-foreground">Relative strength vs QQQ today</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {qqqAvailable
                      ? `QQQ today: ${(qqqPctChange ?? 0) >= 0 ? "+" : ""}${(qqqPctChange ?? 0).toFixed(2)}% — keep stocks beating it by at least…`
                      : "QQQ live change unavailable"}
                  </span>
                </span>
              </label>
              <span className="font-mono text-xs text-primary">≥ {state.minRelVsQqq.toFixed(1)}%</span>
            </div>
            <Slider min={-2} max={5} step={0.5} value={[state.minRelVsQqq]} onValueChange={(v) => set("minRelVsQqq", v[0])} disabled={!state.relVsQqqOn || !qqqAvailable} />
          </div>

          {/* Tight Range / Coil Score filter */}
          <div className="space-y-2 rounded-md border border-border bg-muted/20 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <Checkbox checked={state.coilFilterOn} disabled={!coilAvailable} onCheckedChange={(v) => set("coilFilterOn", !!v)} />
                <span>
                  <span className="font-medium text-foreground">Tight Range / Coil Score</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {coilAvailable
                      ? `Recent ${coilShortDays ?? 7}d ADR ÷ ${coilLongDays ?? 30}d ADR · lower = tighter`
                      : "Tight Range scores still loading…"}
                  </span>
                </span>
              </label>
              <span className="font-mono text-xs text-primary">≤ {state.maxCoil.toFixed(2)}x</span>
            </div>
            <Slider min={0.4} max={1.5} step={0.05} value={[state.maxCoil]} onValueChange={(v) => set("maxCoil", v[0])} disabled={!state.coilFilterOn} />
          </div>

          {/* EMA Pullback filters */}
          <div className="space-y-2 rounded-md border border-border bg-muted/20 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-foreground">EMA Pullback Filters</div>
              {((state.ema9dFilterOn ? 1 : 0) + (state.ema21dFilterOn ? 1 : 0) + (state.ema9wFilterOn ? 1 : 0)) >= 2 && (
                <div className="inline-flex overflow-hidden rounded-md border border-border text-[10px]">
                  <button type="button" onClick={() => set("emaFilterMode", "OR")}
                    className={`px-2 py-1 ${state.emaFilterMode === "OR" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}>
                    Match ANY (OR)
                  </button>
                  <button type="button" onClick={() => set("emaFilterMode", "AND")}
                    className={`px-2 py-1 ${state.emaFilterMode === "AND" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}>
                    Match ALL (AND)
                  </button>
                </div>
              )}
            </div>

            {([
              { key: "9d", on: state.ema9dFilterOn, max: state.maxEma9dAbs, setOn: (v: boolean) => set("ema9dFilterOn", v), setMax: (v: number) => set("maxEma9dAbs", v), label: "9-Day EMA" },
              { key: "21d", on: state.ema21dFilterOn, max: state.maxEma21dAbs, setOn: (v: boolean) => set("ema21dFilterOn", v), setMax: (v: number) => set("maxEma21dAbs", v), label: "21-Day EMA" },
              { key: "9w", on: state.ema9wFilterOn, max: state.maxEma9wAbs, setOn: (v: boolean) => set("ema9wFilterOn", v), setMax: (v: number) => set("maxEma9wAbs", v), label: "9-Week EMA" },
            ] as const).map((row) => (
              <div key={row.key} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox checked={row.on} disabled={!emaAvailable} onCheckedChange={(v) => row.setOn(!!v)} />
                    <span className="font-medium text-foreground">Within ±X% of {row.label}</span>
                  </label>
                  <span className="font-mono text-xs text-primary">±{row.max.toFixed(1)}%</span>
                </div>
                <Slider min={0.5} max={20} step={0.5} value={[row.max]} onValueChange={(v) => row.setMax(v[0])} disabled={!row.on || !emaAvailable} />
              </div>
            ))}
            {!emaAvailable && <p className="text-[10px] italic text-muted-foreground">EMA distances still loading…</p>}
          </div>

          {/* Price vs EMA direction filters */}
          <div className="space-y-2 rounded-md border border-border bg-muted/20 px-3 py-2.5">
            <div className="text-xs font-medium text-foreground">Price vs EMA</div>
            {([
              { key: "9d", on: state.priceVs9dOn, dir: state.priceVs9dDir, setOn: (v: boolean) => set("priceVs9dOn", v), setDir: (d: "above" | "below") => set("priceVs9dDir", d), label: "9 EMA" },
              { key: "21d", on: state.priceVs21dOn, dir: state.priceVs21dDir, setOn: (v: boolean) => set("priceVs21dOn", v), setDir: (d: "above" | "below") => set("priceVs21dDir", d), label: "21 EMA" },
              { key: "9w", on: state.priceVs9wOn, dir: state.priceVs9wDir, setOn: (v: boolean) => set("priceVs9wOn", v), setDir: (d: "above" | "below") => set("priceVs9wDir", d), label: "9 Week EMA" },
            ] as const).map((row) => (
              <div key={row.key} className="flex items-center justify-between text-xs">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={row.on} disabled={!emaAvailable} onCheckedChange={(v) => row.setOn(!!v)} />
                  <span className="font-medium text-foreground">Price {row.dir} {row.label}</span>
                </label>
                <div className="inline-flex overflow-hidden rounded-md border border-border text-[10px]">
                  <button type="button" onClick={() => row.setDir("above")} disabled={!row.on || !emaAvailable}
                    className={`px-2 py-0.5 ${row.dir === "above" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"} disabled:opacity-40`}>
                    Above
                  </button>
                  <button type="button" onClick={() => row.setDir("below")} disabled={!row.on || !emaAvailable}
                    className={`px-2 py-0.5 ${row.dir === "below" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"} disabled:opacity-40`}>
                    Below
                  </button>
                </div>
              </div>
            ))}
            {!emaAvailable && <p className="text-[10px] italic text-muted-foreground">EMA distances still loading…</p>}
          </div>


          {/* Top N */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label className="font-medium text-foreground">Top N stocks</label>
              <span className="font-mono text-primary">{topNLabel}</span>
            </div>
            <Slider min={TOPN_MIN} max={TOPN_MAX} step={1} value={[state.topN]} onValueChange={(v) => set("topN", v[0])} />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {topNPresets.map((v) => {
                const label = v >= TOPN_MAX ? "All" : `Top ${v}`;
                const active = state.topN === v;
                return (
                  <button
                    key={v}
                    onClick={() => set("topN", v)}
                    className={`rounded-md border px-2.5 py-0.5 text-[10px] font-medium transition-colors ${active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"}`}
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
                { v: "coil" as SortBy, label: "Tightest First", disabled: !coilAvailable },
                { v: "ema9d" as SortBy, label: "Closest to 9D EMA", disabled: !emaAvailable },
                { v: "ema21d" as SortBy, label: "Closest to 21D EMA", disabled: !emaAvailable },
                { v: "ema9w" as SortBy, label: "Closest to 9W EMA", disabled: !emaAvailable },
                { v: "relVsQqq" as SortBy, label: "Strongest vs QQQ", disabled: !qqqAvailable },
              ].map((opt) => (
                <button
                  key={opt.v}
                  disabled={(opt as { disabled?: boolean }).disabled}
                  onClick={() => set("sortBy", opt.v)}
                  className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors ${state.sortBy === opt.v ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"} ${(opt as { disabled?: boolean }).disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                  title={(opt as { disabled?: boolean }).disabled ? "Data not loaded yet" : undefined}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Checkbox filters */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs cursor-pointer">
              <Checkbox checked={state.acceleratingOnly} onCheckedChange={(v) => set("acceleratingOnly", !!v)} />
              <span>
                <span className="font-medium text-foreground">Accelerating Only</span>
                <span className="block text-[10px] text-muted-foreground">1M RS &gt; 3M RS</span>
              </span>
            </label>
            <label className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs cursor-pointer">
              <Checkbox checked={state.excludeOtc} onCheckedChange={(v) => set("excludeOtc", !!v)} />
              <span>
                <span className="font-medium text-foreground">Exclude OTC Stocks</span>
                <span className="block text-[10px] text-muted-foreground">Hide foreign / pink sheets</span>
              </span>
            </label>
          </div>

          {/* Growth Filters */}
          <div className="space-y-2 rounded-md border border-border bg-muted/20 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">Growth Filters</span>
              {!fundamentalsAvailable && <span className="text-[10px] italic text-muted-foreground">Run "Pull Fundamentals" to enable</span>}
              {growthActive && fundamentalsAvailable && (
                <button onClick={() => set("growthFilters", { ...DEFAULT_GROWTH_FILTERS })} className="text-[10px] font-medium text-primary hover:underline">Clear</button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className={`flex items-start gap-2 rounded-md border border-border bg-background/40 px-2.5 py-2 text-xs ${fundamentalsAvailable ? "cursor-pointer" : "opacity-50 cursor-not-allowed"}`}>
                <Checkbox checked={state.growthFilters.growth} disabled={!fundamentalsAvailable} onCheckedChange={(v) => set("growthFilters", { ...state.growthFilters, growth: !!v })} />
                <span><span className="font-medium text-foreground">Growth Stocks Only</span><span className="block text-[10px] text-muted-foreground leading-tight">2 of 3: Rev Q≥20% / TTM≥15% · EPS Q≥25% / TTM≥25% · ROE≥15% / NM≥10%</span></span>
              </label>
              <label className={`flex items-start gap-2 rounded-md border border-border bg-background/40 px-2.5 py-2 text-xs ${fundamentalsAvailable ? "cursor-pointer" : "opacity-50 cursor-not-allowed"}`}>
                <Checkbox checked={state.growthFilters.highGrowth} disabled={!fundamentalsAvailable} onCheckedChange={(v) => set("growthFilters", { ...state.growthFilters, highGrowth: !!v })} />
                <span><span className="font-medium text-foreground">High Growth</span><span className="block text-[10px] text-muted-foreground leading-tight">Rev Q≥25% · EPS Q≥40% (if data) · ROE≥20%</span></span>
              </label>
              <label className={`flex items-start gap-2 rounded-md border border-border bg-background/40 px-2.5 py-2 text-xs ${fundamentalsAvailable ? "cursor-pointer" : "opacity-50 cursor-not-allowed"}`}>
                <Checkbox checked={state.growthFilters.oneil} disabled={!fundamentalsAvailable} onCheckedChange={(v) => set("growthFilters", { ...state.growthFilters, oneil: !!v })} />
                <span><span className="font-medium text-foreground">O'Neil Growth</span><span className="block text-[10px] text-muted-foreground leading-tight">4 of 5: EPS Q≥30% · Rev Q≥25% · ROE≥17% · D/E low · NM&gt;0</span></span>
              </label>
            </div>
          </div>

          {/* Exclude Sector / Industry */}
          <div className="space-y-2 rounded-md border border-border bg-muted/20 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <Checkbox checked={state.excludeSectorsOn} onCheckedChange={(v) => set("excludeSectorsOn", !!v)} />
                <span>
                  <span className="font-medium text-foreground">Exclude Sector / Industry</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {state.excludeSectorsOn ? excludedSectorsSet.size > 0 ? `${excludedSectorsSet.size} excluded` : "Pick sectors to exclude" : "Off"}
                  </span>
                </span>
              </label>
              <Popover open={sectorPopoverOpen} onOpenChange={setSectorPopoverOpen}>
                <PopoverTrigger asChild>
                  <button disabled={!state.excludeSectorsOn} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed">
                    {excludedSectorsSet.size > 0 ? `${excludedSectorsSet.size} selected` : "Choose sectors"}
                    <ChevronDown size={12} />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="end">
                  <div className="border-b border-border p-2">
                    <Input autoFocus placeholder="Search GICS sectors or industries…" value={sectorSearch} onChange={(e) => setSectorSearch(e.target.value)} className="h-7 text-xs" />
                  </div>
                  <div className="max-h-72 overflow-y-auto py-1">
                    {filteredGroups.length === 0 ? (
                      <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">No matches</div>
                    ) : filteredGroups.map((group) => {
                      const gicsChecked = excludedSectorsSet.has(group.gics);
                      const childCount = group.industries.filter((i) => universeIndustries.has(i)).length;
                      return (
                        <div key={group.gics} className="border-b border-border/40 last:border-b-0">
                          <button onClick={() => toggleSector(group.gics)} className="flex w-full items-center justify-between gap-2 bg-muted/40 px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide hover:bg-accent">
                            <span className={gicsChecked ? "text-primary" : "text-foreground"}>
                              {group.gics}
                              {childCount > 0 && <span className="ml-1.5 font-normal normal-case text-[10px] text-muted-foreground">({childCount} in universe)</span>}
                            </span>
                            {gicsChecked && <Check size={12} className="text-primary" />}
                          </button>
                          {group.industries.map((ind) => {
                            const checked = excludedSectorsSet.has(ind);
                            const inUniverse = universeIndustries.has(ind);
                            const coveredByGics = gicsChecked;
                            return (
                              <button key={`${group.gics}-${ind}`} onClick={() => toggleSector(ind)} disabled={coveredByGics} className="flex w-full items-center justify-between gap-2 pl-6 pr-3 py-1 text-left text-xs hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed">
                                <span className={checked || coveredByGics ? "font-medium text-foreground" : inUniverse ? "text-foreground/80" : "text-muted-foreground"}>
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
                  {excludedSectorsSet.size > 0 && (
                    <div className="flex items-center justify-between border-t border-border px-2 py-1.5">
                      <span className="text-[10px] text-muted-foreground">{excludedSectorsSet.size} selected</span>
                      <button onClick={() => set("excludedSectors", [])} className="text-[10px] font-medium text-primary hover:underline">Clear all</button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>
            {state.excludeSectorsOn && excludedSectorsSet.size > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {Array.from(excludedSectorsSet).map((sec) => (
                  <button key={sec} onClick={() => toggleSector(sec)} className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/20" title="Click to remove">
                    {sec}<X size={10} />
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
          <button onClick={() => onOpenChange(false)} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
            <X size={12} className="mr-1 inline" /> Close
          </button>
          <button onClick={handleDownload} disabled={symbols.length === 0} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50">
            <Download size={12} /> Download .txt
          </button>
          <button onClick={handleCopy} disabled={symbols.length === 0} className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors disabled:opacity-50">
            <Copy size={12} /> Copy to Clipboard
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
