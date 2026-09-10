import { useMemo, useState } from "react";
import { Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Sector } from "recharts";
import { colorForGroup, GROUP_MODE_LABEL, groupKeyForIndustry, type GroupMode } from "@/lib/groupColors";

export interface ConcentrationItem {
  symbol: string;
  industry?: string | null;   // granular Finnhub industry
  theme?: string | null;      // curated theme name
  rating?: number | null;     // RS rating 1..99
  ret?: number | null;        // performance % for the active timeframe
}

export interface GroupSlice {
  name: string;
  count: number;
  pct: number;
  avgRating: number | null;
  avgRet: number | null;
  symbols: string[];
  items: ConcentrationItem[];
}

export function buildGroups(items: ConcentrationItem[], mode: GroupMode): GroupSlice[] {
  const buckets = new Map<string, ConcentrationItem[]>();
  for (const it of items) {
    let key: string;
    if (mode === "theme") key = (it.theme ?? "").trim() || "Unassigned";
    else key = groupKeyForIndustry(it.industry, mode);
    const arr = buckets.get(key) ?? [];
    arr.push(it);
    buckets.set(key, arr);
  }
  const total = items.length || 1;
  const out: GroupSlice[] = [];
  buckets.forEach((arr, name) => {
    const ratings = arr.map(a => a.rating).filter((v): v is number => typeof v === "number");
    const rets = arr.map(a => a.ret).filter((v): v is number => typeof v === "number");
    const sorted = [...arr].sort((a, b) => (b.rating ?? -999) - (a.rating ?? -999));
    out.push({
      name,
      count: arr.length,
      pct: (arr.length / total) * 100,
      avgRating: ratings.length ? ratings.reduce((s, v) => s + v, 0) / ratings.length : null,
      avgRet: rets.length ? rets.reduce((s, v) => s + v, 0) / rets.length : null,
      symbols: sorted.map(a => a.symbol),
      items: sorted,
    });
  });
  out.sort((a, b) => (a.name === "Unassigned" || a.name === "Unknown" ? 1 : 0) - (b.name === "Unassigned" || b.name === "Unknown" ? 1 : 0) || b.count - a.count);
  return out;
}

