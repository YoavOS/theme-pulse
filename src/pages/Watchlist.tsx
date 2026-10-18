import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Download, Star } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import WatchStar from "@/components/WatchStar";
import { StageBadge, WeekSpark } from "@/components/stages/StageStockTable";
import { useStockStages } from "@/hooks/useStockStages";
import { useStockBases } from "@/hooks/useStockBases";
import { useUniverseSectors } from "@/hooks/useUniverseSectors";
import { useWatchlist } from "@/lib/watchlist";
import { STATE_NAMES } from "@/lib/bases";
import { downloadTradingViewList } from "@/lib/stageAnalysis";

/** Saved Minervini-tab result for a symbol (that tab caches each analysis for 24h in this browser). */
function cachedFundamentals(sym: string): { m: number | null; q: number | null; flags: number | null; ts: number } | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("minervini:") || !k.endsWith(`:${sym}`)) continue;
      const { ts, data } = JSON.parse(localStorage.getItem(k) ?? "{}");
      const p = data?.series?.profiles;
      if (!p) continue;
      return { m: p.momentum?.score ?? null, q: p.quality?.score ?? null, flags: Array.isArray(p.redFlags) ? p.redFlags.length : null, ts };
    }
  } catch { /* ignore */ }
  return null;
}

export default function Watchlist() {
  const { items, setNote, clear } = useWatchlist();
  const { bySymbol: stageBy, rows: stages } = useStockStages(true);
  const { rows: bases } = useStockBases(true);
  const { rows: uni, load } = useUniverseSectors();
  useEffect(() => { load(); }, [load]);

  const baseBy = useMemo(() => new Map(bases.map((b) => [b.symbol, b])), [bases]);
  const nameBy = useMemo(() => new Map(uni.map((r) => [r.symbol.toUpperCase(), r.name ?? null])), [uni]);
  const rsBy = useMemo(() => {
    const vals = stages.filter((r) => r.symbol !== "SPY" && r.features?.mrs52 != null).map((r) => ({ s: r.symbol, v: r.features!.mrs52 as number })).sort((a, b) => a.v - b.v);
    return new Map(vals.map((x, i) => [x.s, Math.max(1, Math.min(99, Math.round(((i + 1) / vals.length) * 99)))]));
  }, [stages]);

  const syms = items.map((x) => x.symbol);
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-3">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          <Link to="/" className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><ArrowLeft size={14} /></Link>
          <Star size={16} className="text-[hsl(45,95%,58%)]" />
          <h1 className="text-sm font-semibold tracking-wide">Watchlist</h1>
          <span className="text-[11px] text-muted-foreground">{items.length} stocks · star any stock on Stages, Bases, Minervini or Model Book</span>
          <div className="ml-auto flex items-center gap-2">
            <button disabled={!syms.length}
              onClick={() => { downloadTradingViewList(syms, "Watchlist"); toast.success(`Downloaded ${syms.length} symbols.`); }}
              className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] text-primary hover:bg-primary/20 disabled:opacity-40"><Download size={11} /> TradingView</button>
            <button disabled={!syms.length} onClick={() => { if (window.confirm("Remove every stock from the watchlist?")) clear(); }}
              className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-40">Clear</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-3 px-4 py-5">
        {!items.length ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Nothing here yet. Click the <Star size={12} className="inline" /> next to any stock on the Stages, Bases, Minervini or Model Book tabs.
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-muted/20">
                <tr className="border-b border-border text-[10.5px] text-muted-foreground">
                  <th className="px-2 py-2 text-left font-medium">Stock</th>
                  <th className="px-2 py-2 text-left font-medium">40 weeks</th>
                  <th className="px-2 py-2 text-left font-medium">Stage</th>
                  <th className="px-2 py-2 text-right font-medium" title="26-week relative strength vs SPY, percentile on your list">RS</th>
                  <th className="px-2 py-2 text-right font-medium">From 52w high</th>
                  <th className="px-2 py-2 text-left font-medium">Base</th>
                  <th className="px-2 py-2 text-left font-medium">Earnings</th>
                  <th className="px-2 py-2 text-left font-medium" title="Earnings momentum / quality scores and red flags from your last Minervini-tab analysis (saved 24h)">Fundamentals</th>
                  <th className="px-2 py-2 text-left font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const st = stageBy.get(it.symbol);
                  const b = baseBy.get(it.symbol);
                  const rs = rsBy.get(it.symbol) ?? null;
                  const fund = cachedFundamentals(it.symbol);
                  const ed = b?.earnings_date ?? null;
                  const earnIn = ed ? Math.round((Date.parse(ed) - Date.now()) / 86400_000) : null;
                  const dist = b ? (b.dist_to_pivot ?? b.features.distToPivotPct) : null;
                  return (
                    <tr key={it.symbol} className="border-b border-border/40 align-middle">
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <WatchStar symbol={it.symbol} />
                          <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(it.symbol)}`} target="_blank" rel="noopener noreferrer" className="font-mono font-semibold hover:text-primary hover:underline">{it.symbol}</a>
                        </div>
                        <div className="max-w-[160px] truncate pl-5 text-[10px] text-muted-foreground">{nameBy.get(it.symbol) ?? `added ${it.added}`}</div>
                      </td>
                      <td className="px-2 py-1">{st ? <WeekSpark r={st} /> : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-2 py-1.5">{st ? <StageBadge r={st} /> : <span className="text-[11px] text-muted-foreground">not on your list</span>}</td>
                      <td className={`px-2 py-1.5 text-right font-mono ${rs !== null && rs >= 80 ? "text-gain-medium" : rs !== null && rs < 30 ? "text-loss-medium" : ""}`}>{rs ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{st?.features ? `${st.features.pctFrom52wHigh.toFixed(0)}%` : "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {b && b.state ? <>{STATE_NAMES[b.state]} · {b.score} · <span className={dist !== null && dist < 0 ? "text-gain-medium" : ""}>{dist === null ? "—" : dist < 0 ? `+${Math.abs(dist).toFixed(1)}% over pivot` : `${dist.toFixed(1)}% to pivot`}</span></> : <span className="text-muted-foreground">no base</span>}
                      </td>
                      <td className={`whitespace-nowrap px-2 py-1.5 ${earnIn !== null && earnIn >= 0 && earnIn <= 7 ? "text-[hsl(40,90%,60%)]" : ""}`}>{ed ? `${ed.slice(5)}${earnIn !== null && earnIn >= 0 ? ` · ${earnIn}d` : ""}` : "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {fund ? (
                          <Link to={`/minervini?symbol=${it.symbol}`} className="font-mono hover:underline" title="Earnings momentum · quality · red flags">
                            {fund.m ?? "—"} · {fund.q ?? "—"}{fund.flags ? <span className="text-loss-medium"> · {fund.flags}⚑</span> : ""}
                          </Link>
                        ) : <Link to={`/minervini?symbol=${it.symbol}`} className="text-primary hover:underline">Analyze →</Link>}
                      </td>
                      <td className="px-2 py-1">
                        <input defaultValue={it.note ?? ""} onBlur={(e) => setNote(it.symbol, e.target.value)} placeholder="why it's here…"
                          className="h-7 w-40 rounded border border-transparent bg-transparent px-1.5 text-[11px] hover:border-border focus:border-border focus:bg-background" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-1 text-[11px] text-muted-foreground">The watchlist is saved in this browser. Stage, base and earnings come from your latest scan; fundamentals from your last analysis of each stock on the Minervini tab.</p>
      </main>
    </div>
  );
}
