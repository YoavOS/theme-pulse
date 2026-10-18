// ─────────────────────────────────────────────────────────────
// Signal log — the app's own point-in-time track record (table signal_log).
// Called from stage-scan "finalize": logs this week's stage / base / regime
// for every stock, then fills 4 / 8 / 13-week outcomes for older rows.
// Outcomes come from the later week's own log row; stocks that have left
// the list are priced from Yahoo so they still count (no survivorship).
// ─────────────────────────────────────────────────────────────
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { completedWeeks, weekKey, type WeeklyBar } from "./stageEngine.ts";

export interface BaseLogInfo {
  score: number; state: string; label: string; labels: string[]; tight: boolean; pivot: number; rvol: number | null;
  earnFuel?: number | null; earnLabel?: string | null; volScore?: number | null;
}

interface StageRowLite {
  symbol: string; stage: number; substage: string; confidence: number; event_kind: string | null; as_of: string;
  features: { close?: number; flags?: string; tt?: { pass: boolean } | null; mrs52?: number | null; r26Pct?: number | null } | null;
}

const DAY = 86_400_000;
const shift = (iso: string, days: number) => new Date(Date.parse(iso + "T00:00:00Z") + days * DAY).toISOString().slice(0, 10);
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Regime for the latest week from the stocks' breadth flags (same rules as the app's gauge). */
export function latestRegime(rows: StageRowLite[]) {
  const bit = (f: string | undefined, ago: number) => (f && f.length > ago ? parseInt(f[f.length - 1 - ago], 32) : NaN);
  const week = (ago: number) => {
    let n = 0, a10 = 0, a40 = 0, nh = 0, nl = 0;
    for (const r of rows) {
      if (r.symbol === "SPY") continue;
      const b = bit(r.features?.flags, ago);
      if (!Number.isFinite(b)) continue;
      n++; if (b & 1) a10++; if (b & 2) a40++; if (b & 4) nh++; if (b & 8) nl++;
    }
    return { p50: n ? (a10 / n) * 100 : 0, p200: n ? (a40 / n) * 100 : 0, rh: nh + nl ? (nh / (nh + nl)) * 100 : 50 };
  };
  const w0 = week(0), w1 = week(1), w2 = week(2), w3 = week(3);
  const hl = (w0.rh + w1.rh) / 2, hlPrev = (w2.rh + w3.rh) / 2;
  const sb = bit(rows.find((r) => r.symbol === "SPY")?.features?.flags, 0);
  const spyUp = Number.isFinite(sb) ? (sb & 2) !== 0 && (sb & 16) !== 0 : null;
  let regime = "yellow";
  if ((w0.p200 < 40 && w0.p50 < 40) || (hl < 40 && hl < hlPrev)) regime = "red";
  else if (spyUp !== false && w0.p200 >= 50 && w0.p50 >= 60 && hl >= 55) regime = "green";
  return { regime, p50: r2(w0.p50), p200: r2(w0.p200), hl: r2(hl) };
}

