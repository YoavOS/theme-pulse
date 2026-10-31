import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  FUNDAMENTAL_KEYS, loadListSettings, loadThresholds, passes, savedScore,
  type ListSettings, type ProfileKey, type SavedRow, type Thresholds,
} from "@/lib/superperfProfiles";

export type SuperperformanceProfileKey = "minervini" | "oneil" | "ryan" | "current";
export type SuperperformanceRow = SavedRow;

/**
 * Light columns only: scores, dates. The per-stock breakdown (a few KB each) is fetched
 * on demand with loadBreakdown(), so pages that only need "is it a qualifier?" stay small.
 * One shared copy for the whole app (RS Alpha, the scan window, the dashboard and the theme
 * window all read it), refreshed at most every 5 minutes unless reload() is called.
 */
const COLS = "symbol, minervini_score, oneil_score, ryan_score, current_score, last_scanned, profile_scores, last_report, next_report";
const LEGACY_COLS = "symbol, minervini_score, oneil_score, ryan_score, current_score, last_scanned";
const TTL = 5 * 60_000;
let shared: { at: number; rows: SavedRow[] } | null = null;
let inflight: Promise<SavedRow[]> | null = null;
const listeners = new Set<(rows: SavedRow[]) => void>();

async function fetchRows(): Promise<SavedRow[]> {
  const out: SavedRow[] = [];
  let cols = COLS;
  for (let from = 0; ; from += 1000) {
    let { data, error } = await supabase.from("superperformance_stocks" as never).select(cols).range(from, from + 999);
    // Before the migration that adds profile_scores / report dates, fall back to the old columns.
    if (error && cols === COLS && /column/i.test(error.message)) {
      cols = LEGACY_COLS;
      ({ data, error } = await supabase.from("superperformance_stocks" as never).select(cols).range(from, from + 999));
    }
    if (error) throw error;
    const page = (data ?? []) as unknown as SavedRow[];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

function load(force: boolean): Promise<SavedRow[]> {
  if (!force && shared && Date.now() - shared.at < TTL) return Promise.resolve(shared.rows);
  if (inflight) return inflight;
  inflight = fetchRows()
    .then((rows) => { shared = { at: Date.now(), rows }; listeners.forEach((l) => l(rows)); return rows; })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Stored breakdown for one stock (null when it was scored before breakdowns were saved). */
export async function loadBreakdown(symbol: string): Promise<SavedRow["breakdown"]> {
  const { data, error } = await supabase.from("superperformance_stocks" as never).select("breakdown").eq("symbol", symbol).maybeSingle();
  if (error) return null;
  return ((data as { breakdown?: SavedRow["breakdown"] } | null)?.breakdown) ?? null;
}

export function useSuperperformance() {
  const [rows, setRows] = useState<SavedRow[]>(() => shared?.rows ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const on = (r: SavedRow[]) => setRows(r);
    listeners.add(on);
    return () => { listeners.delete(on); };
  }, []);

  const reload = useCallback(async (force = true) => {
    setLoading(true);
    setError(null);
    try { setRows(await load(force)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void reload(false); }, [reload]);

  // Saved thresholds + list settings, kept in sync with the scan window.
  const [thresholds, setThresholds] = useState<Thresholds>(() => loadThresholds());
  const [list, setList] = useState<ListSettings>(() => loadListSettings());
  useEffect(() => {
    const on = () => { setThresholds(loadThresholds()); setList(loadListSettings()); };
    window.addEventListener("superperf-settings", on);
    return () => window.removeEventListener("superperf-settings", on);
  }, []);

  /** Symbols passing each classic profile's saved threshold (for the RS Alpha filter chips). */
  const sets = useMemo(() => {
    const out: Record<SuperperformanceProfileKey, Set<string>> = { minervini: new Set(), oneil: new Set(), ryan: new Set(), current: new Set() };
    for (const r of rows) {
      (Object.keys(out) as SuperperformanceProfileKey[]).forEach((k) => {
        const v = savedScore(r, k);
        if (v !== null && v >= thresholds[k]) out[k].add(r.symbol);
      });
    }
    return out;
  }, [rows, thresholds]);

  /**
   * Fundamental leaders: pass the list's earnings-based profiles (price profiles are left out,
   * since they need the Stages data). Used for the trophy markers on the dashboard.
   */
  const fundamentalQualifiers = useMemo(() => {
    const keys = list.profiles.filter((k) => (FUNDAMENTAL_KEYS as ProfileKey[]).includes(k));
    const settings: ListSettings = { profiles: keys.length ? keys : ["current", "minervini"], match: list.match };
    const out = new Set<string>();
    for (const r of rows) if (passes(settings, thresholds, (k) => savedScore(r, k))) out.add(r.symbol.toUpperCase());
    return out;
  }, [rows, list, thresholds]);

  return { rows, loading, error, reload, sets, thresholds, list, fundamentalQualifiers };
}
