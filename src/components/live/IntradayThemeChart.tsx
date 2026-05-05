import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

interface Series {
  ts: number[];
  close: number[];
  prevClose: number | null;
}

interface Props {
  symbols: string[];        // top 6-8 stocks
  themeLabel: string | null;
  onClose: () => void;
}

// Distinct, theme-friendly palette (HSL hand-picked for dark bg).
const PALETTE = [
  "hsl(170 90% 55%)",
  "hsl(35 95% 60%)",
  "hsl(285 80% 70%)",
  "hsl(200 90% 65%)",
  "hsl(140 70% 60%)",
  "hsl(0 80% 65%)",
  "hsl(50 95% 60%)",
  "hsl(220 80% 70%)",
];

const BENCH_COLORS: Record<string, string> = {
  SPY: "hsl(0 0% 80%)",
  QQQ: "hsl(195 70% 65%)",
};

function fmtTime(ts: number) {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function IntradayThemeChart({ symbols, themeLabel, onClose }: Props) {
  const tickers = useMemo(() => symbols.slice(0, 8), [symbols]);
  const [showSpy, setShowSpy] = useState(true);
  const [showQqq, setShowQqq] = useState(true);
  const [data, setData] = useState<Record<string, Series> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setData(null);
    (async () => {
      try {
        const all = Array.from(new Set([...tickers, "SPY", "QQQ"]));
        const { data: resp, error: err } = await supabase.functions.invoke("get-intraday-prices", {
          body: { symbols: all, interval: "5m" },
        });
        if (cancelled) return;
        if (err) throw err;
        setData((resp as any)?.results ?? {});
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load intraday data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tickers]);

  // Build merged-by-timestamp dataset of % change vs prev close (or first bar).
  const { chartData, allSyms } = useMemo(() => {
    if (!data) return { chartData: [] as any[], allSyms: [] as string[] };
    const all: string[] = [];
    if (showSpy) all.push("SPY");
    if (showQqq) all.push("QQQ");
    for (const t of tickers) all.push(t);

    const tsSet = new Set<number>();
    const baseline: Record<string, number> = {};
    for (const sym of all) {
      const s = data[sym];
      if (!s || !s.ts?.length) continue;
      const base = s.prevClose && s.prevClose > 0 ? s.prevClose : s.close[0];
      if (!base || base <= 0) continue;
      baseline[sym] = base;
      for (const t of s.ts) tsSet.add(t);
    }
    const sortedTs = [...tsSet].sort((a, b) => a - b);

    // Build per-symbol last-known map for forward-fill
    const lookups: Record<string, Map<number, number>> = {};
    for (const sym of all) {
      const s = data[sym];
      if (!s) continue;
      const m = new Map<number, number>();
      s.ts.forEach((t, i) => m.set(t, s.close[i]));
      lookups[sym] = m;
    }

    const last: Record<string, number | null> = {};
    for (const sym of all) last[sym] = null;

    const rows = sortedTs.map((t) => {
      const row: any = { ts: t, time: fmtTime(t) };
      for (const sym of all) {
        const v = lookups[sym]?.get(t);
        if (v != null) last[sym] = v;
        const cur = last[sym];
        const base = baseline[sym];
        if (cur != null && base) {
          row[sym] = Math.round(((cur - base) / base) * 10000) / 100;
        }
      }
      return row;
    });
    return { chartData: rows, allSyms: all };
  }, [data, tickers, showSpy, showQqq]);

  return (
    <div className="mt-4 rounded-xl border border-border/60 bg-background/40 p-4">
      <div className="mb-3 flex items-center gap-3 flex-wrap">
        <h3 className="font-['Syne',sans-serif] text-lg font-bold uppercase tracking-wider text-foreground">
          Intraday Theme Performance
        </h3>
        {themeLabel && <span className="text-sm font-bold text-primary">{themeLabel}</span>}
        <span className="text-xs text-muted-foreground">% change vs previous close · 5m bars</span>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input type="checkbox" checked={showSpy} onChange={(e) => setShowSpy(e.target.checked)} />
            <span style={{ color: BENCH_COLORS.SPY }} className="font-mono font-bold">SPY</span>
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input type="checkbox" checked={showQqq} onChange={(e) => setShowQqq(e.target.checked)} />
            <span style={{ color: BENCH_COLORS.QQQ }} className="font-mono font-bold">QQQ</span>
          </label>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-2">
            <X size={14} />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">
          <Loader2 size={14} className="mr-2 animate-spin" /> Loading intraday prices…
        </div>
      ) : error ? (
        <div className="flex h-[360px] items-center justify-center text-sm text-destructive">{error}</div>
      ) : chartData.length === 0 ? (
        <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">
          No intraday data available (market may be closed).
        </div>
      ) : (
        <div className="h-[420px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.25} vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                stroke="hsl(var(--border))"
                minTickGap={40}
              />
              <YAxis
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                stroke="hsl(var(--border))"
                tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}
                width={60}
              />
              <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: any, name: any) => [`${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(2)}%`, name]}
                labelStyle={{ color: "hsl(var(--muted-foreground))" }}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="line" />
              {allSyms.map((sym, i) => {
                const isBench = sym === "SPY" || sym === "QQQ";
                const color = isBench ? BENCH_COLORS[sym] : PALETTE[(i - (showSpy ? 1 : 0) - (showQqq ? 1 : 0) + 8) % 8];
                return (
                  <Line
                    key={sym}
                    type="monotone"
                    dataKey={sym}
                    stroke={color}
                    strokeWidth={isBench ? 1.5 : 2}
                    strokeDasharray={isBench ? "4 4" : undefined}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