async function selectAll<T>(build: (from: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from);
    if (error) throw error;
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

export async function logSignals(
  db: SupabaseClient,
  stageRows: StageRowLite[],
  rsPctOf: (r26: number | null | undefined) => number | null,
  baseBy: Map<string, BaseLogInfo>,
  fetchWeekly: (sym: string) => Promise<WeeklyBar[] | null>,
): Promise<{ logged: number; filled: number; fetched: number; gone: number }> {
  const asOf = stageRows.reduce<string | null>((m, r) => (!m || r.as_of > m ? r.as_of : m), null);
  if (!asOf) return { logged: 0, filled: 0, fetched: 0, gone: 0 };
  const rows = stageRows.filter((r) => r.as_of === asOf);
  const reg = latestRegime(rows);
  const spyClose = rows.find((r) => r.symbol === "SPY")?.features?.close ?? null;

  // 1. this week's snapshot (re-running the same week just overwrites it)
  const recs = rows.map((r) => {
    const b = baseBy.get(r.symbol);
    return {
      symbol: r.symbol, week: asOf, close: r.features?.close ?? null, stage: r.stage, substage: r.substage,
      confidence: r.confidence, event_kind: r.event_kind, tt: r.features?.tt?.pass ?? null,
      rs_pct: rsPctOf(r.features?.r26Pct), mrs52: r.features?.mrs52 ?? null,
      base_score: b?.score ?? null, base_state: b?.state ?? null, base_label: b?.label ?? null, base_labels: b?.labels ?? null,
      base_tight: b ? b.tight : null, pivot: b?.pivot ?? null, trigger_rvol: b?.rvol ?? null,
      earn_fuel: b?.earnFuel ?? null, earn_label: b?.earnLabel ?? null, vol_score: b?.volScore ?? null,
      regime: reg.regime, p50: reg.p50, p200: reg.p200, hl: reg.hl, spy_close: spyClose,
    };
  });
  for (let k = 0; k < recs.length; k += 500) {
    const { error } = await db.from("signal_log").upsert(recs.slice(k, k + 500), { onConflict: "symbol,week" });
    if (error) throw error;
  }

  // 2. outcomes for older rows
  let filled = 0, fetched = 0, gone = 0;
  const yahooCache = new Map<string, WeeklyBar[] | null>();
  const closeAt = async (sym: string, friday: string): Promise<number | null | "gone"> => {
    if (!yahooCache.has(sym)) {
      if (fetched >= 150) return null;                       // bounded per run; the rest next scan
      fetched++;
      const raw = await fetchWeekly(sym);
      yahooCache.set(sym, raw ? completedWeeks(raw) : null);
    }
    const bars = yahooCache.get(sym);
    if (!bars) return "gone";
    const monday = Date.parse(friday + "T00:00:00Z") / 1000 - 4 * 86400;
    const bar = bars.find((b) => weekKey(b.t) === monday);
    return bar ? bar.c : null;
  };

  for (const h of [4, 8, 13] as const) {
    const col = `fwd${h}`, scol = `spy${h}`;
    const cutoff = shift(asOf, -7 * h), oldest = shift(asOf, -7 * (h + 26));
    const pending = await selectAll<{ symbol: string; week: string; close: number | null; spy_close: number | null }>((from) =>
      db.from("signal_log").select("symbol, week, close, spy_close").is(col, null).or("gone.is.null,gone.eq.false")
        .lte("week", cutoff).gte("week", oldest).range(from, from + 999));
    if (!pending.length) continue;
    const byTarget = new Map<string, typeof pending>();
    for (const p of pending) {
      const t = shift(p.week, 7 * h);
      byTarget.set(t, [...(byTarget.get(t) ?? []), p]);
    }
    // every object in one upsert must carry the same columns (missing ones would be written as NULL)
    const updates: Record<string, unknown>[] = [];
    const goneRows: Record<string, unknown>[] = [];
    for (const [target, list] of byTarget) {
      const later = await selectAll<{ symbol: string; close: number | null }>((from) =>
        db.from("signal_log").select("symbol, close").eq("week", target).range(from, from + 999));
      const closes = new Map(later.filter((x) => x.close).map((x) => [x.symbol, Number(x.close)]));
      let spyT: number | null | "gone" = closes.get("SPY") ?? null;
      if (spyT === null) spyT = await closeAt("SPY", target);
      for (const p of list) {
        if (!p.close) continue;
        let cT: number | null | "gone" = closes.get(p.symbol) ?? null;
        if (cT === null) cT = await closeAt(p.symbol, target);
        if (cT === "gone") { goneRows.push({ symbol: p.symbol, week: p.week, gone: true }); gone++; continue; }
        if (cT === null) continue;
        updates.push({
          symbol: p.symbol, week: p.week, [col]: r2((cT / Number(p.close) - 1) * 100),
          [scol]: typeof spyT === "number" && p.spy_close ? r2((spyT / Number(p.spy_close) - 1) * 100) : null,
        });
        filled++;
      }
    }
    for (const batch of [updates, goneRows]) {
      for (let k = 0; k < batch.length; k += 500) {
        const { error } = await db.from("signal_log").upsert(batch.slice(k, k + 500), { onConflict: "symbol,week" });
        if (error) throw error;
      }
    }
  }
  return { logged: recs.length, filled, fetched, gone };
}
