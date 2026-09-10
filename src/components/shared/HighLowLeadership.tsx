import { useMemo, useState } from "react";
import { ArrowUpRight, ArrowDownRight, Copy } from "lucide-react";
import { toast } from "sonner";
import { colorForGroup, GROUP_MODE_LABEL, groupKeyForIndustry, type GroupMode } from "@/lib/groupColors";

export interface HighLowItem {
  symbol: string;
  industry?: string | null;
  theme?: string | null;
  rating?: number | null;
  lastHighDaysAgo?: number | null;
  lastLowDaysAgo?: number | null;
}

export type HlTf = "today" | "1w" | "1m" | "3m";

const TF_DAYS: Record<HlTf, number> = { today: 1, "1w": 7, "1m": 30, "3m": 90 };
const TF_LABEL: Record<HlTf, string> = { today: "Today", "1w": "1 Week", "1m": "1 Month", "3m": "3 Month" };

interface GroupRow {
  name: string;
  hits: number;
  total: number;
  pct: number;
  avgRating: number | null;
  symbols: string[];
}

function groupKey(it: HighLowItem, mode: GroupMode): string {
  if (mode === "theme") return (it.theme ?? "").trim() || "Unassigned";
  if (mode === "industry") return (it.industry ?? "").trim() || "Unknown";
  return gicsForIndustry(it.industry) ?? (it.industry ? "Other" : "Unknown");
}

function rank(items: HighLowItem[], mode: GroupMode, days: number, side: "high" | "low"): GroupRow[] {
  const totals = new Map<string, HighLowItem[]>();
  for (const it of items) {
    const k = groupKey(it, mode);
    const arr = totals.get(k) ?? [];
    arr.push(it);
    totals.set(k, arr);
  }
  const out: GroupRow[] = [];
  totals.forEach((arr, name) => {
    const hitters = arr.filter(it => {
      const d = side === "high" ? it.lastHighDaysAgo : it.lastLowDaysAgo;
      return typeof d === "number" && d < days;
    });
    if (hitters.length === 0) return;
    const ratings = hitters.map(h => h.rating).filter((v): v is number => typeof v === "number");
    out.push({
      name,
      hits: hitters.length,
      total: arr.length,
      pct: (hitters.length / arr.length) * 100,
      avgRating: ratings.length ? ratings.reduce((s, v) => s + v, 0) / ratings.length : null,
      symbols: hitters
        .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1))
        .map(h => h.symbol),
    });
  });
  out.sort((a, b) => b.hits - a.hits || b.pct - a.pct);
  return out;
}

function Column({ rows, side, mode }: { rows: GroupRow[]; side: "high" | "low"; mode: GroupMode }) {
  const [open, setOpen] = useState<string | null>(null);
  const positive = side === "high";
  const tone = positive ? "text-gain-medium" : "text-loss-strong";
  return (
    <div>
      <div className={`mb-1 flex items-center gap-1 text-[11px] font-semibold ${tone}`}>
        {positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
        New 52-Week {positive ? "Highs" : "Lows"}
      </div>
      {rows.length === 0 && <div className="py-2 text-[11px] text-muted-foreground">None in this window.</div>}
      {rows.slice(0, 12).map(r => (
        <div key={r.name} className="border-b border-border/30 last:border-0">
          <button
            onClick={() => setOpen(open === r.name ? null : r.name)}
            className="flex w-full items-center gap-2 py-1 text-left text-[11px] hover:bg-muted/20"
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorForGroup(r.name, mode) }} />
            <span className="min-w-0 flex-1 truncate text-foreground">{r.name}</span>
            <span className={`font-mono ${tone}`}>{r.hits}</span>
            <span className="w-12 text-right font-mono text-muted-foreground">{r.pct.toFixed(0)}%</span>
            <span className="w-14 text-right font-mono text-muted-foreground">
              RS {r.avgRating !== null ? r.avgRating.toFixed(0) : "—"}
            </span>
          </button>
          {open === r.name && (
            <div className="pb-2 pl-4 pr-1">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(r.symbols.join(","));
                  toast.success(`Copied ${r.symbols.length} tickers — ${r.name}`);
                }}
                className="mb-1 inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <Copy size={10} /> Copy {r.symbols.length}
              </button>
              <div className="font-mono text-[10px] text-muted-foreground">{r.symbols.join(", ")}</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

interface Props {
  items: HighLowItem[];
  mode: GroupMode;
  onModeChange: (m: GroupMode) => void;
  availableModes?: GroupMode[];
  timeframe?: HlTf;
  onTimeframeChange?: (tf: HlTf) => void;
  headerExtra?: React.ReactNode;
}

export default function HighLowLeadership({
  items, mode, onModeChange,
  availableModes = ["industry", "subIndustry", "sector", "theme"],
  timeframe, onTimeframeChange, headerExtra,
}: Props) {
  const [localTf, setLocalTf] = useState<HlTf>("1w");
  const tf = timeframe ?? localTf;
  const setTf = onTimeframeChange ?? setLocalTf;

  const days = TF_DAYS[tf];
  const highs = useMemo(() => rank(items, mode, days, "high"), [items, mode, days]);
  const lows = useMemo(() => rank(items, mode, days, "low"), [items, mode, days]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/20 p-0.5">
          {availableModes.map(m => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition ${
                mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              View by {GROUP_MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/20 p-0.5">
          {(Object.keys(TF_LABEL) as HlTf[]).map(t => (
            <button
              key={t}
              onClick={() => setTf(t)}
              className={`rounded px-2 py-1 text-[11px] font-medium transition ${
                tf === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {TF_LABEL[t]}
            </button>
          ))}
        </div>
        {headerExtra}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Column rows={highs} side="high" mode={mode} />
        <Column rows={lows} side="low" mode={mode} />
      </div>
      <div className="text-[10px] text-muted-foreground">
        Counts show groups with new 52-week highs/lows inside the selected window, their share of the group, and average RS rating.
      </div>
    </div>
  );
}
