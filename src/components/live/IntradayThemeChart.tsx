import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Series {
  ts: number[];
  close: number[];
  prevClose: number | null;
}

interface Props {
  open: boolean;
  symbols: string[];
  themeLabel: string | null;
  onClose: () => void;
}

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

export default function IntradayThemeChart({ open, symbols, themeLabel, onClose }: Props) {
  const tickers = useMemo(() => symbols.slice(0, 7), [symbols]);
  const [showSpy, setShowSpy] = useState(true);
  const [showQqq, setShowQqq] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [data, setData] = useState<Record<string, Series> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const cancelRef = useRef(false);

  const fetchData = useCallback(async () => {
    cancelRef.current = false;
    setLoading(true); setError(null);
    try {
      const all = Array.from(new Set([...tickers, "SPY", "QQQ"]));
      const { data: resp, error: err } = await supabase.functions.invoke("get-intraday-prices", {
        body: { symbols: all, interval: "5m" },
      });
      if (cancelRef.current) return;
      if (err) throw err;
      setData((resp as any)?.results ?? {});
      setLastFetchedAt(Date.now());
    } catch (e: any) {
      if (!cancelRef.current) setError(e?.message ?? "Failed to load intraday data");
    } finally {
      if (!cancelRef.current) setLoading(false);
    }
  }, [tickers]);

  // Load fresh when modal opens
  useEffect(() => {
    if (!open) {
      cancelRef.current = true;
      return;
    }
    setData(null);
    fetchData();
    return () => { cancelRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Optional 30s auto-refresh
  useEffect(() => {
    if (!open || !autoRefresh) return;
    const id = setInterval(() => { fetchData(); }, 30000);
    return () => clearInterval(id);
  }, [open, autoRefresh, fetchData]);

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
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-5xl w-[92vw] p-0 gap-0 border-border/60 bg-background">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-border/60">
          <div className="flex items-center gap-3 flex-wrap pr-8">
            <DialogTitle className="font-['Syne',sans-serif] text-lg uppercase tracking-wider">
              Intraday Theme Performance
            </DialogTitle>
            {themeLabel && <span className="text-sm font-bold text-primary">{themeLabel}</span>}
            <span className="text-xs text-muted-foreground">% change vs prev close · 5m bars</span>
          </div>
          <div className="mt-2 flex items-center gap-4 flex-wrap text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={showSpy} onChange={(e) => setShowSpy(e.target.checked)} />
              <span style={{ color: BENCH_COLORS.SPY }} className="font-mono font-bold">SPY</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={showQqq} onChange={(e) => setShowQqq(e.target.checked)} />
              <span style={{ color: BENCH_COLORS.QQQ }} className="font-mono font-bold">QQQ</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-muted-foreground">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              Auto-refresh (30s)
            </label>
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="h-7 gap-1.5 px-2.5">
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Refresh Chart
            </Button>
            {lastFetchedAt && (
              <span className="text-[10px] text-muted-foreground ml-auto">
                Updated {new Date(lastFetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="px-5 pb-5 pt-3">
          {loading && !data ? (
            <div className="flex h-[440px] items-center justify-center text-sm text-muted-foreground">
              <Loader2 size={14} className="mr-2 animate-spin" /> Loading intraday prices…
            </div>
          ) : error ? (
            <div className="flex h-[440px] items-center justify-center text-sm text-destructive">{error}</div>
          ) : chartData.length === 0 ? (
            <div className="flex h-[440px] items-center justify-center text-sm text-muted-foreground">
              No intraday data available (market may be closed).
            </div>
          ) : (
            <div className="h-[480px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.25} vertical={false} />
                  <XAxis dataKey="time" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} stroke="hsl(var(--border))" minTickGap={40} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} stroke="hsl(var(--border))" tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`} width={60} />
                  <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
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
      </DialogContent>
    </Dialog>
  );
}
