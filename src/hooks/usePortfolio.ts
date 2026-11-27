import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  alertsFor, buildHoldings, closedStats, closedTrades, marketOpen, nextEarnings, pastReports, sortAlerts, summarize, technicals,
  type Bars, type Context, type EarnRow, type NewsItem, type PositionRow, type Quote,
} from "@/lib/portfolio/engine";

// The generated database types predate the portfolio tables; keep the client untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface PortfolioSettings { accountSize: number | null; warnSessions: number; groupBy: "industry" | "theme" }
const DEFAULTS: PortfolioSettings = { accountSize: null, warnSessions: 5, groupBy: "industry" };
export type NewPosition = Pick<PositionRow, "symbol" | "entry_date" | "entry_price" | "shares" | "initial_stop" | "target" | "setup" | "notes">;

interface Live { quotes: Record<string, Quote | null>; earnings: Record<string, { rows?: EarnRow[]; fetchedAt?: string; note?: string } | null>; news: Record<string, { items?: NewsItem[]; note?: string } | null>; finnhub?: boolean }

/** Everything the Portfolio tab shows. Quotes refresh every minute while the market is open. */
export function usePortfolio() {
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [settings, setSettingsState] = useState<PortfolioSettings>(DEFAULTS);
  const [ctx, setCtx] = useState<Record<string, Context | null>>({});
  const [bars, setBars] = useState<Record<string, Bars | null>>({});
  const [live, setLive] = useState<Live>({ quotes: {}, earnings: {}, news: {} });
  const [loading, setLoading] = useState(true);
  const [liveLoading, setLiveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const loadRows = useCallback(async () => {
    const { data, error } = await db.from("trade_positions").select("*").order("entry_date", { ascending: false });
    if (error) { setError(error.message); return [] as PositionRow[]; }
    const r = ((data ?? []) as PositionRow[]).map((x) => ({ ...x, symbol: x.symbol.toUpperCase(), entry_price: Number(x.entry_price), shares: Number(x.shares),
      initial_stop: x.initial_stop == null ? null : Number(x.initial_stop), stop: x.stop == null ? null : Number(x.stop), target: x.target == null ? null : Number(x.target),
      exit_price: x.exit_price == null ? null : Number(x.exit_price) }));
    setRows(r); setError(null);
    return r;
  }, []);

  const loadSettings = useCallback(async () => {
    const { data } = await db.from("portfolio_settings").select("key, value");
    const s = { ...DEFAULTS };
    for (const r of data ?? []) if (r.key in s) (s as Record<string, unknown>)[r.key] = r.value;
    setSettingsState(s);
  }, []);

  const openSymbols = useMemo(() => [...new Set(rows.filter((r) => r.status === "open").map((r) => r.symbol))].sort(), [rows]);
  const allSymbols = useMemo(() => [...new Set(rows.map((r) => r.symbol))].sort(), [rows]);
  const symKey = openSymbols.join(",");

  const loadMarket = useCallback(async (open: string[], all: string[]) => {
    if (!all.length) { setCtx({}); setBars({}); return; }
    const [c, b] = await Promise.all([
      db.rpc("portfolio_context", { syms: open }),
      db.rpc("portfolio_bars", { syms: [...new Set([...all, "SPY"])], n: 300 }),
    ]);
    const cm: Record<string, Context | null> = {};
    for (const r of (c.data ?? []) as Context[]) cm[r.symbol] = r;
    setCtx(cm);
    const bm: Record<string, Bars | null> = {};
    for (const r of (b.data ?? []) as Array<{ symbol: string; d: string[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] }>) bm[r.symbol] = { d: r.d, o: r.o.map(Number), h: r.h.map(Number), l: r.l.map(Number), c: r.c.map(Number), v: r.v.map(Number) };
    setBars(bm);
    if (c.error || b.error) setError("Restart the app once so the database picks up the Portfolio update (Stop / Start Theme Pulse).");
  }, []);

  const loadLive = useCallback(async (symbols: string[], parts?: string[], force = false) => {
    if (!symbols.length) return;
    setLiveLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("portfolio-live", { body: { symbols, parts, force } });
      if (error) throw error;
      const d = data as Live;
      setLive((prev) => ({
        quotes: { ...prev.quotes, ...(d.quotes ?? {}) }, earnings: { ...prev.earnings, ...(d.earnings ?? {}) }, news: { ...prev.news, ...(d.news ?? {}) }, finnhub: d.finnhub ?? prev.finnhub,
      }));
      setUpdatedAt(new Date());
    } catch {
      toast.error("Live prices, earnings and news could not be loaded — showing the last daily close.");
    } finally { setLiveLoading(false); }
  }, []);

  // first load
  useEffect(() => { (async () => { setLoading(true); await loadSettings(); await loadRows(); setLoading(false); })(); }, [loadRows, loadSettings]);
  useEffect(() => { void loadMarket(openSymbols, allSymbols); }, [symKey, allSymbols.join(","), loadMarket]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadLive(openSymbols); }, [symKey, loadLive]); // eslint-disable-line react-hooks/exhaustive-deps
  // quotes every minute during the session
  const openRef = useRef(openSymbols); openRef.current = openSymbols;
  useEffect(() => {
    const t = window.setInterval(() => { if (marketOpen() && document.visibilityState === "visible") void loadLive(openRef.current, ["quotes"]); }, 60_000);
    return () => window.clearInterval(t);
  }, [loadLive]);

  // ── derived ──
  const quotes = live.quotes;
  const holdings = useMemo(() => buildHoldings(rows, quotes, bars), [rows, quotes, bars]);
  const tech = useMemo(() => Object.fromEntries(holdings.map((h) => [h.symbol, technicals(bars[h.symbol] ?? null, bars.SPY ?? null, h.price)])), [holdings, bars]);
  const plans = useMemo(() => Object.fromEntries(holdings.map((h) => [h.symbol, nextEarnings(live.earnings[h.symbol]?.rows)])), [holdings, live.earnings]);
  const reports = useMemo(() => Object.fromEntries(holdings.map((h) => [h.symbol, pastReports(live.earnings[h.symbol]?.rows, bars[h.symbol] ?? null)])), [holdings, live.earnings, bars]);
  const news = useMemo(() => Object.fromEntries(holdings.map((h) => [h.symbol, live.news[h.symbol]?.items ?? []])), [holdings, live.news]);
  const alerts = useMemo(() => sortAlerts(holdings.flatMap((h) => alertsFor(h, tech[h.symbol], plans[h.symbol], news[h.symbol], settings.warnSessions))), [holdings, tech, plans, news, settings.warnSessions]);
  const summary = useMemo(() => summarize(holdings, ctx, plans, settings.accountSize, settings.warnSessions, settings.groupBy), [holdings, ctx, plans, settings]);
  const closed = useMemo(() => closedTrades(rows), [rows]);
  const closedSummary = useMemo(() => closedStats(closed), [closed]);

  // ── actions ──
  const fetchHistory = useCallback(async (symbol: string) => {
    // download daily bars for a symbol the PC doesn't have yet (5 years), then reload
    if (bars[symbol]) return;
    await supabase.functions.invoke("daily-bars", { body: { symbols: [symbol] } }).catch(() => null);
  }, [bars]);

  const add = useCallback(async (p: NewPosition) => {
    const { error } = await db.from("trade_positions").insert({ ...p, symbol: p.symbol.toUpperCase(), stop: p.initial_stop, status: "open" });
    if (error) { toast.error(error.message); return false; }
    toast.success(`${p.symbol.toUpperCase()} added`);
    const r = await loadRows();
    void fetchHistory(p.symbol.toUpperCase()).then(() => loadMarket([...new Set(r.filter((x) => x.status === "open").map((x) => x.symbol))], [...new Set(r.map((x) => x.symbol))]));
    return true;
  }, [loadRows, fetchHistory, loadMarket]);

  const update = useCallback(async (id: string, patch: Partial<PositionRow>) => {
    const { error } = await db.from("trade_positions").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast.error(error.message); return false; }
    await loadRows(); return true;
  }, [loadRows]);

  /** Sell some or all shares of one lot: a partial sale becomes its own closed row. */
  const sell = useCallback(async (row: PositionRow, shares: number, price: number, date: string, note: string | null) => {
    if (shares >= Number(row.shares) - 1e-9) return update(row.id, { status: "closed", exit_price: price, exit_date: date, exit_note: note });
    const rest = Number(row.shares) - shares;
    const { id: _id, ...copy } = row; // eslint-disable-line @typescript-eslint/no-unused-vars
    const { error } = await db.from("trade_positions").insert({ ...copy, shares, status: "closed", exit_price: price, exit_date: date, exit_note: note });
    if (error) { toast.error(error.message); return false; }
    return update(row.id, { shares: rest });
  }, [update]);

  const remove = useCallback(async (id: string) => {
    const { error } = await db.from("trade_positions").delete().eq("id", id);
    if (error) { toast.error(error.message); return false; }
    await loadRows(); return true;
  }, [loadRows]);

  /** Close every open buy of a symbol at one price — recorded in the record. */
  const closeSymbol = useCallback(async (symbol: string, price: number, date: string, note: string | null) => {
    const lots = rows.filter((r) => r.status === "open" && r.symbol === symbol);
    for (const l of lots) {
      const { error } = await db.from("trade_positions").update({ status: "closed", exit_price: price, exit_date: date, exit_note: note, updated_at: new Date().toISOString() }).eq("id", l.id);
      if (error) { toast.error(error.message); await loadRows(); return false; }
    }
    toast.success(`${symbol} closed and added to your record`);
    await loadRows(); return true;
  }, [rows, loadRows]);

  /** Delete every row of a symbol (open buys, and optionally its closed trades) — for tests and mistakes; nothing is recorded. */
  const deleteSymbol = useCallback(async (symbol: string, includeClosed = false) => {
    const ids = rows.filter((r) => r.symbol === symbol && (includeClosed || r.status === "open")).map((r) => r.id);
    if (!ids.length) return true;
    const { error } = await db.from("trade_positions").delete().in("id", ids);
    if (error) { toast.error(error.message); return false; }
    toast.success(`${symbol} deleted`);
    await loadRows(); return true;
  }, [rows, loadRows]);

  const setSettings = useCallback(async (patch: Partial<PortfolioSettings>) => {
    setSettingsState((s) => ({ ...s, ...patch }));
    const rowsUp = Object.entries(patch).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
    const { error } = await db.from("portfolio_settings").upsert(rowsUp, { onConflict: "key" });
    if (error) toast.error(error.message);
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all(openSymbols.filter((s) => !bars[s]).map((s) => fetchHistory(s)));
    await loadMarket(openSymbols, allSymbols);
    await loadLive(openSymbols, undefined, true);
  }, [openSymbols, allSymbols, bars, fetchHistory, loadMarket, loadLive]);

  return {
    loading, liveLoading, error, updatedAt, rows, holdings, ctx, bars, tech, plans, reports, news, alerts, summary, closed, closedSummary,
    settings, finnhub: live.finnhub, add, update, sell, remove, closeSymbol, deleteSymbol, setSettings, refresh,
  };
}
export type PortfolioData = ReturnType<typeof usePortfolio>;
