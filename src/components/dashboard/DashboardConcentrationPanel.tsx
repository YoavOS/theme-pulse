import { useEffect, useMemo, useState } from "react";
import { ChevronDown, PieChart as PieChartIcon } from "lucide-react";
import GroupConcentrationPanel, { type ConcentrationItem } from "@/components/shared/GroupConcentrationPanel";
import type { GroupMode } from "@/lib/groupColors";
import { useUniverseSectors } from "@/hooks/useUniverseSectors";
import type { ThemeData } from "@/data/themeData";

type Source = "themes" | "universe";

interface Props {
  themes: ThemeData[];
}

/**
 * Dashboard-level concentration view: where the current leadership sits by
 * Theme, Industry or Sector. Collapsed by default and lazy-loading, so it
 * costs nothing until the user opens it.
 */
export default function DashboardConcentrationPanel({ themes }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<GroupMode>("theme");
  const [source, setSource] = useState<Source>("themes");

  const { rows, loading, load } = useUniverseSectors();

  // Industry data is only needed for the industry/sector views or the universe source.
  const needsIndustry = open && (mode !== "theme" || source === "universe");
  useEffect(() => { if (needsIndustry) load(); }, [needsIndustry, load]);

  const industryBySymbol = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const r of rows) m.set(r.symbol.toUpperCase(), r.sector);
    return m;
  }, [rows]);

  const themeItems: ConcentrationItem[] = useMemo(() => {
    const out: ConcentrationItem[] = [];
    const seen = new Set<string>();
    for (const t of themes) {
      for (const tk of t.tickers) {
        if (tk.skipped) continue;
        const sym = tk.symbol.toUpperCase();
        if (seen.has(sym)) continue;
        seen.add(sym);
        out.push({
          symbol: sym,
          theme: t.theme_name,
          industry: industryBySymbol.get(sym) ?? null,
          rating: null,
          ret: typeof tk.pct === "number" ? tk.pct : null,
        });
      }
    }
    return out;
  }, [themes, industryBySymbol]);

  const universeItems: ConcentrationItem[] = useMemo(() => {
    const themeBySymbol = new Map<string, string>();
    for (const t of themes) for (const tk of t.tickers) {
      const sym = tk.symbol.toUpperCase();
      if (!themeBySymbol.has(sym)) themeBySymbol.set(sym, t.theme_name);
    }
    return rows.map(r => ({
      symbol: r.symbol.toUpperCase(),
      theme: themeBySymbol.get(r.symbol.toUpperCase()) ?? null,
      industry: r.sector,
      rating: null,
      ret: r.ret,
    }));
  }, [rows, themes]);

  const items = source === "themes" ? themeItems : universeItems;

  return (
    <section className="mt-6 rounded-lg border border-border bg-card/40">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <PieChartIcon size={14} className="text-primary" />
          Concentration — Theme · Industry · Sector
        </span>
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {open ? "Hide" : "Show"}
          <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="border-t border-border/60 p-3">
          <GroupConcentrationPanel
            items={items}
            mode={mode}
            onModeChange={setMode}
            availableModes={["theme", "industry", "sector"]}
            height={320}
            emptyLabel={loading ? "Loading industry data…" : "No stocks available yet."}
            headerExtra={
              <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/20 p-0.5">
                {(["themes", "universe"] as Source[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setSource(s)}
                    className={`rounded px-2.5 py-1 text-[11px] font-medium transition ${
                      source === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s === "themes" ? "My Themes" : "All Industries"}
                  </button>
                ))}
              </div>
            }
          />
        </div>
      )}
    </section>
  );
}
