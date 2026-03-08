import { useState, useMemo, useEffect } from "react";
import { ThemeData } from "@/data/themeData";
import { useWatchlist } from "@/hooks/useWatchlistContext";
import { supabase } from "@/integrations/supabase/client";
import { Pin, X, ExternalLink, ArrowUpDown, Newspaper } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSpyBenchmark, formatRS } from "@/hooks/useSpyBenchmark";
import { NewsArticle } from "@/hooks/useThemeNews";
import { NewsTabContent } from "@/components/NewsPanel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SparklineProps {
  data: number[];
  up: boolean;
}

function MiniSparkline({ data, up }: SparklineProps) {
  if (data.length < 2) return <span className="text-muted-foreground text-[10px]">—</span>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 60;
  const h = 20;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={up ? "hsl(152 100% 50%)" : "hsl(40 80% 50%)"}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatVolume(vol: number | undefined | null): string {
  if (!vol) return "—";
  if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(1)}B`;
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(0)}K`;
  return vol.toString();
}

function getRelVolColor(val: number): string {
  if (val > 1.8) return "text-[#00f5c4]";
  if (val > 1.4) return "text-gain-medium";
  if (val >= 1.1) return "text-[#facc15]";
  return "text-muted-foreground";
}

function getSustainedColor(val: number): string {
  if (val > 30) return "text-[#00f5c4]";
  if (val >= 15) return "text-gain-medium";
  if (val >= 5) return "text-[#facc15]";
  return "text-muted-foreground";
}

type SortKey = "symbol" | "pct" | "perf_1w" | "perf_1m" | "volume" | "relVol" | "sustainedVol";
type SortDir = "asc" | "desc";

interface TickerExtra {
  perf_1w: number | null;
  perf_1m: number | null;
  volume: number | null;
  price: number | null;
  sparkline: number[];
  // Volume signals per ticker
  relVol: number | null;
  sustainedVol: number | null;
  volSpikePct: number | null;
}

