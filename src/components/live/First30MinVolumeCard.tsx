import { useEffect, useMemo, useState } from "react";
import { Loader2, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface Session {
  date: string;
  vol: number;
  ratio: number | null;
}

interface ApiResp {
  symbol: string;
  todayFirst30: number | null;
  avgFirst30: number | null;
  ratio: number | null;
  sessions: Session[];
  isToday: boolean;
  sampleSize?: number;
  error?: string;
}

interface Props {
  symbol: string;
}

function compactNum(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return `${Math.round(n)}`;
}

function classify(ratio: number | null) {
  if (ratio === null) return { label: "No Data", tone: "muted", color: "hsl(0 0% 55%)" };
  if (ratio >= 1.5)
    return { label: "Strong — High-conviction ORB possible", tone: "strong", color: "hsl(160 80% 45%)" };
  if (ratio >= 1.2)
    return { label: "Elevated", tone: "elevated", color: "hsl(40 95% 55%)" };
  if (ratio < 0.8)
    return { label: "Below Average — Weak participation", tone: "weak", color: "hsl(0 75% 60%)" };
  return { label: "Normal", tone: "neutral", color: "hsl(0 0% 65%)" };
}

function Sparkline({ sessions }: { sessions: Session[] }) {
  const w = 110, h = 28, pad = 2;
  const ratios = sessions.map((s) => s.ratio ?? 1);
  if (ratios.length < 2) return <div className="text-[11px] text-muted-foreground">—</div>;
  const min = Math.min(...ratios, 0.6);
  const max = Math.max(...ratios, 1.6);
  const span = max - min || 1;
  const step = (w - pad * 2) / Math.max(1, ratios.length - 1);
  const pts = ratios.map((r, i) => {
    const x = pad + i * step;
    const y = h - pad - ((r - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  // baseline at ratio=1
  const baselineY = h - pad - ((1 - min) / span) * (h - pad * 2);
  return (
    <svg width={w} height={h} className="block">
      <line x1={pad} x2={w - pad} y1={baselineY} y2={baselineY} stroke="hsl(var(--border))" strokeDasharray="2 2" strokeWidth={1} />
      <polyline points={pts.join(" ")} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
      {ratios.map((r, i) => {
        const [x, y] = pts[i].split(",").map(Number);
        const c = classify(r).color;
        return <circle key={i} cx={x} cy={y} r={1.6} fill={c} />;
      })}
    </svg>
  );
}

export default function First30MinVolumeCard({ symbol }: Props) {
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true); setError(null); setData(null);
    (async () => {
      try {
        const { data: resp, error: err } = await supabase.functions.invoke("first-30min-volume", {
          body: { symbol },
        });
        if (cancelled) return;
        if (err) throw err;
        setData(resp as ApiResp);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [symbol]);

  const cls = useMemo(() => classify(data?.ratio ?? null), [data?.ratio]);
  const ratio = data?.ratio ?? null;
  const pctVsAvg = ratio !== null ? Math.round((ratio - 1) * 100) : null;

  return (
    <div
      className="rounded-lg border p-3"
      style={{
        borderColor: ratio !== null ? `${cls.color} / 0.4` : "hsl(var(--border))",
        background: ratio !== null ? `color-mix(in srgb, ${cls.color} 8%, transparent)` : "rgba(255,255,255,0.02)",
      }}
    >
      <div className="flex items-center gap-1.5">
        <div className="font-['Syne',sans-serif] text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          First 30 Min Volume Strength
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex cursor-help"><Info size={11} className="text-muted-foreground" /></span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">
            Today's regular-session volume in the first 30 minutes after the open vs the 10-day average.
            Strong (≥1.5×) often precedes high-conviction Opening Range Breakouts.
          </TooltipContent>
        </Tooltip>
      </div>

      {loading ? (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={12} className="animate-spin" /> Calculating…
        </div>
      ) : error ? (
        <div className="mt-2 text-xs text-destructive">{error}</div>
      ) : !data || ratio === null ? (
        <div className="mt-2 text-xs text-muted-foreground">
          {data?.error === "no_intraday_data"
            ? "No intraday data."
            : !data?.isToday
            ? "Market hasn't opened yet (or no bars in the first 30 min)."
            : "Insufficient history to compare."}
        </div>
      ) : (
        <>
          <div className="mt-1.5 flex items-baseline gap-3">
            <div
              className="font-mono text-3xl font-extrabold tabular-nums leading-none"
              style={{ color: cls.color }}
            >
              {ratio.toFixed(2)}×
            </div>
            <div
              className="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{
                color: cls.color,
                borderColor: `${cls.color}`,
                background: `color-mix(in srgb, ${cls.color} 14%, transparent)`,
              }}
            >
              {cls.label}
            </div>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {pctVsAvg !== null && (
              <span className="font-mono">
                {pctVsAvg > 0 ? "+" : ""}{pctVsAvg}% vs 10-day avg
              </span>
            )}
            {data.todayFirst30 != null && (
              <> · {compactNum(data.todayFirst30)} vs {data.avgFirst30 ? compactNum(data.avgFirst30) : "—"}</>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Sparkline sessions={data.sessions} />
            <span className="text-[10px] text-muted-foreground">last {data.sessions.length}d</span>
          </div>
        </>
      )}
    </div>
  );
}
