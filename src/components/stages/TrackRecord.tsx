import { useEffect, useMemo, useState } from "react";
import { SectionHead, Segmented } from "@/components/Explainer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

/**
 * The app's own track record (table signal_log): every weekly scan logs each stock's stage, base and
 * the market regime, and 4 / 8 / 13 weeks later the scan fills in what actually happened — including
 * stocks that have since left the list (delisted ones are closed at their last known price).
 *
 * Honesty rules: rows are written once (never rewritten); base-state rows are measured from the
 * day and price the base state was computed on (older rows logged before that fix are left out of
 * the base table); results are counted per EPISODE (the first week a stock enters a signal), since
 * a stock that stays in a state for 8 weeks would otherwise count 8 overlapping times.
 */
interface LogRow {
  symbol: string; week: string; signal_date: string | null; exit_last: boolean | null;
  bfwd4: number | null; bfwd8: number | null; bfwd13: number | null; stage: number | null; substage: string | null; tt: boolean | null;
  base_state: string | null; base_label: string | null; base_tight: boolean | null; base_score: number | null; regime: string | null;
  earn_label: string | null; vol_score: number | null;
  fwd4: number | null; spy4: number | null; fwd8: number | null; spy8: number | null; fwd13: number | null; spy13: number | null;
}
type H = 4 | 8 | 13;

let cache: { at: number; rows: LogRow[]; first: string | null; weeks: number; breakouts: { status: string; breakout_date: string; max_ext_pct: number | null }[] } | null = null;

async function loadLog() {
  if (cache && Date.now() - cache.at < 30 * 60_000) return cache;
  const db = supabase as unknown as SupabaseClient;
  const since = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
  const rows: LogRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("signal_log")
      .select("symbol, week, signal_date, exit_last, bfwd4, bfwd8, bfwd13, stage, substage, tt, base_state, base_label, base_tight, base_score, regime, earn_label, vol_score, fwd4, spy4, fwd8, spy8, fwd13, spy13")
      .not("fwd4", "is", null).gte("week", since).range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as LogRow[]));
    if (data.length < 1000) break;
  }
  const { data: firstRow } = await db.from("signal_log").select("week").order("week", { ascending: true }).limit(1);
  const { data: lastRow } = await db.from("signal_log").select("week").order("week", { ascending: false }).limit(1);
  const first = (firstRow?.[0] as { week?: string } | undefined)?.week ?? null;
  const last = (lastRow?.[0] as { week?: string } | undefined)?.week ?? null;
  const weeks = first && last ? Math.round((Date.parse(last) - Date.parse(first)) / (7 * 86_400_000)) + 1 : 0;
  // Breakouts (base_breakouts): failure rate once a breakout is at least 2 weeks old.
  let breakouts: { status: string; breakout_date: string; max_ext_pct: number | null }[] = [];
  try {
    const { data } = await db.from("base_breakouts").select("status, breakout_date, max_ext_pct").gte("breakout_date", since).limit(5000);
    breakouts = (data ?? []) as typeof breakouts;
  } catch { /* table not set up yet */ }
  cache = { at: Date.now(), rows, first, weeks, breakouts };
  return cache;
}

/** Wilson 90% interval for a hit rate (in %). */
function wilson(k: number, n: number): [number, number] {
  if (!n) return [NaN, NaN];
  const z = 1.645, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, m = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - m) * 100, Math.min(1, c + m) * 100];
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