export default function ThemeDrilldownModal({
  theme,
  open,
  onOpenChange,
  defaultSortKey,
  newsArticles,
}: {
  theme: ThemeData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultSortKey?: SortKey;
  newsArticles?: NewsArticle[];
}) {
   const { isPinned, togglePin } = useWatchlist();
   const navigate = useNavigate();
   const [sortKey, setSortKey] = useState<SortKey>(defaultSortKey || "pct");
   const [sortDir, setSortDir] = useState<SortDir>("desc");
   const [extras, setExtras] = useState<Record<string, TickerExtra>>({});
   const { spy, getTickerRS } = useSpyBenchmark();

  useEffect(() => {
    if (!theme || !open) return;
    const symbols = theme.tickers.map(t => t.symbol);
    if (symbols.length === 0) return;

    (async () => {
      // Fetch ticker_performance, eod sparklines, and volume cache in parallel
      const [perfResult, eodResult, volResult] = await Promise.all([
        supabase
          .from("ticker_performance")
          .select("symbol, perf_1w, perf_1m, price")
          .in("symbol", symbols),
        supabase
          .from("eod_prices")
          .select("symbol, date, close_price")
          .in("symbol", symbols)
          .gte("date", new Date(Date.now() - 10 * 86400000).toISOString().split("T")[0])
          .order("date", { ascending: true }),
        supabase
          .from("ticker_volume_cache")
          .select("symbol, today_vol, avg_20d, avg_10d, avg_3m")
          .in("symbol", symbols),
      ]);

      const map: Record<string, TickerExtra> = {};
      for (const s of symbols) {
        map[s] = { perf_1w: null, perf_1m: null, volume: null, price: null, sparkline: [], relVol: null, sustainedVol: null, volSpikePct: null };
      }

      if (perfResult.data) {
        for (const p of perfResult.data) {
          if (map[p.symbol]) {
            map[p.symbol].perf_1w = p.perf_1w;
            map[p.symbol].perf_1m = p.perf_1m;
            map[p.symbol].price = p.price;
          }
        }
      }

      if (eodResult.data) {
        const bySymbol = new Map<string, number[]>();
        for (const row of eodResult.data) {
          const arr = bySymbol.get(row.symbol) || [];
          arr.push(row.close_price);
          bySymbol.set(row.symbol, arr);
        }
        for (const [sym, prices] of bySymbol) {
          if (map[sym]) map[sym].sparkline = prices;
        }
      }

      // Volume data
      if (volResult.data) {
        for (const v of volResult.data) {
          if (!map[v.symbol]) continue;
          const todayVol = v.today_vol || 0;
          const avg20d = v.avg_20d || 0;
          const avg10d = v.avg_10d || 0;
          const avg3m = v.avg_3m || 0;

          map[v.symbol].volume = todayVol;

          if (avg20d > 0 && todayVol > 0) {
            map[v.symbol].relVol = Math.round((todayVol / avg20d) * 100) / 100;
            const spikePct = ((todayVol - avg20d) / avg20d) * 100;
            if (Math.abs(spikePct) > 30) {
              map[v.symbol].volSpikePct = Math.round(spikePct);
            }
          }
          if (avg3m > 0 && avg10d > 0) {
            map[v.symbol].sustainedVol = Math.round(((avg10d / avg3m) - 1) * 100);
          }
        }
      }

      setExtras(map);
    })();
  }, [theme, open]);

  const validTickers = useMemo(() => {
    if (!theme) return [];
    return theme.tickers.filter(t => !t.skipped);
  }, [theme]);

  const sorted = useMemo(() => {
    const items = [...(theme?.tickers || [])];
    items.sort((a, b) => {
      let av: number, bv: number;
      switch (sortKey) {
        case "symbol":
          return sortDir === "asc" ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol);
        case "pct":
          av = a.skipped ? -999 : a.pct;
          bv = b.skipped ? -999 : b.pct;
          break;
        case "perf_1w":
          av = extras[a.symbol]?.perf_1w ?? -999;
          bv = extras[b.symbol]?.perf_1w ?? -999;
          break;
        case "perf_1m":
          av = extras[a.symbol]?.perf_1m ?? -999;
          bv = extras[b.symbol]?.perf_1m ?? -999;
          break;
        case "volume":
          av = extras[a.symbol]?.volume ?? -999;
          bv = extras[b.symbol]?.volume ?? -999;
          break;
        case "relVol":
          av = extras[a.symbol]?.relVol ?? -999;
          bv = extras[b.symbol]?.relVol ?? -999;
          break;
        case "sustainedVol":
          av = extras[a.symbol]?.sustainedVol ?? -999;
          bv = extras[b.symbol]?.sustainedVol ?? -999;
          break;
        default:
          av = a.pct; bv = b.pct;
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return items;
  }, [theme, sortKey, sortDir, extras]);

  if (!theme) return null;

  const up = validTickers.filter(t => t.pct > 0).length;
  const down = validTickers.filter(t => t.pct <= 0).length;
  const total = validTickers.length;
  const ratio = total > 0 ? up / total : 0;
  const sign = theme.performance_pct >= 0 ? "+" : "";
  const pinned = isPinned(theme.theme_name);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const pctColor = (v: number | null | undefined) => {
    if (v === null || v === undefined) return "text-muted-foreground";
    return v >= 0 ? "text-gain-medium" : "text-loss-mild";
  };

  const handleViewWatchlist = () => {
    if (!pinned) togglePin(theme.theme_name);
    onOpenChange(false);
    navigate("/watchlist");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[850px] border-none p-0 overflow-hidden"
        style={{
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-foreground" style={{ fontFamily: "'Syne', sans-serif" }}>
                  {theme.theme_name}
                </h2>
                <button
                  onClick={() => togglePin(theme.theme_name)}
                  className={`rounded p-1 transition-all ${
                    pinned ? "text-[hsl(var(--primary))]" : "text-muted-foreground hover:text-foreground"
                  }`}
                  title={pinned ? "Unpin" : "Pin to watchlist"}
                >
                  <Pin size={14} className={pinned ? "fill-current" : ""} />
                </button>
              </div>
              {theme.notes && (
                <p className="mt-1 text-xs text-muted-foreground italic">{theme.notes}</p>
              )}
            </div>
            <span
              className={`shrink-0 font-mono text-3xl font-bold leading-none tracking-tight ${
                theme.performance_pct >= 0 ? "text-gain-medium" : "text-loss-mild"
              }`}
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              {sign}{theme.performance_pct.toFixed(2)}%
            </span>
          </div>

          <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-bar-track">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.round(ratio * 100)}%`,
                background: ratio >= 0.5 ? "hsl(var(--bar-green))" : "hsl(var(--bar-red))",
              }}
            />
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-xs font-medium">
            <span className="text-gain-medium">{up} up ↑</span>
            <span className="text-loss-mild">{down} down ↓</span>
            <span className="ml-auto text-muted-foreground">{Math.round(ratio * 100)}% advancing</span>
          </div>
        </div>

        {/* Ticker table */}
        <div className="max-h-[400px] overflow-auto px-6 pb-2">
          {/* SPY Benchmark row */}
          {spy.perf_1d !== null && (
            <div className="mb-2">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1 px-2">── Benchmark ──</div>
              <div className="flex items-center gap-3 rounded-md px-2 py-1.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <span className="font-bold text-foreground text-xs" style={{ fontFamily: "'DM Mono', monospace" }}>SPY</span>
                <span className="text-[10px] text-muted-foreground">S&P 500 ETF</span>
                <span className={`text-xs font-semibold ml-auto ${spy.perf_1d >= 0 ? "text-gain-medium" : "text-loss-mild"}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                  {spy.perf_1d >= 0 ? "+" : ""}{spy.perf_1d.toFixed(2)}%
                </span>
              </div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mt-2 mb-1 px-2">── Theme Tickers ──</div>
            </div>
          )}
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10" style={{ background: "rgba(15,18,25,0.95)" }}>
              <tr className="border-b border-border">
                {([
                  ["symbol", "Symbol"],
                  ["pct", "1D %"],
                  ["perf_1w", "1W %"],
                  ["perf_1m", "1M %"],
                  ["relVol", "Rel Vol"],
                  ["sustainedVol", "Sust Vol"],
                  ["volume", "Spike"],
                ] as [SortKey, string][]).map(([key, label]) => (
                  <th
                    key={key}
                    onClick={() => toggleSort(key)}
                    className="cursor-pointer select-none px-2 py-2 text-left font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span className="inline-flex items-center gap-1">
                      {label}
                      {sortKey === key && <ArrowUpDown size={10} className="text-primary" />}
                    </span>
                  </th>
                ))}
                <th className="px-2 py-2 text-left font-medium text-muted-foreground">vs SPY</th>
                <th className="px-2 py-2 text-left font-medium text-muted-foreground">7D</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(ticker => {
                const extra = extras[ticker.symbol];
                const tickerRS = ticker.skipped ? null : getTickerRS(ticker.pct);
                const rsF = formatRS(tickerRS);
                const sparkUp = extra?.sparkline.length
                  ? extra.sparkline[extra.sparkline.length - 1] >= extra.sparkline[0]
                  : true;

                return (
                  <tr key={ticker.symbol} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                    <td className="px-2 py-2">
                      <a
                        href={`https://www.tradingview.com/symbols/${ticker.symbol}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-bold text-foreground hover:text-primary transition-colors"
                        style={{ fontFamily: "'DM Mono', monospace" }}
                        onClick={e => e.stopPropagation()}
                      >
                        {ticker.symbol}
                        <ExternalLink size={9} className="text-muted-foreground" />
                      </a>
                    </td>
                    <td className="px-2 py-2">
                      {ticker.skipped ? (
                        <span className="text-muted-foreground">N/A</span>
                      ) : (
                        <span
                          className={`font-mono font-semibold ${pctColor(ticker.pct)}`}
                          style={{ fontFamily: "'DM Mono', monospace" }}
                        >
                          {ticker.pct >= 0 ? "+" : ""}{ticker.pct.toFixed(2)}%
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={`font-mono ${pctColor(extra?.perf_1w)}`}
                        style={{ fontFamily: "'DM Mono', monospace" }}
                      >
                        {extra?.perf_1w != null ? `${extra.perf_1w >= 0 ? "+" : ""}${extra.perf_1w.toFixed(2)}%` : "—"}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={`font-mono ${pctColor(extra?.perf_1m)}`}
                        style={{ fontFamily: "'DM Mono', monospace" }}
                      >
                        {extra?.perf_1m != null ? `${extra.perf_1m >= 0 ? "+" : ""}${extra.perf_1m.toFixed(2)}%` : "—"}
                      </span>
                    </td>
                    {/* Rel Vol */}
                    <td className="px-2 py-2">
                      <span
                        className={`font-mono ${extra?.relVol != null ? getRelVolColor(extra.relVol) : "text-muted-foreground"}`}
                        style={{ fontFamily: "'DM Mono', monospace" }}
                      >
                        {extra?.relVol != null ? `${extra.relVol.toFixed(1)}×` : "—"}
                      </span>
                    </td>
                    {/* Sustained Vol */}
                    <td className="px-2 py-2">
                      <span
                        className={`font-mono ${extra?.sustainedVol != null ? getSustainedColor(extra.sustainedVol) : "text-muted-foreground"}`}
                        style={{ fontFamily: "'DM Mono', monospace" }}
                      >
                        {extra?.sustainedVol != null ? `${extra.sustainedVol >= 0 ? "+" : ""}${extra.sustainedVol}%` : "—"}
                      </span>
                    </td>
                    {/* Vol Spike */}
                    <td className="px-2 py-2">
                      {extra?.volSpikePct != null ? (
                        <span
                          className={`font-mono font-medium ${extra.volSpikePct > 0 ? "text-gain-medium" : "text-loss-mild"}`}
                          style={{ fontFamily: "'DM Mono', monospace" }}
                        >
                          {extra.volSpikePct > 0 ? "↑" : "↓"} {extra.volSpikePct > 0 ? "+" : ""}{extra.volSpikePct}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground" style={{ fontFamily: "'DM Mono', monospace" }}>—</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <span className={`font-mono text-[10px] ${rsF.color}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                        {tickerRS !== null ? `${tickerRS >= 0 ? "+" : ""}${tickerRS.toFixed(2)}%` : "—"}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <MiniSparkline data={extra?.sparkline || []} up={sparkUp} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border/50 px-6 py-3">
          <span className="text-[10px] text-muted-foreground">
            {theme.lastUpdated
              ? `Last updated: ${new Date(theme.lastUpdated).toLocaleTimeString()}`
              : "Demo data"}
          </span>
          <button
            onClick={handleViewWatchlist}
            className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
          >
            {pinned ? "View in Watchlist" : "Pin & View Watchlist"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
