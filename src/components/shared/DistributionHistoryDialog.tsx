import { useCallback, useEffect, useMemo, useState } from "react";
import { History, Loader2, RefreshCw } from "lucide-react";
import {
  CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis,
} from "recharts";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildGroups, type ConcentrationItem } from "@/components/shared/GroupConcentrationPanel";
import { colorForGroup, GROUP_MODE_LABEL, type GroupMode } from "@/lib/groupColors";
import { loadHistory, rebuildHistory, type HistoryPoint, type Snapshot } from "@/lib/rsHistory";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: GroupMode;
  /** The window's filters applied to one past snapshot. */
  replay: (snap: Snapshot) => ConcentrationItem[];
  /** Today's list exactly as the window shows it (the last point of the chart). */
  nowItems: ConcentrationItem[];
  /** Short description of the active filters, shown under the title. */
  filterLabel: string;
}

const MIN_POINTS = 4;
const DEFAULT_LINES = 6;
const MAX_LINES = 12;

const fmtDay = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Each group's share (%) of the filtered list over time: one line per group, one point per week.
 * Past weeks replay the same filters on the stored snapshot of that week's RS list.
 */
export default function DistributionHistoryDialog({ open, onOpenChange, mode, replay, nowItems, filterLabel }: Props) {
  const [points, setPoints] = useState<HistoryPoint[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "building" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState<Set<string> | null>(null);

  const load = useCallback(async (allowBuild: boolean) => {
    setStatus("loading"); setError(null);
    try {
      let pts = await loadHistory();
      if (pts.length < MIN_POINTS && allowBuild) {
        setStatus("building");
        await rebuildHistory();
        pts = await loadHistory();
      }
      setPoints(pts); setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); setStatus("error");
    }
  }, []);

  useEffect(() => { if (open && !points && status === "idle") void load(true); }, [open, points, status, load]);
  useEffect(() => { setShown(null); setHidden(new Set()); }, [mode]);

  // Group shares per point (past weeks + today).
  const series = useMemo(() => {
    if (!points) return null;
    const rows = points.map((p) => ({ day: p.day, source: p.source as "live" | "rebuilt" | "now", items: replay(p.snap) }));
    const today = new Date().toISOString().slice(0, 10);
    if (!rows.length || rows[rows.length - 1].day < today) rows.push({ day: today, source: "now", items: nowItems });
    else rows[rows.length - 1] = { day: rows[rows.length - 1].day, source: "now", items: nowItems };
    return rows.map((r) => {
      const shares: Record<string, number> = {};
      for (const g of buildGroups(r.items, mode)) shares[g.name] = Math.round(g.pct * 10) / 10;
      return { day: r.day, source: r.source, total: r.items.length, shares };
    });
  }, [points, replay, nowItems, mode]);

  // Groups ranked by their share today, then by their average share.
  const ranked = useMemo(() => {
    if (!series?.length) return [] as { name: string; now: number; avg: number; first: number }[];
    const names = new Set<string>();
    series.forEach((r) => Object.keys(r.shares).forEach((n) => names.add(n)));
    const last = series[series.length - 1].shares;
    const firstRow = series[0].shares;
    return [...names]
      .filter((n) => n !== "Unassigned" && n !== "Unknown")
      .map((n) => ({
        name: n,
        now: last[n] ?? 0,
        first: firstRow[n] ?? 0,
        avg: series.reduce((s, r) => s + (r.shares[n] ?? 0), 0) / series.length,
      }))
      .sort((a, b) => b.now - a.now || b.avg - a.avg);
  }, [series]);

  const visible = useMemo(() => {
    const base = shown ?? new Set(ranked.slice(0, DEFAULT_LINES).map((g) => g.name));
    return ranked.filter((g) => base.has(g.name) && !hidden.has(g.name)).map((g) => g.name);
  }, [ranked, shown, hidden]);

  const chartData = useMemo(
    () => (series ?? []).map((r) => {
      const row: Record<string, number | string> = { day: r.day, label: r.source === "now" ? "Now" : fmtDay(r.day), total: r.total };
      for (const n of visible) row[n] = r.shares[n] ?? 0;
      return row;
    }),
    [series, visible],
  );

  // The span of weeks rebuilt from price history (shaded on the chart).
  const rebuiltSpan = useMemo(() => {
    const labels = (series ?? []).filter((r) => r.source === "rebuilt").map((r) => fmtDay(r.day));
    return labels.length ? { from: labels[0], to: labels[labels.length - 1] } : null;
  }, [series]);
  const liveCount = (series ?? []).filter((r) => r.source === "live").length;

  const toggle = (name: string) => {
    const base = new Set(shown ?? ranked.slice(0, DEFAULT_LINES).map((g) => g.name));
    if (base.has(name) && !hidden.has(name)) { base.delete(name); }
    else { if (base.size >= MAX_LINES) return; base.add(name); }
    setHidden(new Set());
    setShown(base);
  };

  const label = GROUP_MODE_LABEL[mode];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-['Syne',sans-serif]">
            <History size={16} className="text-primary" />
            {label} share over time
          </DialogTitle>
          <DialogDescription className="text-xs">
            Each line is one {label.toLowerCase()} group's share of the list (%), one point per week. Past weeks use the same filters: {filterLabel}.
          </DialogDescription>
        </DialogHeader>

        {status === "loading" || status === "building" ? (
          <div className="flex h-[360px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            {status === "building" ? "Building history from price data (first time only, up to a minute)…" : "Loading history…"}
          </div>
        ) : status === "error" ? (
          <div className="flex h-[360px] flex-col items-center justify-center gap-3 text-sm">
            <span className="text-loss-strong">{error}</span>
            <button onClick={() => void load(true)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted/40">
              <RefreshCw size={12} /> Try again
            </button>
          </div>
        ) : !series || series.length < 2 ? (
          <div className="flex h-[360px] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            Not enough history yet. Snapshots are saved every weekday after the close.
            <button onClick={() => void load(true)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted/40">
              <RefreshCw size={12} /> Build from price history
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="h-[360px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                  {rebuiltSpan && (
                    <ReferenceArea x1={rebuiltSpan.from} x2={rebuiltSpan.to} fill="hsl(var(--muted-foreground))" fillOpacity={0.06}
                      label={{ value: "rebuilt from price history", position: "insideTopLeft", fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  )}
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval="preserveStartEnd" minTickGap={18} />
                  <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={40} domain={[0, "auto"]} />
                  <RechartsTooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                    labelFormatter={(l, p) => {
                      const tot = p?.[0]?.payload?.total;
                      return `${l}${typeof tot === "number" ? ` · ${tot} stocks` : ""}`;
                    }}
                    formatter={(v: number, n: string) => [`${v.toFixed(1)}%`, n]}
                    itemSorter={(it) => -(Number(it.value) || 0)}
                  />
                  {visible.map((n) => (
                    <Line key={n} type="monotone" dataKey={n} stroke={colorForGroup(n, mode)} strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div>
              <div className="mb-1.5 text-[11px] text-muted-foreground">
                Click to show or hide a line (up to {MAX_LINES}). Change = share now vs the first week.
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ranked.slice(0, 30).map((g) => {
                  const on = visible.includes(g.name);
                  const d = Math.round((g.now - g.first) * 10) / 10;
                  return (
                    <button
                      key={g.name}
                      onClick={() => toggle(g.name)}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] transition ${
                        on ? "border-border bg-muted/40 text-foreground" : "border-transparent text-muted-foreground hover:border-border"
                      }`}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: on ? colorForGroup(g.name, mode) : "hsl(var(--muted-foreground))" }} />
                      {g.name}
                      <span className="font-mono">{g.now.toFixed(1)}%</span>
                      <span className={`font-mono ${d > 0 ? "text-gain-medium" : d < 0 ? "text-loss-strong" : "text-muted-foreground"}`}>
                        {d > 0 ? "+" : ""}{d.toFixed(1)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {rebuiltSpan ? "Shaded weeks were rebuilt from daily prices using today's stock list and today's sectors (stocks that have left the list since aren't counted). " : ""}
              {liveCount ? `${liveCount} week${liveCount === 1 ? "" : "s"} from saved daily snapshots. ` : "Daily snapshots are saved from now on, after every close. "}
              RS ratings are ranked within each week's list; RS Alpha's table filters (growth, superperformance, new highs) aren't applied.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
