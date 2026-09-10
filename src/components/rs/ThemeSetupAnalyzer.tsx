import { useCallback, useMemo, useState } from "react";
import { Copy, Download, Loader2, Play, Layers, Flame, Crown, Gem, Boxes, ArrowUpRight, ArrowDownRight, Eye, Save, GitCompare, Waves } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import type { RsStock } from "@/hooks/useRsAlpha";
import { computeRsRatings } from "@/components/rs/RsRatingBadge";
import { useCuratedThemes } from "@/hooks/useCuratedThemes";
import { useSuperperformance } from "@/hooks/useSuperperformance";
import { useSetupMetrics, loadCoilConfig, type SetupMetrics } from "@/hooks/useSetupMetrics";
import GroupConcentrationPanel, { type ConcentrationItem } from "@/components/shared/GroupConcentrationPanel";
import HighLowLeadership, { type HighLowItem } from "@/components/shared/HighLowLeadership";
import { GROUP_MODE_LABEL, groupKeyForIndustry, type GroupMode } from "@/lib/groupColors";


/* ───────────────────────── Types & config ───────────────────────── */

type RsTf = "1d" | "1w" | "1m" | "3m" | "6m" | "overall";
type ListId =
  | `rs_${RsTf}`
  | "superperf"
  | "cleanEma"
  | "nh52w"
  | "volSurge"
  | "coil"
  | "manual";

type LayerId = "leadership" | "momentum" | "setup" | "quality";

const LAYERS: { id: LayerId; label: string; weight: number; icon: typeof Crown; color: string }[] = [
  { id: "leadership", label: "Leadership", weight: 0.35, icon: Crown, color: "hsl(160, 70%, 50%)" },
  { id: "momentum", label: "Momentum", weight: 0.30, icon: Flame, color: "hsl(30, 85%, 55%)" },
  { id: "setup", label: "Setup / Early", weight: 0.20, icon: Boxes, color: "hsl(200, 80%, 55%)" },
  { id: "quality", label: "Superperformance", weight: 0.15, icon: Gem, color: "hsl(280, 65%, 60%)" },
];

const LIST_LAYER: Record<ListId, LayerId | null> = {
  rs_1d: "momentum",
  rs_1w: "momentum",
  rs_1m: "momentum",
  rs_3m: "leadership",
  rs_6m: "leadership",
  rs_overall: "leadership",
  superperf: "quality",
  cleanEma: "momentum",
  nh52w: "leadership",
  volSurge: "setup",
  coil: "setup",
  manual: null,
};

const LIST_LABEL: Record<ListId, string> = {
  rs_1d: "Best RS 1D",
  rs_1w: "Best RS 1W",
  rs_1m: "Best RS 1M",
  rs_3m: "Best RS 3M",
  rs_6m: "Best RS 6M",
  rs_overall: "Best RS Overall",
  superperf: "Superperformance",
  cleanEma: "Clean EMA Uptrend",
  nh52w: "Near 52W Highs",
  volSurge: "Increased Volume",
  coil: "Basing / Coil",
  manual: "Manual List",
};

const RS_TFS: RsTf[] = ["1d", "1w", "1m", "3m", "6m", "overall"];

const GROUP_LABEL_LC: Record<GroupMode, string> = {
  theme: "themes", industry: "industries", sector: "sectors", subIndustry: "sub-industries",
};


const CLEAN_EMA_LS_KEY = "rs-clean-ema-uptrend-v4";
const SNAP_LS_KEY = "theme-setup-analyzer-snapshot-v1";

interface CleanEmaSaved {
  at: number;
  emaLength: number;
  timeframe: string;
  minGainPct: number;
  minPeriod: number;
  rows: { symbol: string; gainPct: number }[];
}

interface ThemeAgg {
  name: string;
  isUnassigned?: boolean;
  themeSize: number;
  symbols: string[];                     // qualifying symbols only
  layerMembers: Record<LayerId, string[]>;
  layerScores: Record<LayerId, number>;  // 0..1
  score: number;                         // 0..100
  rotation: number;                      // momentum - leadership (score points)
  baseDensity: number;                   // 0..1
}

interface Props {
  universe: RsStock[];
  isOtcSymbol: (sym: string) => boolean;
}

/* ───────────────────────── Helpers ───────────────────────── */