export default function TrackRecord({ mode }: { mode: "stages" | "bases" }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof loadLog>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [h, setH] = useState<H>(13);
  useEffect(() => {
    loadLog().then(setData).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const groups = useMemo(() => {
    if (!data) return [];
    // Base-state rows use the outcome measured from the day the base state was computed on, and only
    // rows logged with that information (older ones could include later days in the state).
    const isBaseDef = (name: string) => mode === "bases" && name !== "Stage 2, no base";
    const fwdOf = (r: LogRow, base: boolean) => base ? (h === 4 ? r.bfwd4 : h === 8 ? r.bfwd8 : r.bfwd13) : (h === 4 ? r.fwd4 : h === 8 ? r.fwd8 : r.fwd13);
    const spy = (r: LogRow) => (h === 4 ? r.spy4 : h === 8 ? r.spy8 : r.spy13);
    const rows = data.rows;
    const defs: [string, (r: LogRow) => boolean][] = mode === "stages" ? [
      ["Stage 1", (r) => r.stage === 1], ["Stage 2", (r) => r.stage === 2], ["Stage 3", (r) => r.stage === 3], ["Stage 4", (r) => r.stage === 4],
      ["2A fresh breakouts", (r) => r.substage === "2A"], ["4B− bounces", (r) => r.substage === "4B-"],
      ["Trend Template ✓", (r) => !!r.tt], ["Stage 2 · green regime", (r) => r.stage === 2 && r.regime === "green"],
      ["Stage 2 · yellow regime", (r) => r.stage === 2 && r.regime === "yellow"], ["Stage 2 · red regime", (r) => r.stage === 2 && r.regime === "red"],
    ] : [
      ["Stage 2, no base", (r) => r.stage === 2 && !r.base_state], ["Stage 2, in a base", (r) => r.stage === 2 && !!r.base_state],
      ["Score 85+", (r) => (r.base_score ?? 0) >= 85], ["Score 75–84", (r) => (r.base_score ?? 0) >= 75 && (r.base_score ?? 0) < 85],
      ["Ready", (r) => r.base_state === "ready"], ["Triggered", (r) => r.base_state === "triggered"],
      ["Tightening (daily)", (r) => !!r.base_tight], ["VCP", (r) => r.base_label === "vcp"], ["Flat base", (r) => r.base_label === "flat"],
      ["Cup w/ handle", (r) => r.base_label === "cup"], ["IPO base", (r) => r.base_label === "ipo"], ["Base · green regime", (r) => !!r.base_state && r.regime === "green"],
      ["Base · red regime", (r) => !!r.base_state && r.regime === "red"],
      ["Earnings bought (last report)", (r) => ["beat_bought", "miss_bought", "reaction_up"].includes(r.earn_label ?? "")],
      ["Earnings sold (last report)", (r) => ["beat_sold", "miss_sold", "reaction_down"].includes(r.earn_label ?? "")],
      ["Breakout volume support 2/2", (r) => r.vol_score === 2],
    ];
    // Episode = the first logged week of a run of consecutive weeks in the signal.
    const bySym = new Map<string, LogRow[]>();
    for (const r of rows) bySym.set(r.symbol, [...(bySym.get(r.symbol) ?? []), r]);
    for (const l of bySym.values()) l.sort((a, b) => a.week.localeCompare(b.week));
    return defs.map(([name, fn]) => {
      const base = isBaseDef(name);
      const ok = (r: LogRow) => fn(r) && fwdOf(r, base) != null && spy(r) != null && (!base || !!r.signal_date);
      const cases = rows.filter(ok);
      const eps: LogRow[] = [];
      for (const l of bySym.values()) {
        let prevIn = false, prevWeek = "";
        for (const r of l) {
          const consecutive = prevWeek && Date.parse(r.week) - Date.parse(prevWeek) <= 7 * 86_400_000;
          const inNow = fn(r);
          if (inNow && !(prevIn && consecutive) && ok(r)) eps.push(r);
          prevIn = inNow; prevWeek = r.week;
        }
      }
      const ex = eps.map((r) => fwdOf(r, base)! - spy(r)!);
      const k = ex.filter((x) => x > 0).length;
      return {
        name, n: cases.length, eps: eps.length, medEx: median(ex), medRet: median(eps.map((r) => fwdOf(r, base)!)),
        hit: eps.length ? (k / eps.length) * 100 : NaN, ci: wilson(k, eps.length), weeks: new Set(eps.map((r) => r.week)).size,
        legacy: base ? rows.filter((r) => fn(r) && !r.signal_date).length : 0,
      };
    });
  }, [data, h, mode]);

  const resolvedWeeks = data ? new Set(data.rows.filter((r) => (h === 4 ? r.fwd4 : h === 8 ? r.fwd8 : r.fwd13) != null).map((r) => r.week)).size : 0;
  const exitLast = data ? data.rows.filter((r) => r.exit_last).length : 0;
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <SectionHead
        title="Track record"
        sub={`The app's own signals, logged once per week and checked ${h} weeks later. Stocks that later leave your list still count${exitLast ? ` (${exitLast} delisted, closed at their last price)` : ""}.`}
        right={<Segmented<H> size="xs" value={h} onChange={setH} options={([4, 8, 13] as H[]).map((x) => ({ value: x, label: `${x}w` }))} />}
      />
      {err ? (
        <p className="text-xs text-muted-foreground">{/does not exist|schema cache/i.test(err) ? "The signal log isn't set up on the server yet." : `Couldn't load the log: ${err}`}</p>
      ) : !data ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Loading…</p>
      ) : resolvedWeeks === 0 ? (
        <p className="text-xs text-muted-foreground">
          {data.first
            ? <>Collecting since the week of {data.first} ({data.weeks} week{data.weeks === 1 ? "" : "s"} logged). The first {h}-week results appear after {new Date(Date.parse(data.first) + h * 7 * 86_400_000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} — keep scanning weekly.</>
            : "Nothing logged yet — every Full Scan / stage scan adds a week."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-[10.5px] text-muted-foreground">
                <th className="px-2 py-1.5 text-left font-medium">Signal</th>
                <th className="px-2 py-1.5 text-right font-medium" title="Separate signals: the first week a stock enters the state (a stock that stays 8 weeks counts once)">Episodes</th>
                <th className="px-2 py-1.5 text-right font-medium" title="Stock-weeks (overlapping)">Stock-weeks</th>
                <th className="px-2 py-1.5 text-right font-medium" title="Median of (stock return − SPY return)">Median vs SPY</th>
                <th className="px-2 py-1.5 text-right font-medium">Median return</th>
                <th className="px-2 py-1.5 text-right font-medium" title="Share of episodes that beat SPY, with a 90% range — wide ranges mean too little data to judge">Beat SPY (90% range)</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.name} className={`border-b border-border/30 ${g.eps < 30 ? "opacity-50" : ""}`} title={g.eps < 30 ? "Fewer than 30 separate signals — too few to read" : undefined}>
                  <td className="px-2 py-1">{g.name}</td>
                  <td className="px-2 py-1 text-right font-mono">{g.eps.toLocaleString("en-US")}</td>
                  <td className="px-2 py-1 text-right font-mono text-muted-foreground">{g.n.toLocaleString("en-US")}</td>
                  <td className={`px-2 py-1 text-right font-mono ${g.medEx > 0 ? "text-blue-400" : g.medEx < 0 ? "text-pink-300" : ""}`}>{g.eps ? `${g.medEx >= 0 ? "+" : ""}${g.medEx.toFixed(1)}%` : "—"}</td>
                  <td className="px-2 py-1 text-right font-mono">{g.eps ? `${g.medRet >= 0 ? "+" : ""}${g.medRet.toFixed(1)}%` : "—"}</td>
                  <td className="px-2 py-1 text-right font-mono">{g.eps ? <>{g.hit.toFixed(0)}% <span className="text-muted-foreground">({g.ci[0].toFixed(0)}–{g.ci[1].toFixed(0)})</span></> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {mode === "bases" && (() => {
            const old = (data.breakouts ?? []).filter((b) => Date.now() - Date.parse(b.breakout_date) >= 14 * 86_400_000);
            if (old.length < 5) return null;
            const failed = old.filter((b) => b.status === "failed").length;
            const [lo, hi] = wilson(failed, old.length);
            const exts = old.map((b) => b.max_ext_pct).filter((x): x is number => typeof x === "number");
            return (
              <p className="mt-2 text-[11px] text-muted-foreground">
                <b className="text-foreground/90">Breakouts:</b> {old.length} breakouts at least 2 weeks old — {((failed / old.length) * 100).toFixed(0)}% failed
                (closed 3%+ back under the pivot; 90% range {lo.toFixed(0)}–{hi.toFixed(0)}%){exts.length ? `, median best gain ${median(exts).toFixed(1)}% above the pivot` : ""}.
              </p>
            );
          })()}
          {mode === "bases" && groups.some((g) => g.legacy > 0) && (
            <p className="mt-1 text-[10.5px] text-muted-foreground">Base rows logged before Nov 2026 are left out: they were priced from an earlier Friday than the base state they recorded.</p>
          )}
          <p className="mt-2 text-[10.5px] text-muted-foreground">
            {resolvedWeeks} week{resolvedWeeks === 1 ? "" : "s"} with {h}-week results. Weeks overlap and one market regime can dominate a short record —
            read differences of a few points over a few weeks as noise (faded rows have under 30 separate signals); the record gets meaningful after several months of weekly scans.
          </p>
        </div>
      )}
    </section>
  );
}
