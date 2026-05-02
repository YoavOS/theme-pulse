import { useMemo, useState } from "react";
import { Layers, Sparkles, Loader2, Plus, Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Sector } from "recharts";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { RsStock } from "@/hooks/useRsAlpha";
import { useCuratedThemes } from "@/hooks/useCuratedThemes";

// Re-use a similar palette to SectorDistributionModal for visual consistency
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
  tabLabel: string;
  stocks: RsStock[]; // current sorted list (already filtered by tab/growth/etc)
}

interface Slice {
  name: string;
  count: number;
  pct: number;
  symbols: string[];
  isUnassigned?: boolean;
}

interface Suggestion {
  theme_name: string;
  rationale: string;
  tickers: string[];
}

export default function ThemeDistributionModal({ open, onOpenChange, tabLabel, stocks }: Props) {
  const { themes: curated, reload: reloadThemes } = useCuratedThemes();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [created, setCreated] = useState<Set<string>>(new Set());

  // Build "ticker -> first matching theme name" map (a ticker can be in multiple
  // themes; we count each occurrence so percentages reflect coverage breadth).
  const { slices, unassignedSymbols } = useMemo(() => {
    const universeSymbols = new Set(stocks.map(s => s.symbol.toUpperCase()));
    const total = universeSymbols.size || 1;

    const themeBuckets: Slice[] = [];
    const assigned = new Set<string>();

    for (const t of curated) {
      const matched = t.symbols.filter(sym => universeSymbols.has(sym));
      if (matched.length === 0) continue;
      matched.forEach(s => assigned.add(s));
      themeBuckets.push({
        name: t.name,
        count: matched.length,
        pct: (matched.length / total) * 100,
        symbols: matched.sort(),
      });
    }
    themeBuckets.sort((a, b) => b.count - a.count);

    const unassigned = [...universeSymbols].filter(s => !assigned.has(s)).sort();
    if (unassigned.length > 0) {
      themeBuckets.push({
        name: "Unassigned",
        count: unassigned.length,
        pct: (unassigned.length / total) * 100,
        symbols: unassigned,
        isUnassigned: true,
      });
    }
    return { slices: themeBuckets, unassignedSymbols: unassigned };
  }, [curated, stocks]);

  const expandedSlice = expanded ? slices.find(s => s.name === expanded) ?? null : null;
  const stockMap = useMemo(() => {
    const m = new Map<string, RsStock>();
    stocks.forEach(s => m.set(s.symbol.toUpperCase(), s));
    return m;
  }, [stocks]);

  const renderActiveShape = (props: any) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
    return (
      <g>
        <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 6} startAngle={startAngle} endAngle={endAngle} fill={fill} />
        <Sector cx={cx} cy={cy} innerRadius={outerRadius + 8} outerRadius={outerRadius + 11} startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.4} />
      </g>
    );
  };

  const handleSuggest = async () => {
    if (unassignedSymbols.length < 3) {
      toast.info("Not enough unassigned tickers for AI suggestions.");
      return;
    }
    setSuggesting(true);
    setSuggestions(null);
    try {
      const payload = {
        existingThemes: curated.map(c => c.name),
        unassigned: unassignedSymbols.slice(0, 200).map(sym => {
          const s = stockMap.get(sym);
          return { symbol: sym, company: s?.companyName ?? null, sector: s?.sector ?? null };
        }),
      };
      const { data, error } = await supabase.functions.invoke("suggest-themes-from-tickers", { body: payload });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const list: Suggestion[] = Array.isArray(data?.suggestions) ? data.suggestions : [];
      setSuggestions(list);
      if (list.length === 0) toast.info(data?.note || "AI could not find coherent new themes in the unassigned set.");
      else toast.success(`AI proposed ${list.length} new theme${list.length === 1 ? "" : "s"}.`);
    } catch (e) {
      console.error("suggest-themes error:", e);
      toast.error(e instanceof Error ? e.message : "Failed to fetch AI suggestions.");
    } finally {
      setSuggesting(false);
    }
  };

  const handleCreate = async (s: Suggestion) => {
    setCreating(s.theme_name);
    try {
      const { data: themeRow, error: insErr } = await supabase
        .from("themes")
        .insert({ name: s.theme_name, description: s.rationale })
        .select("id")
        .maybeSingle();
      if (insErr || !themeRow?.id) throw insErr || new Error("Insert failed");
      const themeId = themeRow.id;
      const rows = s.tickers.map(t => ({ theme_id: themeId, ticker_symbol: t }));
      const { error: tErr } = await supabase.from("theme_tickers").insert(rows);
      if (tErr) throw tErr;
      setCreated(prev => new Set(prev).add(s.theme_name));
      toast.success(`Added "${s.theme_name}" with ${s.tickers.length} tickers to your dashboard.`);
      reloadThemes();
    } catch (e: any) {
      console.error("create theme error:", e);
      const msg = e?.message?.includes("authent") || e?.code === "42501"
        ? "Sign in required to add themes to the dashboard."
        : (e?.message || "Failed to create theme.");
      toast.error(msg);
    } finally {
      setCreating(null);
    }
  };

  const copySymbols = async (syms: string[]) => {
    try { await navigator.clipboard.writeText(syms.join(",")); toast.success(`${syms.length} tickers copied.`); }
    catch { toast.error("Could not copy."); }
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
            How <strong className="text-foreground">{stocks.length}</strong> ranked stocks distribute across your{" "}
            <strong className="text-foreground">{curated.length}</strong> curated themes. Click a slice to drill in, or ask AI to mine new themes from the unassigned tail.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 py-2 lg:grid-cols-[1fr_320px]">
          {/* LEFT: Pie + legend + drill-down */}
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-card/50 p-3">
              {slices.length === 0 ? (
                <div className="flex h-[320px] items-center justify-center text-xs text-muted-foreground">
                  No stocks in the current list.
                </div>
              ) : (
                <div className="h-[340px] w-full animate-fade-in">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={slices}
                        dataKey="count"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={70}
                        outerRadius={120}
                        paddingAngle={1}
                        activeIndex={activeIndex ?? undefined}
                        activeShape={renderActiveShape}
                        onMouseEnter={(_, i) => setActiveIndex(i)}
                        onMouseLeave={() => setActiveIndex(null)}
                        onClick={(d: any) => setExpanded(prev => prev === d.name ? null : d.name)}
                        isAnimationActive
                      >
                        {slices.map((s, i) => (
                          <Cell
                            key={i}
                            fill={s.isUnassigned ? UNASSIGNED_COLOR : SLICE_COLORS[i % SLICE_COLORS.length]}
                            stroke="hsl(var(--background))"
                            strokeWidth={2}
                            className="cursor-pointer"
                          />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        cursor={false}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0].payload as Slice;
                          return (
                            <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-xl">
                              <div className="mb-1 flex items-center justify-between gap-3">
                                <span className="font-semibold text-foreground">{d.name}</span>
                                <span className="font-mono text-primary">{d.pct.toFixed(1)}%</span>
                              </div>
                              <div className="text-[10px] text-muted-foreground">{d.count} stock{d.count === 1 ? "" : "s"} · click to expand</div>
                            </div>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}

              {slices.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2 border-t border-border/50 pt-2">
                  {slices.map((d, i) => {
                    const active = expanded === d.name;
                    return (
                      <button
                        key={d.name}
                        onMouseEnter={() => setActiveIndex(i)}
                        onMouseLeave={() => setActiveIndex(null)}
                        onClick={() => setExpanded(prev => prev === d.name ? null : d.name)}
                        className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] transition-all hover:scale-105 ${active ? "border-primary bg-primary/10" : "border-border bg-muted/20"}`}
                      >
                        <span className="h-2 w-2 rounded-full" style={{ background: d.isUnassigned ? UNASSIGNED_COLOR : SLICE_COLORS[i % SLICE_COLORS.length] }} />
                        <span className="font-medium text-foreground">{d.name}</span>
                        <span className="font-mono text-muted-foreground">{d.pct.toFixed(1)}% ({d.count})</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Drilldown */}
            {expandedSlice && (
              <div className="animate-fade-in rounded-lg border border-primary/30 bg-card p-3">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">{expandedSlice.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {expandedSlice.count} stocks · {expandedSlice.pct.toFixed(1)}% of {tabLabel} list
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => copySymbols(expandedSlice.symbols)}
                      className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/20"
                    >
                      <Copy size={11} /> Copy
                    </button>
                    <button
                      onClick={() => setExpanded(null)}
                      className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      Close
                    </button>
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-border text-[10px] text-muted-foreground">
                        <th className="px-2 py-1 text-left">#</th>
                        <th className="px-2 py-1 text-left">Ticker</th>
                        <th className="px-2 py-1 text-left">Company</th>
                        <th className="px-2 py-1 text-left">Sector</th>
                        <th className="px-2 py-1 text-right">RS Overall</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expandedSlice.symbols.map((sym, idx) => {
                        const s = stockMap.get(sym);
                        return (
                          <tr key={sym} className="border-b border-border/30 hover:bg-accent/30">
                            <td className="px-2 py-1 text-muted-foreground">{idx + 1}</td>
                            <td className="px-2 py-1 font-mono font-semibold text-foreground">{sym}</td>
                            <td className="px-2 py-1 text-muted-foreground truncate max-w-[200px]">{s?.companyName ?? "—"}</td>
                            <td className="px-2 py-1 text-muted-foreground truncate max-w-[160px]">{s?.sector ?? "—"}</td>
                            <td className="px-2 py-1 text-right font-mono text-foreground">
                              {s?.rsOverall != null ? `${s.rsOverall >= 0 ? "+" : ""}${s.rsOverall.toFixed(2)}` : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: AI suggestions panel */}
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles size={14} className="text-primary" />
                <span className="text-sm font-semibold text-foreground">Discover New Themes</span>
              </div>
              <div className="mb-3 text-[11px] text-muted-foreground">
                <strong className="text-foreground">{unassignedSymbols.length}</strong> stocks in this list don't belong to any of your{" "}
                <strong className="text-foreground">{curated.length}</strong> curated themes.
              </div>
              <button
                onClick={handleSuggest}
                disabled={suggesting || unassignedSymbols.length < 3}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-primary/60 bg-primary/15 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {suggesting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {suggesting ? "Analyzing with Groq…" : "Suggest New Themes with Groq"}
              </button>
            </div>

            {suggestions && suggestions.length > 0 && (
              <div className="space-y-2 animate-fade-in">
                {suggestions.map((s) => {
                  const isCreated = created.has(s.theme_name);
                  const isCreating = creating === s.theme_name;
                  return (
                    <div key={s.theme_name} className="rounded-lg border border-border bg-card p-3">
                      <div className="mb-1 text-sm font-semibold text-foreground">{s.theme_name}</div>
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

            {suggestions && suggestions.length === 0 && (
              <div className="rounded-lg border border-border bg-card p-3 text-[11px] text-muted-foreground">
                No coherent new themes found. Try a different timeframe or relax filters to surface more unassigned tickers.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
