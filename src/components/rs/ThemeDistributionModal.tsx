import { useMemo, useState } from "react";
import { Layers, Sparkles, Loader2, Plus, Check } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { RsStock } from "@/hooks/useRsAlpha";
import { useCuratedThemes } from "@/hooks/useCuratedThemes";
import GroupConcentrationPanel, { type ConcentrationItem } from "@/components/shared/GroupConcentrationPanel";
import type { GroupMode } from "@/lib/groupColors";
import type { SectorTab } from "@/components/rs/SectorDistributionModal";


const TOPN_MIN = 10;
const TOPN_MAX = 500;

const SLICE_COLORS = [
  "hsl(160, 70%, 50%)", "hsl(200, 80%, 55%)", "hsl(280, 65%, 60%)",
  "hsl(30, 85%, 55%)",  "hsl(340, 75%, 60%)", "hsl(50, 85%, 55%)",
  "hsl(180, 70%, 50%)", "hsl(260, 70%, 65%)", "hsl(15, 80%, 60%)",
  "hsl(100, 55%, 50%)", "hsl(220, 70%, 60%)", "hsl(320, 60%, 60%)",
  "hsl(0, 70%, 60%)", "hsl(140, 60%, 50%)", "hsl(240, 70%, 65%)",
  "hsl(60, 80%, 55%)", "hsl(190, 75%, 55%)", "hsl(300, 65%, 60%)",
];
const UNASSIGNED_COLOR = "hsl(0, 0%, 40%)";

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

interface SliceStock {
  symbol: string;
  rs: number | null;
  rating: number | null;
  ret: number | null;
  industry: string | null;
}
interface Slice {
  name: string;
  count: number;
  pct: number;
  stocks: SliceStock[];
  isUnassigned?: boolean;
}

interface NewThemeSuggestion {
  theme_name: string;
  rationale: string;
  tickers: string[];
  cohesion_score?: number;
}
interface ThemeAddition {
  existing_theme: string;
  rationale: string;
  tickers: string[];
  cohesion_score?: number;
}

