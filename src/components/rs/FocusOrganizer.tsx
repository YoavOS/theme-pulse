import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, FileText, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Textarea } from "@/components/ui/textarea";
import type { RsStock } from "@/hooks/useRsAlpha";
import type { StockFundamentals } from "@/hooks/useStockFundamentalsMap";
import type { StockStage } from "@/lib/stageAnalysis";
import type { StockBase } from "@/lib/bases";
import { LABEL_NAMES } from "@/lib/bases";
import { groupKeyForIndustry } from "@/lib/groupColors";
import { computeRsRatings } from "@/components/rs/RsRatingBadge";
import { passesGrowth, passesHighGrowth, passesONeil } from "@/lib/growthFilters";
import { toneBox } from "@/lib/moveTint";
import {
  MARKET, STATUS_INFO, buildBlocks, classify, quality, readEma, tvText,
  type Bar, type Block, type BaseRead, type EmaRead, type Row, type Status,
} from "@/lib/focusList";
import GroupStageTag from "@/components/shared/GroupStageTag";

/**
 * Organize my focus list: paste the TradingView watchlist → SPY / QQQ / IWM on top, then every stock
 * sorted into its setup (21 EMA pullback / breakout / none) and status, grouped in industry blocks with
 * the strongest peers right after your names, ordered by what's closest to triggering.
 */

const LIST_KEY = "focus_list_v1";
const OPTS_KEY = "focus_opts_v1";
const OVR_KEY = "focus_overrides_v1";

interface Opts { minRun: number; peers: number; sectionPerIndustry: boolean; includeNone: boolean }
const DEFAULT_OPTS: Opts = { minRun: 40, peers: 2, sectionPerIndustry: true, includeNone: false };

const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const loadStr = (k: string) => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } };

function parse(raw: string): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const tok of raw.split(/[\s,;|]+/)) {
    if (tok.startsWith("###")) continue;
    let t = tok.trim().toUpperCase();
    const c = t.indexOf(":"); if (c >= 0) t = t.slice(c + 1);
    t = t.replace(/[^A-Z0-9.-]/g, "");
    if (!t || seen.has(t)) continue;
    seen.add(t); out.push(t);
  }
  return out;
}

const growthOf = (f?: StockFundamentals) => (!f ? 0 : passesHighGrowth(f) ? 3 : passesGrowth(f) ? 2 : passesONeil(f) ? 1 : 0);
const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);

