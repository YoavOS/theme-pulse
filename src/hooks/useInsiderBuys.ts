import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Open-market insider purchases (SEC Form 4, code P) over the last 90 days, from insider_trades
 * (filled nightly by the sec-filings-watch function).
 *
 * Research: opportunistic insider purchases predict higher returns (Cohen, Malloy & Pomorski 2012),
 * and buying by several insiders close together is the stronger signal. Sales are ignored here:
 * insiders sell for many reasons (taxes, diversification). Buys under a 10b5-1 plan are pre-scheduled,
 * and tiny buys (under $10k) are mostly token purchases, so neither counts toward a cluster.
 */
export interface InsiderBuy { owner: string; title: string | null; isOfficer: boolean; isDirector: boolean; date: string; value: number | null; shares: number | null; price: number | null; plan: boolean }
export interface InsiderInfo {
  buys: InsiderBuy[];            // newest first, all purchases in the window
  buyers: number;                // distinct insiders with a qualifying purchase
  value: number;                 // $ of qualifying purchases
  officer: boolean;              // an officer (CEO, CFO, …) made a qualifying purchase
  cluster: boolean;              // 2+ distinct insiders bought within 30 days of each other
  last: string;                  // latest qualifying purchase date
}

export const INSIDER_WINDOW_DAYS = 90;
export const MIN_BUY_VALUE = 10_000;
const CLUSTER_DAYS = 30;
const TTL = 10 * 60_000;

let shared: { at: number; map: Map<string, InsiderInfo> } | null = null;
let inflight: Promise<Map<string, InsiderInfo>> | null = null;

interface TradeRow { symbol: string; owner: string; owner_cik: number | null; title: string | null; is_officer: boolean; is_director: boolean; trade_date: string | null; value: number | null; shares: number | null; price: number | null; plan_10b5_1: boolean }

export function summarizeInsiderBuys(rows: TradeRow[]): Map<string, InsiderInfo> {
  const bySym = new Map<string, TradeRow[]>();
  for (const r of rows) if (r.trade_date) bySym.set(r.symbol.toUpperCase(), [...(bySym.get(r.symbol.toUpperCase()) ?? []), r]);
  const out = new Map<string, InsiderInfo>();
  for (const [sym, list] of bySym) {
    list.sort((a, b) => (b.trade_date ?? "").localeCompare(a.trade_date ?? ""));
    const qual = list.filter((r) => !r.plan_10b5_1 && (r.value === null || r.value >= MIN_BUY_VALUE));
    const who = (r: TradeRow) => (r.owner_cik ? String(r.owner_cik) : r.owner.toUpperCase());
    // Cluster: two different insiders whose purchases are within 30 days of each other.
    let cluster = false;
    const asc = [...qual].reverse();
    for (let i = 0; i < asc.length && !cluster; i++) {
      for (let j = i + 1; j < asc.length; j++) {
        const gap = (Date.parse(asc[j].trade_date!) - Date.parse(asc[i].trade_date!)) / 86_400_000;
        if (gap > CLUSTER_DAYS) break;
        if (who(asc[j]) !== who(asc[i])) { cluster = true; break; }
      }
    }
    out.set(sym, {
      buys: list.map((r) => ({ owner: r.owner, title: r.title, isOfficer: r.is_officer, isDirector: r.is_director, date: r.trade_date!, value: r.value, shares: r.shares, price: r.price, plan: r.plan_10b5_1 })),
      buyers: new Set(qual.map(who)).size,
      value: qual.reduce((a, r) => a + (r.value ?? 0), 0),
      officer: qual.some((r) => r.is_officer),
      cluster,
      last: qual[0]?.trade_date ?? list[0].trade_date!,
    });
  }
  return out;
}

async function fetchInsiderBuys(): Promise<Map<string, InsiderInfo>> {
  const since = new Date(Date.now() - INSIDER_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const rows: TradeRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("insider_trades" as never)
      .select("symbol, owner, owner_cik, title, is_officer, is_director, trade_date, value, shares, price, plan_10b5_1")
      .eq("code", "P").gte("trade_date", since).order("trade_date", { ascending: false }).range(from, from + 999);
    if (error) return new Map();   // table not created yet → no badges
    const page = (data ?? []) as unknown as TradeRow[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return summarizeInsiderBuys(rows);
}

/** Insider purchases by symbol (upper-case). One shared copy for the app, refreshed every 10 minutes. */
export function useInsiderBuys(enabled = true): Map<string, InsiderInfo> {
  const [map, setMap] = useState<Map<string, InsiderInfo>>(() => shared?.map ?? new Map());
  useEffect(() => {
    if (!enabled) return;
    if (shared && Date.now() - shared.at < TTL) { setMap(shared.map); return; }
    let alive = true;
    inflight = inflight ?? fetchInsiderBuys().then((m) => { shared = { at: Date.now(), map: m }; return m; }).finally(() => { inflight = null; });
    inflight.then((m) => { if (alive) setMap(m); }).catch(() => {});
    return () => { alive = false; };
  }, [enabled]);
  return map;
}
