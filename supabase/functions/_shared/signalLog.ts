// ─────────────────────────────────────────────────────────────
// Signal log — the app's own point-in-time track record (table signal_log).
// Called from stage-scan "finalize": logs this week's stage / base / regime
// for every stock, then fills 4 / 8 / 13-week outcomes for older rows.
//
// Point-in-time rules:
//  • Insert-only: the first scan after a week completes writes the row; later scans never
//    rewrite it (a track record must not be edited with hindsight).
//  • Stage outcomes (fwd4/8/13) start at the week's Friday close — the stage itself only uses
//    completed weeks. Base-state outcomes (bfwd4/8/13) start at the day and price the base state
//    was computed on (signal_date / signal_close), which can be after that Friday.
//  • Outcomes come from the later week's own log row, or Yahoo for stocks that left the list.
//    A return beyond −30% / +50% is re-checked on one fresh split-adjusted series.
//  • A failed price fetch is retried on later scans; after 3 failures the stock is treated as
//    delisted and closed at its last known price (exit_last) instead of being dropped.
// ─────────────────────────────────────────────────────────────
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { completedWeeks, weekKey, type WeeklyBar } from "./stageEngine.ts";

export interface BaseLogInfo {
  score: number; state: string; label: string; labels: string[]; tight: boolean; pivot: number; rvol: number | null;
  earnFuel?: number | null; earnLabel?: string | null; volScore?: number | null;
  signalDate?: string | null; signalClose?: number | null;
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
    let n10 = 0, n40 = 0, a10 = 0, a40 = 0, nh = 0, nl = 0;
    for (const r of rows) {
      if (r.symbol === "SPY") continue;
      const f = r.features?.flags;
      const b = bit(f, ago);
      if (!f || !Number.isFinite(b)) continue;
      // Young listings can't have a 40-week MA / 52-week range yet: leave them out of that measure.
      const age = f.length < 104 ? f.length - 1 - ago : Infinity;
      if (age >= 9) { n10++; if (b & 1) a10++; }
      if (age >= 39) { n40++; if (b & 2) a40++; }
      if (age >= 52) { if (b & 4) nh++; if (b & 8) nl++; }
    }
    return { p50: n10 ? (a10 / n10) * 100 : 0, p200: n40 ? (a40 / n40) * 100 : 0, rh: nh + nl ? (nh / (nh + nl)) * 100 : 50 };
  };
  const w0 = week(0), w1 = week(1), w2 = week(2), w3 = week(3);
  const hl = (w0.rh + w1.rh) / 2, hlPrev = (w2.rh + w3.rh) / 2;
  const sb = bit(rows.find((r) => r.symbol === "SPY")?.features?.flags, 0);
  const spyUp = Number.isFinite(sb) ? (sb & 2) !== 0 && (sb & 16) !== 0 : null;
  let regime = "yellow";
  if ((w0.p200 < 40 && w0.p50 < 40) || (hl < 40 && hl < hlPrev)) regime = "red";
  else if (spyUp === true && w0.p200 >= 50 && w0.p50 >= 60 && hl >= 55) regime = "green";
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

  // 1. this week's snapshot — insert-only (an existing row for the week is never rewritten)
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
      signal_date: b?.signalDate ?? null, signal_close: b?.signalClose ?? null,
    };
  });
  for (let k = 0; k < recs.length; k += 500) {
    const { error } = await db.from("signal_log").upsert(recs.slice(k, k + 500), { onConflict: "symbol,week", ignoreDuplicates: true });
    if (error) throw error;
  }

  // 2. outcomes for older rows
  let filled = 0, fetched = 0, gone = 0;
  const yahooCache = new Map<string, WeeklyBar[] | null>();
  const series = async (sym: string): Promise<WeeklyBar[] | null | "skip"> => {
    if (!yahooCache.has(sym)) {
      if (fetched >= 150) return "skip";                       // bounded per run; the rest next scan
      fetched++;
      const raw = await fetchWeekly(sym);
      yahooCache.set(sym, raw ? completedWeeks(raw) : null);
    }
    return yahooCache.get(sym) ?? null;
  };
  const fridayOf = (iso: string) => {
    // the Friday of the week containing this date
    const d = new Date(iso + "T12:00:00Z");
    const wd = d.getUTCDay();
    const toFri = wd === 6 ? -1 : wd === 0 ? -2 : 5 - wd;
    return shift(iso, toFri);
  };
  const barOf = (bars: WeeklyBar[], friday: string) => {
    const monday = Date.parse(friday + "T00:00:00Z") / 1000 - 4 * 86400;
    return bars.find((b) => weekKey(b.t) === monday) ?? null;
  };
  // Last known close of a stock at or before a week (for delisted stocks).
  const lastLogged = async (sym: string, friday: string) => {
    const { data } = await db.from("signal_log").select("close, week").eq("symbol", sym).lte("week", friday).not("close", "is", null)
      .order("week", { ascending: false }).limit(1);
    const r = (data ?? [])[0] as { close: number } | undefined;
    return r ? Number(r.close) : null;
  };
  // Return from entry (date, price) to the Friday close `target`; null = not available yet.
  type Out = { ret: number; exitLast?: boolean } | null | "retry";
  const outcome = async (sym: string, entryFriday: string, entryClose: number, target: string, laterClose: number | null, tries: number): Promise<Out> => {
    let exit: number | null = laterClose;
    let bars: WeeklyBar[] | null | "skip" | undefined;
    if (exit === null) {
      bars = await series(sym);
      if (bars === "skip") return null;
      if (bars === null) {
        if (tries + 1 < 3) return "retry";
        const last = await lastLogged(sym, target);           // delisted: close at the last known price
        return last ? { ret: (last / entryClose - 1) * 100, exitLast: true } : null;
      }
      const b = barOf(bars, target);
      if (!b) return null;
      exit = b.c;
    }
    let ret = (exit / entryClose - 1) * 100;
    // A split between entry and exit (two raw closes from different times) shows as a huge move:
    // re-measure both legs on one fresh, split-adjusted series.
    if (ret <= -30 || ret >= 50) {
      if (bars === undefined) bars = await series(sym);
      if (bars && bars !== "skip") {
        const a = barOf(bars, entryFriday), b = barOf(bars, target);
        if (a && b) ret = (b.c / a.c - 1) * 100;
      }
    }
    return { ret };
  };

  for (const h of [4, 8, 13] as const) {
    const col = `fwd${h}`, scol = `spy${h}`, bcol = `bfwd${h}`;
    const cutoff = shift(asOf, -7 * h), oldest = shift(asOf, -7 * (h + 52));
    const pending = await selectAll<{ symbol: string; week: string; close: number | null; spy_close: number | null; signal_date: string | null; signal_close: number | null; tries: number | null; [k: string]: unknown }>((from) =>
      db.from("signal_log").select(`symbol, week, close, spy_close, signal_date, signal_close, tries, ${bcol}`).is(col, null).or("gone.is.null,gone.eq.false")
        .lte("week", cutoff).gte("week", oldest).range(from, from + 999));
    if (!pending.length) continue;
    const byTarget = new Map<string, typeof pending>();
    for (const p of pending) {
      const t = shift(p.week, 7 * h);
      byTarget.set(t, [...(byTarget.get(t) ?? []), p]);
    }
    // every object in one upsert must carry the same columns (missing ones would be written as NULL)
    const updates: Record<string, unknown>[] = [];
    const retries: Record<string, unknown>[] = [];
    const laterCache = new Map<string, Map<string, number>>();
    const closesAt = async (friday: string) => {
      if (!laterCache.has(friday)) {
        const later = await selectAll<{ symbol: string; close: number | null }>((from) =>
          db.from("signal_log").select("symbol, close").eq("week", friday).range(from, from + 999));
        laterCache.set(friday, new Map(later.filter((x) => x.close).map((x) => [x.symbol, Number(x.close)])));
      }
      return laterCache.get(friday)!;
    };
    for (const [target, list] of byTarget) {
      const closes = await closesAt(target);
      let spyT: number | null = closes.get("SPY") ?? null;
      if (spyT === null) { const sb = await series("SPY"); if (sb && sb !== "skip") spyT = barOf(sb, target)?.c ?? null; }
      for (const p of list) {
        if (!p.close) continue;
        // Fill both outcomes together: wait until the base-state horizon (from signal_date) has passed too.
        if (p.signal_close && p.signal_date && fridayOf(shift(p.signal_date, 7 * h)) > asOf) continue;
        const tries = p.tries ?? 0;
        const o = await outcome(p.symbol, p.week, Number(p.close), target, closes.get(p.symbol) ?? null, tries);
        if (o === "retry") { retries.push({ symbol: p.symbol, week: p.week, tries: tries + 1 }); continue; }
        if (o === null) continue;
        if (o.exitLast) gone++;
        // Base-state outcome from the day/price the base state was computed on.
        let bret: number | null = null;
        if (p.signal_close && p.signal_date) {
          const bTarget = fridayOf(shift(p.signal_date, 7 * h));
          {
            const bCloses = await closesAt(bTarget);
            const bo = await outcome(p.symbol, fridayOf(p.signal_date), Number(p.signal_close), bTarget, bCloses.get(p.symbol) ?? null, 3);
            if (bo && bo !== "retry") bret = r2(bo.ret);
          }
        }
        updates.push({
          symbol: p.symbol, week: p.week, [col]: r2(o.ret),
          [scol]: typeof spyT === "number" && p.spy_close ? r2((spyT / Number(p.spy_close) - 1) * 100) : null,
          [bcol]: bret ?? (p[bcol] as number | null) ?? null,
          exit_last: o.exitLast ?? null,
        });
        filled++;
      }
    }
    for (const batch of [updates, retries]) {
      for (let k = 0; k < batch.length; k += 500) {
        const { error } = await db.from("signal_log").upsert(batch.slice(k, k + 500), { onConflict: "symbol,week" });
        if (error) throw error;
      }
    }
  }
  return { logged: recs.length, filled, fetched, gone };
}