export default function FocusOrganizer({ universe, fundamentalsMap, superperfSets, stageMap, baseMap }: {
  universe: RsStock[];
  fundamentalsMap?: Map<string, StockFundamentals>;
  superperfSets?: Partial<Record<string, Set<string>>>;
  stageMap: Map<string, StockStage>;
  baseMap: Map<string, StockBase>;
}) {
  const [raw, setRaw] = useState(() => loadStr(LIST_KEY));
  const [opts, setOpts] = useState<Opts>(() => load(OPTS_KEY, DEFAULT_OPTS));
  const [overrides, setOverrides] = useState<Record<string, Status>>(() => load(OVR_KEY, {} as Record<string, Status>));
  const [emaMap, setEmaMap] = useState<Map<string, EmaRead | null> | null>(null);
  const [loading, setLoading] = useState(false);
  const [listSyms, setListSyms] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const readFile = async (f?: File | null) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast.error("File is too large (max 5 MB)."); return; }
    try {
      const t = await f.text();
      const n = parse(t).length;
      if (!n) { toast.error("No tickers found in that file."); return; }
      setRaw(t); setFileName(f.name);
      toast.success(`Loaded ${n} tickers`, { description: `${f.name} — press Organize` });
    } catch (e) {
      toast.error("Could not read the file.", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  useEffect(() => { save(OPTS_KEY, opts); }, [opts]);
  useEffect(() => { save(OVR_KEY, overrides); }, [overrides]);

  const uni = useMemo(() => new Map(universe.map((s) => [s.symbol.toUpperCase(), s])), [universe]);
  const rating = useMemo(() => {
    const r = computeRsRatings(universe.map((s) => s.rsOverall));
    return new Map(universe.map((s, i) => [s.symbol.toUpperCase(), r[i]]));
  }, [universe]);
  const industryOf = (sym: string) => { const s = uni.get(sym); return s?.sector ? groupKeyForIndustry(s.sector, "industry") : "Other / not in universe"; };
  const inSuperperf = (sym: string) => Object.values(superperfSets ?? {}).some((set) => set?.has(sym));
  const baseRead = (sym: string): BaseRead | null => {
    const b = baseMap.get(sym);
    return b ? { state: b.state, label: b.primary_label ? LABEL_NAMES[b.primary_label] : null, distToPivot: b.dist_to_pivot, pivot: b.pivot, score: b.score } : null;
  };

  // Industry health from the whole universe: up today, Stage 2 share, average RS rating
  const health = useMemo(() => {
    const m = new Map<string, { n: number; up: number; s2: number; staged: number; rs: number; rsN: number }>();
    for (const s of universe) {
      if (!s.sector) continue;
      const k = groupKeyForIndustry(s.sector, "industry");
      const h = m.get(k) ?? { n: 0, up: 0, s2: 0, staged: 0, rs: 0, rsN: 0 };
      h.n++;
      if ((s.return1d ?? 0) > 0) h.up++;
      const st = stageMap.get(s.symbol.toUpperCase());
      if (st && st.stage >= 1) { h.staged++; if (st.stage === 2) h.s2++; }
      const r = rating.get(s.symbol.toUpperCase());
      if (r !== null && r !== undefined) { h.rs += r; h.rsN++; }
      m.set(k, h);
    }
    return m;
  }, [universe, stageMap, rating]);

  const organize = async () => {
    const syms = parse(raw).filter((s) => !(MARKET as readonly string[]).includes(s));
    if (!syms.length) { toast.error("Paste a list of tickers first."); return; }
    save(LIST_KEY, raw);
    setLoading(true);
    try {
      // Make sure each stock has fresh daily bars in the shared cache (no-op when already cached today) …
      await supabase.functions.invoke("clean-21-ema-scan", { body: { symbols: syms, minGainPct: 0, minPeriod: 5 } }).catch(() => null);
      // … then read them and work out the 21 EMA cycle here
      const rank: Record<string, number> = { "1y": 0, "2y": 1, "6mo": 2, "5y": 3 };
      const best = new Map<string, { r: number; ohlc: Bar[] }>();
      for (let i = 0; i < syms.length; i += 100) {
        const { data } = await supabase.from("yahoo_history_cache").select("symbol, period, ohlc").in("symbol", syms.slice(i, i + 100)).in("period", ["1y", "2y", "6mo", "5y"]);
        for (const row of (data ?? []) as { symbol: string; period: string; ohlc: unknown }[]) {
          if (!Array.isArray(row.ohlc)) continue;
          const k = row.symbol.toUpperCase(), r = rank[row.period] ?? 9;
          if (!best.has(k) || r < best.get(k)!.r) best.set(k, { r, ohlc: row.ohlc as Bar[] });
        }
      }
      setEmaMap(new Map(syms.map((s) => [s, best.has(s) ? readEma(best.get(s)!.ohlc) : null])));
      setListSyms(syms);
    } catch (e) {
      toast.error(`Couldn't load price history: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const blocks: Block[] = useMemo(() => {
    if (!emaMap) return [];
    const own: Row[] = listSyms.map((sym) => {
      const st = stageMap.get(sym)?.stage ?? null;
      let cls = classify(emaMap.get(sym) ?? null, baseRead(sym), st, opts.minRun);
      const o = overrides[sym];
      if (o && o !== cls.status) cls = { ...cls, status: o, setup: STATUS_INFO[o].setup, reason: `set by you · ${cls.reason}`, readiness: cls.readiness === 99 ? 5 : cls.readiness };
      return {
        symbol: sym, industry: industryOf(sym), peer: false, cls, ema: emaMap.get(sym) ?? null,
        rsRating: rating.get(sym) ?? null, ret1d: uni.get(sym)?.return1d ?? null,
        quality: quality({ rsRating: rating.get(sym) ?? null, superperf: inSuperperf(sym), growth: growthOf(fundamentalsMap?.get(sym)), stage: st, baseScore: baseMap.get(sym)?.score ?? null }),
      };
    });
    const out = buildBlocks(own);
    // Peers: the strongest names of the same industry from the universe, right after your stocks
    if (opts.peers > 0) {
      const taken = new Set(listSyms);
      for (const b of out) {
        if (b.industry.startsWith("Other")) continue;
        const cands = universe
          .filter((s) => !taken.has(s.symbol.toUpperCase()) && s.sector && groupKeyForIndustry(s.sector, "industry") === b.industry)
          .map((s) => ({ s, r: rating.get(s.symbol.toUpperCase()) ?? 0, st: stageMap.get(s.symbol.toUpperCase())?.stage ?? null }))
          .filter((x) => x.r >= 70 && x.st !== 4)
          .sort((a, c) => Number(c.st === 2) - Number(a.st === 2) || c.r - a.r)
          .slice(0, opts.peers);
        for (const { s, r, st } of cands) {
          const sym = s.symbol.toUpperCase();
          taken.add(sym);
          b.rows.push({
            symbol: sym, industry: b.industry, peer: true, ema: null, rsRating: r, ret1d: s.return1d ?? null, quality: 0,
            cls: { status: b.status, setup: STATUS_INFO[b.status].setup, reason: `peer · RS ${r}${st ? ` · Stage ${st}` : ""}`, also: null, readiness: 50 },
          });
        }
      }
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emaMap, listSyms, opts.minRun, opts.peers, overrides, stageMap, baseMap, rating, universe, fundamentalsMap, superperfSets]);

  const text = useMemo(() => (blocks.length ? tvText(blocks, opts) : ""), [blocks, opts]);
  const asOf = useMemo(() => { const d = [...(emaMap?.values() ?? [])].map((e) => e?.asOf).filter(Boolean).sort(); return d[d.length - 1] ?? null; }, [emaMap]);
  const missing = listSyms.filter((s) => !emaMap?.get(s)).length;

  const download = () => {
    const blob = new Blob([text + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `focus-list-${new Date().toISOString().slice(0, 10)}.txt`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Downloaded — import it in TradingView (Watchlist → Import list).");
  };

  let lastStatus: Status | null = null;
  return (
    <div className="space-y-3">
      <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); readFile(e.dataTransfer.files?.[0]); }}
        className={`space-y-1.5 rounded-lg ${dragging ? "outline outline-2 outline-dashed outline-primary/60" : ""}`}>
        <div className="flex items-center gap-2 text-[12px]">
          <button type="button" onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-medium hover:border-primary/50 hover:text-primary">
            <FileText size={12} /> Upload file
          </button>
          <input ref={fileRef} type="file" accept=".txt,.csv,text/plain,text/csv" className="hidden"
            onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ""; }} />
          <span className="text-muted-foreground">{fileName ? `Loaded ${fileName}` : "the .txt TradingView exports (Watchlist → ⋯ → Export list), or drop it here — or paste below"}</span>
        </div>
        <Textarea value={raw} onChange={(e) => { setRaw(e.target.value); setFileName(null); }} rows={4} className="font-mono text-xs"
          placeholder="Paste your TradingView focus list (sections and NYSE: / NASDAQ: prefixes are fine). SPY, QQQ and IWM always go on top." />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
        <label className="flex items-center gap-1.5 text-muted-foreground" title="A stock counts as a 21 EMA pullback candidate once it has run this much since its last touch of the daily 21 EMA">
          Pullback candidate after
          <input type="number" min={10} max={300} step={5} value={opts.minRun} onChange={(e) => setOpts({ ...opts, minRun: Number(e.target.value) || 40 })}
            className="h-7 w-14 rounded-md border border-border bg-background px-1.5 text-right text-foreground" />% run
        </label>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          Peers per industry
          <select value={opts.peers} onChange={(e) => setOpts({ ...opts, peers: Number(e.target.value) })} className="h-7 rounded-md border border-border bg-background px-1.5 text-foreground">
            {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          <input type="checkbox" checked={opts.sectionPerIndustry} onChange={(e) => setOpts({ ...opts, sectionPerIndustry: e.target.checked })} /> A TradingView section per industry
        </label>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          <input type="checkbox" checked={opts.includeNone} onChange={(e) => setOpts({ ...opts, includeNone: e.target.checked })} /> Keep "no setup" stocks in the export
        </label>
        <button onClick={organize} disabled={loading}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground disabled:opacity-60">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Organize
        </button>
      </div>

      {blocks.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[11.5px] text-muted-foreground">
            <span>{listSyms.length} stocks{asOf ? ` · daily data to ${asOf}` : ""}{missing ? ` · ${missing} without price history` : ""}</span>
            <span className="ml-auto inline-flex gap-1.5">
              <button onClick={() => { navigator.clipboard.writeText(text); toast.success("Copied the organized list."); }} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:text-foreground"><Copy size={11} /> Copy</button>
              <button onClick={download} className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 font-medium text-primary hover:bg-primary/20"><Download size={11} /> TradingView .txt</button>
            </span>
          </div>

          <div className="flex items-center gap-2 text-[12px]">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Market</span>
            {MARKET.map((m) => <span key={m} className="rounded-md border border-border px-2 py-0.5 font-mono font-semibold">{m}</span>)}
          </div>

          <div className="space-y-2.5">
            {blocks.map((b) => {
              const head = b.status !== lastStatus;
              lastStatus = b.status;
              const info = STATUS_INFO[b.status];
              const own = b.rows.filter((r) => !r.peer).length;
              const h = health.get(b.industry);
              const tone = b.status === "none" ? "neutral" : info.order <= 2 ? "good" : "neutral";
              return (
                <div key={`${b.status}|${b.industry}`} className="space-y-1.5">
                  {head && (
                    <div className="flex items-baseline gap-2 pt-1.5" title={info.tip}>
                      <span className="text-[13px] font-bold">{info.setup === "pullback" ? "21 EMA pullback" : info.setup === "breakout" ? "Breakout" : ""}{info.setup !== "none" ? " · " : ""}{info.label}</span>
                      <span className="text-[11px] text-muted-foreground">{info.tip}</span>
                    </div>
                  )}
                  <div className="rounded-xl border border-border/70 bg-card/50 p-2.5" style={toneBox(tone, info.order === 0 ? 0.55 : 0.3)}>
                    <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-[12px]">
                      <span className="font-semibold">{b.industry}<GroupStageTag name={b.industry} mode="industry" /></span>
                      <span className="text-muted-foreground">{own} yours{b.rows.length > own ? ` + ${b.rows.length - own} peer${b.rows.length - own > 1 ? "s" : ""}` : ""}</span>
                      {h && h.n >= 3 && (
                        <span className="text-[11px]" style={{ color: h.up / h.n >= 0.6 ? "hsl(var(--up))" : h.up / h.n <= 0.4 ? "hsl(var(--down))" : "hsl(var(--warn))" }}
                          title="Whole industry in your universe: stocks up today · share in Stage 2 · average RS rating">
                          industry: {h.up}/{h.n} up today{h.staged ? ` · ${Math.round((h.s2 / h.staged) * 100)}% Stage 2` : ""}{h.rsN ? ` · avg RS ${Math.round(h.rs / h.rsN)}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="divide-y divide-border/30">
                      {b.rows.map((r) => (
                        <div key={r.symbol} className={`grid grid-cols-[70px_1fr_auto] items-center gap-x-3 py-1 text-[12px] sm:grid-cols-[70px_1fr_52px_52px_150px] ${r.peer ? "opacity-70" : ""}`}>
                          <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(r.symbol)}`} target="_blank" rel="noopener noreferrer"
                            className="font-mono font-bold hover:text-primary hover:underline">{r.symbol}</a>
                          <span className="min-w-0 text-[11.5px] text-muted-foreground">
                            {r.peer && <span className="mr-1 rounded bg-muted px-1 text-[10px] uppercase tracking-wide">peer</span>}
                            {r.cls.reason}{r.cls.also ? <span className="text-foreground/70"> · {r.cls.also}</span> : null}
                          </span>
                          <span className="hidden text-right font-mono sm:block" title="RS rating (1–99) in the universe">{r.rsRating ?? "—"}</span>
                          <span className={`hidden text-right font-mono sm:block ${(r.ret1d ?? 0) > 0 ? "text-up" : (r.ret1d ?? 0) < 0 ? "text-down" : "text-muted-foreground"}`} title="Today's move">{pct(r.ret1d)}</span>
                          {r.peer ? <span className="hidden sm:block" /> : (
                            <select value={overrides[r.symbol] ?? ""} title="Put this stock in a different group (remembered)"
                              onChange={(e) => setOverrides((o) => { const n = { ...o }; if (e.target.value) n[r.symbol] = e.target.value as Status; else delete n[r.symbol]; return n; })}
                              className="h-6 rounded border border-border bg-background px-1 text-[11px] text-muted-foreground">
                              <option value="">auto</option>
                              {(Object.keys(STATUS_INFO) as Status[]).map((s) => <option key={s} value={s}>{STATUS_INFO[s].label}</option>)}
                            </select>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Order inside each group: closest to the trigger first (in ADRs), then quality (RS rating, superperformance, growth, Stage 2). Peers are the strongest stocks of the same industry in your universe (RS 70+, not Stage 4), placed right after your names so the whole group is in view when an alert fires.
          </p>
        </>
      )}
    </div>
  );
}