function parseTickers(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of (raw || "").split(/[\s,;|]+/)) {
    let t = tok.trim().toUpperCase();
    const c = t.indexOf(":");
    if (c >= 0) t = t.slice(c + 1);
    t = t.replace(/[^A-Z0-9.\-]/g, "");
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function rsOf(s: RsStock, tf: RsTf): number | null {
  switch (tf) {
    case "1d": return s.rs1d;
    case "1w": return s.rs1w;
    case "1m": return s.rs1m;
    case "3m": return s.rs3m;
    case "6m": return s.rs6m;
    case "overall": return s.rsOverall;
  }
}

function download(text: string, name: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/* ───────────────────────── Component ───────────────────────── */

export default function ThemeSetupAnalyzer({ universe, isOtcSymbol }: Props) {
  const { themes: curated } = useCuratedThemes();
  const { rows: superperfRows } = useSuperperformance();
  const { metrics, loading: metricsLoading, progress: metricsProgress, load: loadMetrics } = useSetupMetrics();

  /* ── Source selection ── */
  const [enabled, setEnabled] = useState<Record<ListId, boolean>>({
    rs_1d: false, rs_1w: true, rs_1m: true, rs_3m: true, rs_6m: true, rs_overall: true,
    superperf: true, cleanEma: true, nh52w: true, volSurge: true, coil: true, manual: false,
  });
  const [minRating, setMinRating] = useState(75);
  const [topN, setTopN] = useState(0); // 0 = no limit
  const [manualRaw, setManualRaw] = useState("");
  const [excludeOtc, setExcludeOtc] = useState(true);

  const [running, setRunning] = useState(false);
  const [runNote, setRunNote] = useState<string | null>(null);
  const [cleanEmaSet, setCleanEmaSet] = useState<Set<string> | null>(null);
  const [membership, setMembership] = useState<Map<string, Set<ListId>> | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [groupMode, setGroupMode] = useState<GroupMode>("industry");
  const [viewList, setViewList] = useState<ListId | null>(null);
  const [overlapSel, setOverlapSel] = useState<Set<ListId>>(new Set());
  const [snapshot, setSnapshot] = useState<Record<string, number> | null>(() => {
    try { const r = localStorage.getItem(SNAP_LS_KEY); return r ? JSON.parse(r) as Record<string, number> : null; } catch { return null; }
  });


  const toggle = (id: ListId) => setEnabled(p => ({ ...p, [id]: !p[id] }));

  /* ── RS ratings per timeframe (computed once against the whole universe) ── */
  const ratingsByTf = useMemo(() => {
    const out = new Map<RsTf, Map<string, number | null>>();
    for (const tf of RS_TFS) {
      const ratings = computeRsRatings(universe.map(s => rsOf(s, tf)));
      const m = new Map<string, number | null>();
      universe.forEach((s, i) => m.set(s.symbol, ratings[i]));
      out.set(tf, m);
    }
    return out;
  }, [universe]);

  /* ── Liquidity-prefiltered pool used for any price-metric fetch ── */
  const pool = useMemo(() => {
    return universe
      .filter(s => !(excludeOtc && isOtcSymbol(s.symbol)))
      .filter(s => (s.price ?? 0) >= 6 && (s.avgDollarVolume ?? 0) >= 8_000_000)
      .sort((a, b) => (b.avgDollarVolume ?? 0) - (a.avgDollarVolume ?? 0))
      .slice(0, 1500);
  }, [universe, excludeOtc, isOtcSymbol]);

  const needsMetrics = enabled.nh52w || enabled.volSurge || enabled.coil;
  const needsCleanEma = enabled.cleanEma;

  /* ── Clean EMA uptrend: reuse the saved scan when fresh, else run it ── */
  const loadCleanEma = useCallback(async (symbols: string[]): Promise<Set<string>> => {
    try {
      const raw = localStorage.getItem(CLEAN_EMA_LS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as CleanEmaSaved;
        const fresh = Date.now() - saved.at < 24 * 60 * 60 * 1000;
        const matches = saved.emaLength === 21 && saved.timeframe === "daily" && saved.minGainPct <= 40 && saved.minPeriod <= 10;
        if (fresh && matches && saved.rows?.length) {
          setRunNote("Clean EMA list reused from the saved scan (cache).");
          return new Set(saved.rows.filter(r => r.gainPct >= 40).map(r => r.symbol.toUpperCase()));
        }
      }
    } catch { /* ignore */ }

    const out = new Set<string>();
    const rows: { symbol: string; gainPct: number }[] = [];
    const CHUNK = 250;
    for (let i = 0; i < symbols.length; i += CHUNK) {
      const slice = symbols.slice(i, i + CHUNK);
      const { data, error } = await supabase.functions.invoke("clean-21-ema-scan", {
        body: { symbols: slice, minGainPct: 40, minPeriod: 10, emaLength: 21, timeframe: "daily" },
      });
      if (error) throw new Error(error.message);
      for (const r of ((data as { rows?: { symbol: string; gainPct: number }[] })?.rows ?? [])) {
        if (Number.isFinite(r.gainPct) && r.gainPct >= 40) {
          out.add(r.symbol.toUpperCase());
          rows.push({ symbol: r.symbol.toUpperCase(), gainPct: r.gainPct });
        }
      }
    }
    try {
      localStorage.setItem(CLEAN_EMA_LS_KEY, JSON.stringify({
        at: Date.now(), emaLength: 21, timeframe: "daily", minGainPct: 40, minPeriod: 10, rows,
      } satisfies CleanEmaSaved));
    } catch { /* quota */ }
    return out;
  }, []);

  /* ── Run the analysis ── */
  const run = useCallback(async () => {
    setRunning(true);
    setRunNote(null);
    setExpanded(null);
    try {
      let ema = cleanEmaSet;
      const coilCfg = loadCoilConfig();
      // Use the map returned by load() — reading `metrics` state here is stale
      // on the first run and left the metric-driven lists empty.
      const freshMetrics = needsMetrics
        ? await loadMetrics(pool.map(s => s.symbol), coilCfg)
        : new Map<string, SetupMetrics>();
      const metricsFor = (sym: string): SetupMetrics | undefined =>
        freshMetrics.get(sym.toUpperCase()) ?? metrics.get(sym.toUpperCase());
      if (needsCleanEma && !ema) {
        ema = await loadCleanEma(pool.map(s => s.symbol));
        setCleanEmaSet(ema);
      }

      const superScore = new Map<string, number>();
      for (const r of superperfRows) {
        const best = Math.max(
          r.current_score ?? 0, r.minervini_score ?? 0, r.oneil_score ?? 0, r.ryan_score ?? 0,
        );
        superScore.set(r.symbol.toUpperCase(), best);
      }

      const manual = new Set(enabled.manual ? parseTickers(manualRaw) : []);
      const mem = new Map<string, Set<ListId>>();
      const add = (sym: string, list: ListId) => {
        const key = sym.toUpperCase();
        const cur = mem.get(key) ?? new Set<ListId>();
        cur.add(list);
        mem.set(key, cur);
      };

      // Best RS lists
      for (const tf of RS_TFS) {
        const listId = `rs_${tf}` as ListId;
        if (!enabled[listId]) continue;
        const rmap = ratingsByTf.get(tf)!;
        let list = universe.filter(s => {
          if (excludeOtc && isOtcSymbol(s.symbol)) return false;
          const r = rmap.get(s.symbol);
          return typeof r === "number" && r >= minRating;
        });
        list = list.sort((a, b) => (rsOf(b, tf) ?? -999) - (rsOf(a, tf) ?? -999));
        if (topN > 0) list = list.slice(0, topN);
        list.forEach(s => add(s.symbol, listId));
      }

      // Superperformance: score ≥ 70 in any profile AND overall RS rating > 60
      if (enabled.superperf) {
        const rOverall = ratingsByTf.get("overall")!;
        for (const s of universe) {
          if (excludeOtc && isOtcSymbol(s.symbol)) continue;
          const best = superScore.get(s.symbol.toUpperCase());
          if (best === undefined || best < 70) continue;
          const r = rOverall.get(s.symbol);
          if (typeof r !== "number" || r <= 60) continue;
          add(s.symbol, "superperf");
        }
      }

      // Clean EMA Uptrend
      if (enabled.cleanEma && ema) {
        for (const s of universe) if (ema.has(s.symbol.toUpperCase())) add(s.symbol, "cleanEma");
      }

      // Metric-driven lists
      if (needsMetrics) {
        for (const s of pool) {
          const m: SetupMetrics | undefined = metrics.get(s.symbol.toUpperCase());
          if (!m) continue;

          if (enabled.nh52w) {
            const ok =
              m.pctBelowHigh !== null && m.pctBelowHigh <= 0 && m.pctBelowHigh >= -30 &&
              m.sma50 !== null && m.sma150 !== null && m.sma200 !== null &&
              m.sma50 > m.sma150 && m.sma150 > m.sma200 &&
              m.latestClose !== null && m.latestClose > m.sma50 &&
              (s.marketCap ?? 0) >= 300 &&
              (s.adrPercent ?? 0) >= 3 &&
              m.pctAboveLow !== null && m.pctAboveLow >= 30 &&
              (m.dollarVol10 ?? 0) >= 8_000_000;
            if (ok) add(s.symbol, "nh52w");
          }

          if (enabled.volSurge) {
            const ok =
              m.volSurgePct !== null && m.volSurgePct >= 25 &&
              (s.return1m ?? -999) > 0 &&
              (s.price ?? 0) > 6 &&
              (s.adrPercent ?? 0) >= 3 &&
              (m.dollarVol10 ?? 0) >= 8_000_000;
            if (ok) add(s.symbol, "volSurge");
          }

          if (enabled.coil) {
            // 7 weeks vs prior 30 weeks / 3 months vs prior 9 months, and the
            // stock should sit in the upper half of its 52-week range.
            const weekly = m.coilWeekly !== null && m.coilWeekly <= 0.65;
            const monthly = m.coilMonthly !== null && m.coilMonthly <= 0.70;
            const upperHalf = m.rangePos === null || m.rangePos >= 50;
            if ((weekly || monthly) && upperHalf) add(s.symbol, "coil");
          }
        }
      }

      // Manual list
      manual.forEach(t => add(t, "manual"));

      if (mem.size === 0) {
        toast.warning("No stocks matched the selected lists. Loosen the filters and try again.");
      }
      setMembership(mem);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Theme setup analysis failed.");
    } finally {
      setRunning(false);
    }
  }, [
    cleanEmaSet, needsMetrics, needsCleanEma, loadMetrics, loadCleanEma, pool, superperfRows,
    enabled, manualRaw, ratingsByTf, universe, excludeOtc, isOtcSymbol, minRating, topN, metrics,
  ]);

  /* ── Group aggregation (Theme / Industry / Sector) ── */
  const themeAggs = useMemo<ThemeAgg[]>(() => {
    if (!membership) return [];
    const themeOf = new Map<string, string>();
    const themeSizeOf = new Map<string, number>();
    for (const t of curated) {
      themeSizeOf.set(t.name, t.symbols.length);
      for (const sym of t.symbols) if (!themeOf.has(sym)) themeOf.set(sym, t.name);
    }
    const bySym = new Map(universe.map(u => [u.symbol.toUpperCase(), u]));

    const groupOf = (sym: string): string => {
      if (groupMode === "theme") return themeOf.get(sym) ?? "Unassigned";
      return groupKeyForIndustry(bySym.get(sym)?.sector ?? null, groupMode);
    };

    // Universe-wide group sizes so participation stays meaningful.
    const sizeOf = new Map<string, number>();
    if (groupMode === "theme") {
      themeSizeOf.forEach((v, k) => sizeOf.set(k, v));
    } else {
      for (const u of universe) {
        const g = groupOf(u.symbol.toUpperCase());
        sizeOf.set(g, (sizeOf.get(g) ?? 0) + 1);
      }
    }

    const buckets = new Map<string, string[]>();
    for (const sym of membership.keys()) {
      const name = groupOf(sym);
      const arr = buckets.get(name) ?? [];
      arr.push(sym);
      buckets.set(name, arr);
    }

    const isBlank = (n: string) => n === "Unassigned" || n === "Unknown";
    const out: ThemeAgg[] = [];
    for (const [name, symbols] of buckets) {
      const themeSize = Math.max(sizeOf.get(name) ?? symbols.length, symbols.length);
      const layerMembers = { leadership: [], momentum: [], setup: [], quality: [] } as Record<LayerId, string[]>;
      for (const sym of symbols) {
        const lists = membership.get(sym)!;
        for (const layer of LAYERS) {
          if (Array.from(lists).some(l => LIST_LAYER[l] === layer.id)) layerMembers[layer.id].push(sym);
        }
      }
      const layerScores = {} as Record<LayerId, number>;
      let score = 0;
      for (const layer of LAYERS) {
        const count = layerMembers[layer.id].length;
        const participation = themeSize > 0 ? Math.min(1, count / themeSize) : 0;
        const density = Math.min(1, count / 5);
        const ls = 0.55 * participation + 0.45 * density;
        layerScores[layer.id] = ls;
        score += layer.weight * ls;
      }
      out.push({
        name,
        isUnassigned: isBlank(name),
        themeSize,
        symbols: symbols.sort(),
        layerMembers,
        layerScores,
        score: Math.round(score * 1000) / 10,
        rotation: Math.round((layerScores.momentum - layerScores.leadership) * 1000) / 10,
        baseDensity: themeSize > 0 ? layerMembers.setup.length / themeSize : 0,
      });
    }
    out.sort((a, b) => (a.isUnassigned ? 1 : b.isUnassigned ? -1 : 0) || b.score - a.score);
    return out;
  }, [membership, curated, universe, groupMode]);

  const totalHits = useMemo(() => themeAggs.reduce((n, t) => n + t.symbols.length, 0), [themeAggs]);

  /* ── Items for the shared concentration panel (industry / sector / theme) ── */
  const concentrationItems = useMemo<ConcentrationItem[]>(() => {
    if (!membership) return [];
    const themeOf = new Map<string, string>();
    for (const t of curated) for (const sym of t.symbols) if (!themeOf.has(sym)) themeOf.set(sym, t.name);
    const bySym = new Map(universe.map(s => [s.symbol.toUpperCase(), s]));
    const rOverall = ratingsByTf.get("overall")!;
    return Array.from(membership.keys()).map(sym => {
      const s = bySym.get(sym);
      return {
        symbol: sym,
        industry: s?.sector ?? null,
        theme: themeOf.get(sym) ?? null,
        rating: (s ? rOverall.get(s.symbol) : null) ?? null,
        ret: s?.return1m ?? null,
      };
    });
  }, [membership, curated, universe, ratingsByTf]);

  /* ── Items for the 52-week high/low leadership panel ── */
  const highLowItems = useMemo<HighLowItem[]>(() => {
    const themeOf = new Map<string, string>();
    for (const t of curated) for (const sym of t.symbols) if (!themeOf.has(sym)) themeOf.set(sym, t.name);
    const rOverall = ratingsByTf.get("overall")!;
    return pool
      .map(s => {
        const m = metrics.get(s.symbol.toUpperCase());
        if (!m) return null;
        return {
          symbol: s.symbol.toUpperCase(),
          industry: s.sector ?? null,
          theme: themeOf.get(s.symbol.toUpperCase()) ?? null,
          rating: rOverall.get(s.symbol) ?? null,
          lastHighDaysAgo: m.lastHighDaysAgo,
          lastLowDaysAgo: m.lastLowDaysAgo,
        } as HighLowItem;
      })
      .filter((v): v is HighLowItem => v !== null);
  }, [pool, metrics, curated, ratingsByTf]);

  /* ── Per-list membership (sorted symbol arrays) ── */
  const listSets = useMemo(() => {
    const out = new Map<ListId, string[]>();
    if (!membership) return out;
    for (const [sym, lists] of membership) {
      for (const l of lists) {
        const arr = out.get(l) ?? [];
        arr.push(sym);
        out.set(l, arr);
      }
    }
    out.forEach(arr => arr.sort());
    return out;
  }, [membership]);

  const activeLists = useMemo(
    () => (Object.keys(LIST_LABEL) as ListId[]).filter(id => (listSets.get(id)?.length ?? 0) > 0),
    [listSets],
  );

  const overlap = useMemo(() => {
    const sel = activeLists.filter(id => overlapSel.has(id));
    if (sel.length < 2) return { intersection: [], uniques: [], perList: [] as { id: ListId; top: string }[] };
    const sets = sel.map(id => new Set(listSets.get(id) ?? []));
    const intersection = (listSets.get(sel[0]) ?? []).filter(s => sets.every(x => x.has(s)));
    const uniques = sel.map((id, i) => ({
      id,
      symbols: (listSets.get(id) ?? []).filter(s => sets.every((x, j) => j === i || !x.has(s))),
    }));
    const groupOf = (sym: string) => {
      const it = concentrationItems.find(c => c.symbol === sym);
      if (!it) return null;
      if (groupMode === "theme") return it.theme ?? null;
      return groupKeyForIndustry(it.industry, groupMode);
    };
    const perList = sel.map(id => {
      const counts = new Map<string, number>();
      for (const sym of listSets.get(id) ?? []) {
        const g = groupOf(sym);
        if (!g) continue;
        counts.set(g, (counts.get(g) ?? 0) + 1);
      }
      const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2)
        .map(([g, n]) => `${g} (${n})`).join(" · ");
      return { id, top };
    });
    return { intersection, uniques, perList };
  }, [activeLists, overlapSel, listSets, concentrationItems, groupMode]);


  const exportSymbols = useCallback((syms: string[]) => syms.map(s => s.toUpperCase()).join(","), []);

  const copyList = (syms: string[], label: string) => {
    navigator.clipboard.writeText(exportSymbols(syms));
    toast.success(`Copied ${syms.length} tickers — ${label}`);
  };

  /* ───────────────────────── Render ───────────────────────── */

  return (
    <div className="space-y-4">
      {/* Source selection */}
      <div className="rounded-lg border border-border/60 bg-card/40 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Layers size={14} className="text-primary" />
          <span className="text-xs font-semibold text-foreground">Lists to analyze</span>
          <span className="text-[11px] text-muted-foreground">
            Only stocks inside the selected lists are analyzed — cached price data is reused.
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 md:grid-cols-3">
          {(Object.keys(LIST_LABEL) as ListId[]).map(id => (
            <label key={id} className="flex cursor-pointer items-center gap-2 text-[12px] text-foreground">
              <Checkbox checked={enabled[id]} onCheckedChange={() => toggle(id)} />
              <span>{LIST_LABEL[id]}</span>
              {LIST_LAYER[id] && (
                <span className="rounded bg-muted/40 px-1 text-[9px] uppercase tracking-wide text-muted-foreground">
                  {LAYERS.find(l => l.id === LIST_LAYER[id])!.label}
                </span>
              )}
            </label>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            Min RS Rating
            <Input
              type="number" min={0} max={99} value={minRating}
              onChange={e => setMinRating(Math.max(0, Math.min(99, Number(e.target.value) || 0)))}
              className="h-7 w-16 text-[12px]"
            />
          </label>
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            Top N per list (0 = all)
            <Input
              type="number" min={0} max={2000} value={topN}
              onChange={e => setTopN(Math.max(0, Math.min(2000, Number(e.target.value) || 0)))}
              className="h-7 w-20 text-[12px]"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
            <Checkbox checked={excludeOtc} onCheckedChange={() => setExcludeOtc(v => !v)} />
            Exclude OTC
          </label>
        </div>

        {enabled.manual && (
          <Textarea
            value={manualRaw}
            onChange={e => setManualRaw(e.target.value)}
            placeholder="Paste your own tickers here — NVDA, AMD, AVGO…"
            className="mt-3 h-20 text-[12px]"
          />
        )}

        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => void run()}
            disabled={running || metricsLoading}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground disabled:opacity-60"
          >
            {running || metricsLoading ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            {running || metricsLoading ? "Analyzing…" : "Run Theme Setup Analysis"}
          </button>
          {metricsLoading && metricsProgress.total > 0 && (
            <span className="font-mono text-[11px] text-muted-foreground">
              price metrics {metricsProgress.done}/{metricsProgress.total}
            </span>
          )}
          {runNote && <span className="text-[11px] text-muted-foreground">{runNote}</span>}
        </div>
      </div>

      {membership && themeAggs.length > 0 && (
        <>
          {/* Concentration — Industry (primary) / Sector / Theme, shared colors */}
          <div className="rounded-lg border border-border/60 bg-card/40 p-3">
            <div className="mb-2 text-xs font-semibold text-foreground">Concentration &amp; Performance Context</div>
            <GroupConcentrationPanel
              items={concentrationItems}
              mode={groupMode}
              onModeChange={setGroupMode}
              availableModes={["industry", "subIndustry", "sector", "theme"]}
              height={280}
            />
          </div>

          {/* 52-Week High / Low Leadership */}
          <div className="rounded-lg border border-border/60 bg-card/40 p-3">
            <div className="mb-2 text-xs font-semibold text-foreground">52-Week High / Low Leadership</div>
            <HighLowLeadership
              items={highLowItems}
              mode={groupMode}
              onModeChange={setGroupMode}
              availableModes={["industry", "subIndustry", "sector", "theme"]}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Per-list breakdown */}
            <div className="rounded-lg border border-border/60 bg-card/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">Lists &amp; Overlap</span>
                <span className="font-mono text-[10px] text-muted-foreground">{totalHits} unique stocks</span>
              </div>
              <div className="space-y-1">
                {activeLists.map(id => {
                  const syms = listSets.get(id) ?? [];
                  const selected = overlapSel.has(id);
                  return (
                    <div key={id} className="flex items-center gap-2 text-[11px]">
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => setOverlapSel(prev => {
                          const next = new Set(prev);
                          next.has(id) ? next.delete(id) : next.add(id);
                          return next;
                        })}
                      />
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {LIST_LABEL[id]} <span className="font-mono text-muted-foreground">({syms.length})</span>
                      </span>
                      <button onClick={() => setViewList(viewList === id ? null : id)} className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                        <Eye size={10} />
                      </button>
                      <button onClick={() => copyList(syms, LIST_LABEL[id])} className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                        <Copy size={10} />
                      </button>
                      <button onClick={() => download(exportSymbols(syms), `${id}-${syms.length}.txt`)} className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                        <Download size={10} />
                      </button>
                    </div>
                  );
                })}
              </div>

              {viewList && (
                <div className="mt-2 max-h-40 overflow-y-auto rounded border border-border/60 bg-background/50 p-2 font-mono text-[10px] text-muted-foreground">
                  {(listSets.get(viewList) ?? []).join(", ") || "No stocks."}
                </div>
              )}

              {overlapSel.size >= 2 && (
                <div className="mt-3 border-t border-border/50 pt-2">
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                    <GitCompare size={11} /> List comparison
                  </div>
                  <div className="flex items-center justify-between py-0.5 text-[11px]">
                    <span className="text-foreground">In all selected lists</span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-primary">{overlap.intersection.length}</span>
                      <button onClick={() => copyList(overlap.intersection, "overlap")} className="text-muted-foreground hover:text-foreground"><Copy size={10} /></button>
                      <button onClick={() => download(exportSymbols(overlap.intersection), "overlap.txt")} className="text-muted-foreground hover:text-foreground"><Download size={10} /></button>
                    </span>
                  </div>
                  {overlap.uniques.map(u => (
                    <div key={u.id} className="flex items-center justify-between py-0.5 text-[11px]">
                      <span className="truncate text-muted-foreground">Only in {LIST_LABEL[u.id]}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-foreground">{u.symbols.length}</span>
                        <button onClick={() => copyList(u.symbols, `only ${LIST_LABEL[u.id]}`)} className="text-muted-foreground hover:text-foreground"><Copy size={10} /></button>
                        <button onClick={() => download(exportSymbols(u.symbols), `only-${u.id}.txt`)} className="text-muted-foreground hover:text-foreground"><Download size={10} /></button>
                      </span>
                    </div>
                  ))}
                  <div className="mt-2 text-[10px] text-muted-foreground">Top {GROUP_LABEL_LC[groupMode]} per selected list</div>
                  {overlap.perList.map(p => (
                    <div key={p.id} className="flex items-center justify-between py-0.5 text-[10px]">
                      <span className="truncate text-muted-foreground">{LIST_LABEL[p.id]}</span>
                      <span className="truncate font-mono text-foreground">{p.top || "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>



            {/* Rotation / change of character */}
            <div className="rounded-lg border border-border/60 bg-card/40 p-3">
              <div className="mb-2 text-xs font-semibold text-foreground">Leadership Rotation — Change of Character ({GROUP_MODE_LABEL[groupMode]})</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-[hsl(160,70%,50%)]">
                    <ArrowUpRight size={12} /> Rising (momentum &gt; leadership)
                  </div>
                  {themeAggs.filter(t => !t.isUnassigned && t.rotation > 3).slice(0, 8).map(t => (
                    <div key={t.name} className="flex items-center justify-between py-0.5 text-[11px]">
                      <span className="truncate text-foreground">{t.name}</span>
                      <span className="font-mono text-[hsl(160,70%,50%)]">+{t.rotation.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-destructive">
                    <ArrowDownRight size={12} /> Fading (leadership only)
                  </div>
                  {themeAggs.filter(t => !t.isUnassigned && t.rotation < -3).slice(0, 8).map(t => (
                    <div key={t.name} className="flex items-center justify-between py-0.5 text-[11px]">
                      <span className="truncate text-foreground">{t.name}</span>
                      <span className="font-mono text-destructive">{t.rotation.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-3 border-t border-border/50 pt-2">
                <div className="mb-1 text-[11px] font-semibold text-foreground">Base / Early-Stage Density</div>
                {themeAggs.filter(t => !t.isUnassigned && t.baseDensity > 0)
                  .sort((a, b) => b.baseDensity - a.baseDensity).slice(0, 6)
                  .map(t => (
                    <div key={t.name} className="flex items-center justify-between py-0.5 text-[11px]">
                      <span className="truncate text-foreground">{t.name}</span>
                      <span className="font-mono text-[hsl(200,80%,55%)]">
                        {(t.baseDensity * 100).toFixed(0)}% · {t.layerMembers.setup.length} basing
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          {/* Ranking */}
          <div className="rounded-lg border border-border/60 bg-card/40">
            <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
              <span className="text-xs font-semibold text-foreground">Setup Score Ranking — by {GROUP_MODE_LABEL[groupMode]}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const snap: Record<string, number> = {};
                    for (const t of themeAggs) snap[t.name] = t.score;
                    try { localStorage.setItem(SNAP_LS_KEY, JSON.stringify(snap)); } catch { /* quota */ }
                    setSnapshot(snap);
                    toast.success("Snapshot saved — future runs show the score change per theme.");
                  }}
                  className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <Save size={11} /> Save snapshot
                </button>
                <button
                  onClick={() => copyList(Array.from(membership.keys()), "all qualifying stocks")}
                  className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <Copy size={11} /> Copy all
                </button>
                <button
                  onClick={() => download(exportSymbols(Array.from(membership.keys())), "theme-setup-analyzer.txt")}
                  className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <Download size={11} /> .txt
                </button>
              </div>
            </div>

            <div className="max-h-[420px] overflow-y-auto">
              {themeAggs.map(t => {
                const open = expanded === t.name;
                return (
                  <div key={t.name} className="border-b border-border/40 last:border-0">
                    <button
                      onClick={() => setExpanded(open ? null : t.name)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/20"
                    >
                      <span className="w-12 font-mono text-[13px] font-semibold text-primary">{t.score.toFixed(1)}</span>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                        {t.name}
                        <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                          {t.symbols.length}/{t.themeSize}
                        </span>
                        {snapshot && typeof snapshot[t.name] === "number" && Math.abs(t.score - snapshot[t.name]) >= 0.1 && (
                          <span className={`ml-2 font-mono text-[10px] ${t.score > snapshot[t.name] ? "text-gain-medium" : "text-loss-strong"}`}>
                            {t.score > snapshot[t.name] ? "+" : ""}{(t.score - snapshot[t.name]).toFixed(1)} vs snapshot
                          </span>
                        )}
                        {snapshot && snapshot[t.name] === undefined && (
                          <span className="ml-2 rounded bg-primary/15 px-1 font-mono text-[9px] text-primary">NEW</span>
                        )}
                      </span>
                      {t.baseDensity >= 0.15 && (
                        <span className="inline-flex items-center gap-1 rounded border border-[hsl(200,80%,55%)]/40 bg-[hsl(200,80%,55%)]/10 px-1.5 py-0.5 text-[9px] font-semibold text-[hsl(200,80%,55%)]">
                          <Waves size={9} /> Early / Basing
                        </span>
                      )}
                      <span className="flex flex-wrap items-center gap-1">
                        {LAYERS.filter(l => t.layerScores[l.id] >= 0.25).map(l => {
                          const Icon = l.icon;
                          return (
                            <span
                              key={l.id}
                              className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold"
                              style={{ borderColor: `${l.color}55`, background: `${l.color}18`, color: l.color }}
                            >
                              <Icon size={9} /> {l.label}
                            </span>
                          );
                        })}
                      </span>
                    </button>

                    {open && (
                      <div className="bg-background/40 px-3 pb-3 pt-1">
                        <div className="mb-2 flex items-center gap-2">
                          <button
                            onClick={() => copyList(t.symbols, t.name)}
                            className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            <Copy size={10} /> Copy theme
                          </button>
                          <button
                            onClick={() => download(exportSymbols(t.symbols), `${t.name.replace(/\W+/g, "-").toLowerCase()}.txt`)}
                            className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            <Download size={10} /> .txt
                          </button>
                        </div>
                        <div className="space-y-1">
                          {t.symbols.map(sym => {
                            const lists = Array.from(membership.get(sym) ?? []);
                            return (
                              <div key={sym} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                <span className="w-16 font-mono font-semibold text-foreground">{sym}</span>
                                {lists.map(l => {
                                  const layer = LIST_LAYER[l] ? LAYERS.find(x => x.id === LIST_LAYER[l])! : null;
                                  return (
                                    <span
                                      key={l}
                                      className="rounded px-1.5 py-0.5 text-[9px]"
                                      style={{
                                        background: layer ? `${layer.color}18` : "hsl(var(--muted))",
                                        color: layer ? layer.color : "hsl(var(--muted-foreground))",
                                      }}
                                    >
                                      {LIST_LABEL[l]}
                                    </span>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