function CohesionBadge({ score }: { score?: number }) {
  if (score === undefined || score === null) return null;
  const tone =
    score >= 9 ? "border-[hsl(160,70%,50%)]/50 bg-[hsl(160,70%,50%)]/15 text-[hsl(160,80%,55%)]"
    : score >= 7 ? "border-[hsl(180,70%,50%)]/40 bg-[hsl(180,70%,50%)]/10 text-[hsl(180,80%,60%)]"
    : "border-[hsl(40,80%,55%)]/40 bg-[hsl(40,80%,55%)]/10 text-[hsl(40,90%,60%)]";
  const label = score >= 9 ? "Excellent" : score >= 7 ? "Strong" : "Mixed";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${tone}`}
      title={`AI cohesion self-score: ${score}/10 — ${label}`}
    >
      Cohesion {score}/10
    </span>
  );
}

export default function ThemeDistributionModal({
  open, onOpenChange, tabId, tabLabel, stocks, ratingMap,
  getRsForTab, getReturnField, isOtcSymbol,
}: Props) {
  const { themes: curated, reload: reloadThemes } = useCuratedThemes();

  const [minRating, setMinRating] = useState(60);
  const [topN, setTopN] = useState(TOPN_MAX);
  const [acceleratingOnly, setAcceleratingOnly] = useState(false);
  const [minAdr, setMinAdr] = useState(3.0);
  const [excludeOtc, setExcludeOtc] = useState(true);

  const [groupMode, setGroupMode] = useState<GroupMode>("theme");


  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<NewThemeSuggestion[] | null>(null);
  const [additions, setAdditions] = useState<ThemeAddition[] | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [created, setCreated] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());

  // Apply filters → sort by RS → top N
  const filteredStocks = useMemo(() => {
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
    list = [...list].sort((a, b) => (getRsForTab(b, tabId) ?? -999) - (getRsForTab(a, tabId) ?? -999));
    if (topN < TOPN_MAX) list = list.slice(0, topN);
    return list;
  }, [stocks, ratingMap, minRating, minAdr, acceleratingOnly, excludeOtc, topN, tabId, getRsForTab, isOtcSymbol]);

  const stockMap = useMemo(() => {
    const m = new Map<string, RsStock>();
    filteredStocks.forEach(s => m.set(s.symbol.toUpperCase(), s));
    return m;
  }, [filteredStocks]);

  const { slices, unassignedSymbols } = useMemo(() => {
    const universe = new Set(filteredStocks.map(s => s.symbol.toUpperCase()));
    const total = universe.size || 1;

    const buildStock = (sym: string): SliceStock => {
      const s = stockMap.get(sym);
      return {
        symbol: sym,
        rs: s ? getRsForTab(s, tabId) : null,
        rating: ratingMap.get(sym) ?? null,
        ret: s ? getReturnField(s, tabId) : null,
        industry: s?.sector ?? null,
      };
    };

    const buckets: Slice[] = [];
    const assigned = new Set<string>();
    for (const t of curated) {
      const matched = t.symbols.filter(sym => universe.has(sym));
      if (matched.length === 0) continue;
      matched.forEach(s => assigned.add(s));
      const stocksArr = matched.map(buildStock).sort((a, b) => (b.rs ?? -999) - (a.rs ?? -999));
      buckets.push({ name: t.name, count: matched.length, pct: (matched.length / total) * 100, stocks: stocksArr });
    }
    buckets.sort((a, b) => b.count - a.count);

    const unassigned = [...universe].filter(s => !assigned.has(s)).sort();
    if (unassigned.length > 0) {
      buckets.push({
        name: "Unassigned", count: unassigned.length, pct: (unassigned.length / total) * 100,
        stocks: unassigned.map(buildStock).sort((a, b) => (b.rs ?? -999) - (a.rs ?? -999)),
        isUnassigned: true,
      });
    }
    return { slices: buckets, unassignedSymbols: unassigned };
  }, [curated, filteredStocks, stockMap, ratingMap, tabId, getRsForTab, getReturnField]);

  const totalCount = filteredStocks.length;
  const topNLabel = topN >= TOPN_MAX ? "All" : `Top ${topN}`;
  const topNPresets = [10, 25, 50, 100, 200, TOPN_MAX];

  // Theme lookup for the shared concentration panel.
  const themeBySymbol = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of curated) for (const sym of t.symbols) if (!m.has(sym)) m.set(sym, t.name);
    return m;
  }, [curated]);

  const panelItems: ConcentrationItem[] = useMemo(
    () => filteredStocks.map(s => ({
      symbol: s.symbol,
      industry: s.sector,
      theme: themeBySymbol.get(s.symbol.toUpperCase()) ?? null,
      rating: ratingMap.get(s.symbol) ?? null,
      ret: getReturnField(s, tabId),
    })),
    [filteredStocks, themeBySymbol, ratingMap, getReturnField, tabId],
  );


  const handleSuggest = async () => {
    if (unassignedSymbols.length < 3) { toast.info("Not enough unassigned tickers for AI suggestions."); return; }
    setSuggesting(true); setSuggestions(null); setAdditions(null);
    try {
      const payload = {
        existingThemes: curated.map(c => ({
          name: c.name,
          sampleTickers: c.symbols.slice(0, 12),
        })),
        unassigned: unassignedSymbols.slice(0, 200).map(sym => {
          const s = stockMap.get(sym);
          return { symbol: sym, company: s?.companyName ?? null, sector: s?.sector ?? null };
        }),
      };
      const { data, error } = await supabase.functions.invoke("suggest-themes-from-tickers", { body: payload });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const newList: NewThemeSuggestion[] = Array.isArray(data?.new_themes)
        ? data.new_themes
        : (Array.isArray(data?.suggestions) ? data.suggestions : []);
      const addList: ThemeAddition[] = Array.isArray(data?.theme_additions) ? data.theme_additions : [];
      setSuggestions(newList);
      setAdditions(addList);
      const total = newList.length + addList.length;
      if (total === 0) toast.info(data?.note || "AI could not find coherent suggestions.");
      else toast.success(`AI proposed ${newList.length} new theme${newList.length === 1 ? "" : "s"} and ${addList.length} addition${addList.length === 1 ? "" : "s"}.`);
    } catch (e) {
      console.error("suggest-themes error:", e);
      toast.error(e instanceof Error ? e.message : "Failed to fetch AI suggestions.");
    } finally { setSuggesting(false); }
  };

  const handleCreate = async (s: NewThemeSuggestion) => {
    setCreating(s.theme_name);
    try {
      const { data: themeRow, error: insErr } = await supabase
        .from("themes").insert({ name: s.theme_name, description: s.rationale }).select("id").maybeSingle();
      if (insErr || !themeRow?.id) throw insErr || new Error("Insert failed");
      const rows = s.tickers.map(t => ({ theme_id: themeRow.id, ticker_symbol: t }));
      const { error: tErr } = await supabase.from("theme_tickers").insert(rows);
      if (tErr) throw tErr;
      setCreated(prev => new Set(prev).add(s.theme_name));
      toast.success(`Added "${s.theme_name}" with ${s.tickers.length} tickers.`);
      reloadThemes();
    } catch (e: any) {
      const msg = e?.message?.includes("authent") || e?.code === "42501"
        ? "Sign in required to add themes." : (e?.message || "Failed to create theme.");
      toast.error(msg);
    } finally { setCreating(null); }
  };

  const handleAddToExisting = async (a: ThemeAddition) => {
    const key = a.existing_theme;
    setAdding(key);
    try {
      const theme = curated.find(c => c.name.toLowerCase() === a.existing_theme.toLowerCase());
      if (!theme) throw new Error("Theme not found");
      const existing = new Set(theme.symbols);
      const fresh = a.tickers.filter(t => !existing.has(t));
      if (fresh.length === 0) {
        toast.info("All proposed tickers are already in this theme.");
        setAddedKeys(prev => new Set(prev).add(key));
        return;
      }
      const rows = fresh.map(t => ({ theme_id: theme.id, ticker_symbol: t }));
      const { error: tErr } = await supabase.from("theme_tickers").insert(rows);
      if (tErr) throw tErr;
      setAddedKeys(prev => new Set(prev).add(key));
      toast.success(`Added ${fresh.length} ticker${fresh.length === 1 ? "" : "s"} to "${theme.name}".`);
      reloadThemes();
    } catch (e: any) {
      const msg = e?.message?.includes("authent") || e?.code === "42501"
        ? "Sign in required to edit themes." : (e?.message || "Failed to add tickers.");
      toast.error(msg);
    } finally { setAdding(null); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-['Syne',sans-serif]">
            <Layers size={16} className="text-primary" />
            Theme Distribution · {tabLabel}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Curated theme breakdown of <strong className="text-foreground">{totalCount}</strong> stocks matching your filters. Hover a slice for details, click to expand.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 py-2 lg:grid-cols-[1fr_320px]">
          {/* LEFT: shared concentration panel (Theme / Industry / Sector) */}
          <GroupConcentrationPanel
            items={panelItems}
            mode={groupMode}
            onModeChange={setGroupMode}
            availableModes={["theme", "industry", "subIndustry", "sector"]}
            height={340}
          />


          {/* RIGHT: Filters + AI suggestions */}
          <div className="space-y-3">
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
                      <button key={v} onClick={() => setTopN(v)}
                        className={`rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors ${active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
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

              <div className="rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-[11px] text-foreground">
                <span className="font-mono font-semibold text-primary">{totalCount}</span> stock{totalCount === 1 ? "" : "s"} across <span className="font-mono font-semibold text-primary">{slices.filter(s => !s.isUnassigned).length}</span> theme{slices.length === 1 ? "" : "s"}
              </div>
            </div>

            {/* AI Suggestions */}
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles size={14} className="text-primary" />
                <span className="text-sm font-semibold text-foreground">Discover New Themes</span>
              </div>
              <div className="mb-3 text-[11px] text-muted-foreground">
                <strong className="text-foreground">{unassignedSymbols.length}</strong> stocks here aren't in any of your{" "}
                <strong className="text-foreground">{curated.length}</strong> curated themes.
              </div>
              <button
                onClick={handleSuggest}
                disabled={suggesting || unassignedSymbols.length < 3}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-primary/60 bg-primary/15 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {suggesting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {suggesting ? "Analyzing with AI…" : "Suggest New Themes with AI"}
              </button>
            </div>

            {suggestions && suggestions.length > 0 && (
              <div className="space-y-2 animate-fade-in">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  New Themes
                </div>
                {suggestions.map((s) => {
                  const isCreated = created.has(s.theme_name);
                  const isCreating = creating === s.theme_name;
                  return (
                    <div key={s.theme_name} className="rounded-lg border border-border bg-card p-3">
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <div className="text-sm font-semibold text-foreground">{s.theme_name}</div>
                        <CohesionBadge score={s.cohesion_score} />
                      </div>
                      <div className="mb-2 text-[11px] italic text-muted-foreground">{s.rationale}</div>
                      <div className="mb-2 flex flex-wrap gap-1">
                        {s.tickers.map(t => (
                          <span key={t} className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground">{t}</span>
                        ))}
                      </div>
                      <button
                        onClick={() => handleCreate(s)}
                        disabled={isCreating || isCreated}
                        className={`inline-flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                          isCreated
                            ? "border-[hsl(160,70%,50%)]/40 bg-[hsl(160,70%,50%)]/10 text-[hsl(160,70%,50%)]"
                            : "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        {isCreating ? <Loader2 size={11} className="animate-spin" /> : isCreated ? <Check size={11} /> : <Plus size={11} />}
                        {isCreated ? "Added to Dashboard" : isCreating ? "Creating…" : "Create & Add to Dashboard"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {additions && additions.length > 0 && (
              <div className="space-y-2 animate-fade-in">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Add to Existing Themes
                </div>
                {additions.map((a) => {
                  const isAdded = addedKeys.has(a.existing_theme);
                  const isAdding = adding === a.existing_theme;
                  return (
                    <div key={a.existing_theme} className="rounded-lg border border-border bg-card p-3">
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <div className="text-sm font-semibold text-foreground">→ {a.existing_theme}</div>
                        <CohesionBadge score={a.cohesion_score} />
                      </div>
                      <div className="mb-2 text-[11px] italic text-muted-foreground">{a.rationale}</div>
                      <div className="mb-2 flex flex-wrap gap-1">
                        {a.tickers.map(t => (
                          <span key={t} className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground">{t}</span>
                        ))}
                      </div>
                      <button
                        onClick={() => handleAddToExisting(a)}
                        disabled={isAdding || isAdded}
                        className={`inline-flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                          isAdded
                            ? "border-[hsl(160,70%,50%)]/40 bg-[hsl(160,70%,50%)]/10 text-[hsl(160,70%,50%)]"
                            : "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        {isAdding ? <Loader2 size={11} className="animate-spin" /> : isAdded ? <Check size={11} /> : <Plus size={11} />}
                        {isAdded ? "Added" : isAdding ? "Adding…" : `Add ${a.tickers.length} to "${a.existing_theme}"`}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
