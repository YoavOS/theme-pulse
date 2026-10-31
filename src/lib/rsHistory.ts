/**
 * History for the distribution windows: daily / weekly snapshots of the RS stock list
 * (table rs_history_snapshots, filled by the rs-history function), and a replay of the
 * window's filters on each snapshot so every past week gets the same breakdown as today.
 */
import { supabase } from "@/integrations/supabase/client";
import { idbGet, idbSet } from "@/lib/idbCache";
import { computeRsRatings } from "@/components/rs/RsRatingBadge";
import type { RsStock } from "@/hooks/useRsAlpha";
import type { ConcentrationItem } from "@/components/shared/GroupConcentrationPanel";

export interface Snapshot {
  s: string[]; secs: string[]; si: number[];
  d1: (number | null)[]; w1: (number | null)[]; m1: (number | null)[]; m3: (number | null)[]; m6: (number | null)[];
  adr: (number | null)[];
}
export interface HistoryPoint { day: string; source: "live" | "rebuilt"; snap: Snapshot }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = () => (supabase as any).from("rs_history_snapshots");

/** NY-agnostic ISO week key of a YYYY-MM-DD date (Monday-based). */
function weekOf(day: string): string {
  const d = new Date(day + "T12:00:00Z");
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd);
  return d.toISOString().slice(0, 10);
}

/**
 * One point per week (the newest row of that week, a real "live" row winning over a rebuilt one).
 * Rows never change once written, so each is downloaded once and kept in IndexedDB.
 */
export async function loadHistory(maxWeeks = 52): Promise<HistoryPoint[]> {
  const { data: list, error } = await table().select("day, source, created_at").order("day", { ascending: true });
  if (error) throw new Error(/relation|does not exist/i.test(error.message) ? "History isn't set up on the server yet." : error.message);
  const rows = (list ?? []) as { day: string; source: "live" | "rebuilt"; created_at: string }[];

  const byWeek = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = weekOf(r.day), cur = byWeek.get(k);
    if (!cur || (r.source === "live" && cur.source !== "live") || (r.source === cur.source && r.day > cur.day)) byWeek.set(k, r);
  }
  const picked = [...byWeek.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-maxWeeks);

  const keyOf = (r: (typeof rows)[number]) => `rsh:${r.day}:${r.source}:${r.created_at}`;
  const out = new Map<string, Snapshot>();
  const missing: typeof picked = [];
  for (const r of picked) {
    const c = await idbGet<Snapshot>(keyOf(r));
    if (c) out.set(r.day, c); else missing.push(r);
  }
  for (let i = 0; i < missing.length; i += 8) {
    const batch = missing.slice(i, i + 8);
    const { data, error: e2 } = await table().select("day, data").in("day", batch.map((b) => b.day));
    if (e2) throw new Error(e2.message);
    for (const row of (data ?? []) as { day: string; data: Snapshot }[]) {
      out.set(row.day, row.data);
      const meta = batch.find((b) => b.day === row.day);
      if (meta) void idbSet(keyOf(meta), row.data);
    }
  }
  return picked.filter((r) => out.has(r.day)).map((r) => ({ day: r.day, source: r.source, snap: out.get(r.day)! }));
}

/** Ask the server to rebuild missing past weeks from price history (first use, or after a gap). */
export async function rebuildHistory(): Promise<{ rebuilt: number; reason?: string }> {
  const { data, error } = await supabase.functions.invoke("rs-history", { body: { action: "rebuild" } });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return { rebuilt: data?.rebuild?.rebuilt ?? 0, reason: data?.rebuild?.reason };
}

export interface ReplayOptions {
  tabId: string;
  getRsForTab: (s: RsStock, t: never) => number | null;
  isOtcSymbol: (sym: string) => boolean;
  minRating: number;
  minAdr: number;
  topN: number;          // >= topNMax means all
  topNMax: number;
  acceleratingOnly: boolean;
  excludeOtc: boolean;
  /** true = drop this stock (the window's sector exclusions). */
  excludeSector?: (industry: string) => boolean;
  themeBySymbol: Map<string, string>;
}

/** Stocks of a snapshot as RS Alpha rows (only the fields the filters read). */
function stocksOf(snap: Snapshot): RsStock[] {
  return snap.s.map((symbol, i) => ({
    symbol, companyName: null, sector: snap.si[i] >= 0 ? snap.secs[snap.si[i]] : null,
    price: null, marketCap: null, avgDollarVolume: null, adrPercent: snap.adr[i], adrSource: null,
    return1d: null, return1w: null, return1m: null, return3m: null, return6m: null,
    spyReturn1d: null, spyReturn1w: null, spyReturn1m: null, spyReturn3m: null, spyReturn6m: null,
    rs1d: snap.d1[i], rs1w: snap.w1[i], rs1m: snap.m1[i], rs3m: snap.m3[i], rs6m: snap.m6[i],
    rsOverall: null, rsCalculatedAt: null, rsNh20d: null, rsNh20dDaysAgo: null, rsNh6m: null, rsNh6mDaysAgo: null,
  }));
}

/**
 * The window's filters, replayed on one snapshot: RS ratings ranked within that week's list,
 * then min rating, min ADR, accelerating, OTC, sector exclusions, sort by RS, top N.
 */
export function replay(snap: Snapshot, o: ReplayOptions): ConcentrationItem[] {
  const tab = o.tabId as never;
  const all = stocksOf(snap).filter((s) => !(o.excludeOtc && o.isOtcSymbol(s.symbol)));
  const rsVals = all.map((s) => o.getRsForTab(s, tab));
  const ratings = computeRsRatings(rsVals);
  const rating = new Map(all.map((s, i) => [s.symbol, ratings[i]]));
  let list = all.filter((s) => {
    const r = rating.get(s.symbol);
    if (r === null || r === undefined || r < o.minRating) return false;
    if (s.adrPercent === null || s.adrPercent < o.minAdr) return false;
    if (o.acceleratingOnly && (s.rs1m === null || s.rs3m === null || !(s.rs1m > s.rs3m))) return false;
    if (o.excludeSector && s.sector && o.excludeSector(s.sector)) return false;
    return true;
  });
  list = list.sort((a, b) => (o.getRsForTab(b, tab) ?? -999) - (o.getRsForTab(a, tab) ?? -999));
  if (o.topN < o.topNMax) list = list.slice(0, o.topN);
  return list.map((s) => ({
    symbol: s.symbol, industry: s.sector, theme: o.themeBySymbol.get(s.symbol.toUpperCase()) ?? null,
    rating: rating.get(s.symbol) ?? null, ret: null,
  }));
}