function downloadTxt(text: string, name: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const retColor = (v: number | null) =>
  v === null ? "text-muted-foreground" : v > 0 ? "text-gain-medium" : v < 0 ? "text-loss-strong" : "text-muted-foreground";

interface Props {
  items: ConcentrationItem[];
  mode: GroupMode;
  onModeChange: (m: GroupMode) => void;
  availableModes?: GroupMode[];
  /** Extra controls rendered on the toggle row (e.g. data-source switch). */
  headerExtra?: React.ReactNode;
  maxSlices?: number;
  height?: number;
  emptyLabel?: string;
}

export default function GroupConcentrationPanel({
  items, mode, onModeChange,
  availableModes = ["theme", "industry", "subIndustry", "sector"],
  headerExtra, maxSlices = 14, height = 320,
  emptyLabel = "No stocks match the current filters.",
}: Props) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const groups = useMemo(() => buildGroups(items, mode), [items, mode]);

  const slices = useMemo(() => {
    if (groups.length <= maxSlices) return groups;
    const head = groups.slice(0, maxSlices);
    const tail = groups.slice(maxSlices);
    const count = tail.reduce((n, g) => n + g.count, 0);
    const total = items.length || 1;
    const ratings = tail.flatMap(g => g.items.map(i => i.rating)).filter((v): v is number => typeof v === "number");
    const rets = tail.flatMap(g => g.items.map(i => i.ret)).filter((v): v is number => typeof v === "number");
    head.push({
      name: "Other",
      count,
      pct: (count / total) * 100,
      avgRating: ratings.length ? ratings.reduce((s, v) => s + v, 0) / ratings.length : null,
      avgRet: rets.length ? rets.reduce((s, v) => s + v, 0) / rets.length : null,
      symbols: tail.flatMap(g => g.symbols),
      items: tail.flatMap(g => g.items),
    });
    return head;
  }, [groups, maxSlices, items.length]);

  const expandedSlice = expanded ? slices.find(s => s.name === expanded) ?? null : null;

  const copy = (syms: string[], label: string) => {
    navigator.clipboard.writeText(syms.map(s => s.toUpperCase()).join(","));
    toast.success(`Copied ${syms.length} tickers — ${label}`);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/20 p-0.5">
          {availableModes.map(m => (
            <button
              key={m}
              onClick={() => { onModeChange(m); setExpanded(null); setActiveIndex(null); }}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition ${
                mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              View by {GROUP_MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          {items.length} stocks · {groups.length} {GROUP_MODE_LABEL[mode].toLowerCase()} groups
        </span>
        {headerExtra}
      </div>

      {items.length === 0 ? (
        <div className="flex items-center justify-center rounded-lg border border-border bg-card/40 text-xs text-muted-foreground" style={{ height }}>
          {emptyLabel}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card/40 p-3">
          <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="45%"
                  outerRadius="78%"
                  paddingAngle={1}
                  activeIndex={activeIndex ?? undefined}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  activeShape={(p: any) => <Sector {...p} outerRadius={(p.outerRadius ?? 0) + 6} />}
                  onMouseEnter={(_, i) => setActiveIndex(i)}
                  onMouseLeave={() => setActiveIndex(null)}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  onClick={(d: any) => setExpanded(prev => (prev === d.name ? null : d.name))}
                >
                  {slices.map(s => (
                    <Cell
                      key={s.name}
                      fill={colorForGroup(s.name, mode)}
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
                    const d = payload[0].payload as GroupSlice;
                    return (
                      <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-xl">
                        <div className="mb-1 flex items-center justify-between gap-4">
                          <span className="font-semibold text-foreground">{d.name}</span>
                          <span className="font-mono text-primary">{d.pct.toFixed(1)}%</span>
                        </div>
                        <div className="mb-1.5 font-mono text-[10px] text-muted-foreground">
                          {d.count} stocks · avg RS {d.avgRating !== null ? d.avgRating.toFixed(0) : "—"} · avg perf{" "}
                          <span className={retColor(d.avgRet)}>
                            {d.avgRet !== null ? `${d.avgRet >= 0 ? "+" : ""}${d.avgRet.toFixed(1)}%` : "—"}
                          </span>
                        </div>
                        <div className="space-y-0.5 border-t border-border/50 pt-1.5">
                          {d.items.slice(0, 5).map(s => (
                            <div key={s.symbol} className="flex items-center justify-between gap-3 text-[11px]">
                              <span className="font-mono font-semibold text-foreground">{s.symbol}</span>
                              <span className="font-mono text-muted-foreground">#{s.rating ?? "—"}</span>
                            </div>
                          ))}
                          {d.count > 5 && (
                            <div className="pt-1 text-[10px] italic text-muted-foreground">
                              +{d.count - 5} more · click slice to expand
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

          {/* Legend with performance context */}
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/50 pt-2">
            {slices.map((d, i) => (
              <button
                key={d.name}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseLeave={() => setActiveIndex(null)}
                onClick={() => setExpanded(prev => (prev === d.name ? null : d.name))}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] transition-all hover:scale-[1.03] ${
                  expanded === d.name ? "border-primary bg-primary/10" : "border-border bg-muted/20"
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: colorForGroup(d.name, mode) }} />
                <span className="font-medium text-foreground">{d.name}</span>
                <span className="font-mono text-muted-foreground">{d.pct.toFixed(1)}% ({d.count})</span>
                <span className="font-mono text-muted-foreground">· RS {d.avgRating !== null ? d.avgRating.toFixed(0) : "—"}</span>
                <span className={`font-mono ${retColor(d.avgRet)}`}>
                  {d.avgRet !== null ? `${d.avgRet >= 0 ? "+" : ""}${d.avgRet.toFixed(1)}%` : ""}
                </span>
              </button>
            ))}
          </div>

          {/* Drill-down */}
          {expandedSlice && (
            <div className="mt-3 animate-fade-in rounded-lg border border-primary/30 bg-background/50 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorForGroup(expandedSlice.name, mode) }} />
                    {expandedSlice.name}
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {expandedSlice.count} stocks · {expandedSlice.pct.toFixed(1)}% · avg RS{" "}
                    {expandedSlice.avgRating !== null ? expandedSlice.avgRating.toFixed(0) : "—"} · avg perf{" "}
                    <span className={retColor(expandedSlice.avgRet)}>
                      {expandedSlice.avgRet !== null ? `${expandedSlice.avgRet >= 0 ? "+" : ""}${expandedSlice.avgRet.toFixed(1)}%` : "—"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => copy(expandedSlice.symbols, expandedSlice.name)}
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    <Copy size={10} /> Copy
                  </button>
                  <button
                    onClick={() => downloadTxt(
                      expandedSlice.symbols.join(","),
                      `${expandedSlice.name.replace(/\W+/g, "-").toLowerCase()}.txt`,
                    )}
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    <Download size={10} /> .txt
                  </button>
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto">
                <div className="grid grid-cols-2 gap-x-4 md:grid-cols-3">
                  {expandedSlice.items.map(s => (
                    <div key={s.symbol} className="flex items-center justify-between gap-2 border-b border-border/30 py-1 text-[11px] last:border-0">
                      <span className="font-mono font-semibold text-foreground">{s.symbol}</span>
                      <span className="flex items-center gap-2 font-mono text-muted-foreground">
                        <span>#{s.rating ?? "—"}</span>
                        <span className={retColor(s.ret ?? null)}>
                          {typeof s.ret === "number" ? `${s.ret >= 0 ? "+" : ""}${s.ret.toFixed(1)}%` : "—"}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
