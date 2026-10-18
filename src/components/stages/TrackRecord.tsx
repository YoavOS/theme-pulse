import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

/**
 * The app's own track record (table signal_log): every weekly scan logs each stock's stage, base and
 * the market regime, and 4 / 8 / 13 weeks later the scan fills in what actually happened — including
 * stocks that have since left the list, so there is no survivorship bias going forward.
 */
interface LogRow {
  week: string; stage: number | null; substage: string | null; tt: boolean | null;
  base_state: string | null; base_label: string | null; base_tight: boolean | null; base_score: number | null; regime: string | null;
  fwd4: number | null; spy4: number | null; fwd8: number | null; spy8: number | null; fwd13: number | null; spy13: number | null;
}
type H = 4 | 8 | 13;

let cache: { at: number; rows: LogRow[]; first: string | null; weeks: number } | null = null;

async function loadLog() {
  if (cache && Date.now() - cache.at < 30 * 60_000) return cache;
  const db = supabase as unknown as SupabaseClient;
  const since = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
  const rows: LogRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("signal_log")
      .select("week, stage, substage, tt, base_state, base_label, base_tight, base_score, regime, fwd4, spy4, fwd8, spy8, fwd13, spy13")
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
  cache = { at: Date.now(), rows, first, weeks };
  return cache;
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
    const fwd = (r: LogRow) => (h === 4 ? r.fwd4 : h === 8 ? r.fwd8 : r.fwd13);
    const spy = (r: LogRow) => (h === 4 ? r.spy4 : h === 8 ? r.spy8 : r.spy13);
    const rows = data.rows.filter((r) => fwd(r) != null && spy(r) != null);
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
    ];
    return defs.map(([name, fn]) => {
      const g = rows.filter(fn);
      const ex = g.map((r) => fwd(r)! - spy(r)!);
      return { name, n: g.length, medEx: median(ex), medRet: median(g.map((r) => fwd(r)!)), hit: g.length ? (ex.filter((x) => x > 0).length / g.length) * 100 : NaN, weeks: new Set(g.map((r) => r.week)).size };
    });
  }, [data, h, mode]);

  const resolvedWeeks = data ? new Set(data.rows.filter((r) => (h === 4 ? r.fwd4 : h === 8 ? r.fwd8 : r.fwd13) != null).map((r) => r.week)).size : 0;
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Track record</h2>
        <span className="text-[11px] text-muted-foreground">
          · the app's own signals, logged every scan and checked {h} weeks later (stocks that leave the list still count)
        </span>
        <div className="ml-auto inline-flex rounded-md border border-border bg-muted/20 p-0.5">
          {([4, 8, 13] as H[]).map((x) => (
            <button key={x} onClick={() => setH(x)} className={`rounded px-2 py-0.5 text-[11px] ${h === x ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{x}w</button>
          ))}
        </div>
      </div>
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
                <th className="px-2 py-1.5 text-right font-medium">Cases</th>
                <th className="px-2 py-1.5 text-right font-medium">Weeks</th>
                <th className="px-2 py-1.5 text-right font-medium" title="Median of (stock return − SPY return)">Median vs SPY</th>
                <th className="px-2 py-1.5 text-right font-medium">Median return</th>
                <th className="px-2 py-1.5 text-right font-medium">Beat SPY</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.name} className={`border-b border-border/30 ${g.n < 30 ? "opacity-50" : ""}`} title={g.n < 30 ? "Fewer than 30 cases — too few to read" : undefined}>
                  <td className="px-2 py-1">{g.name}</td>
                  <td className="px-2 py-1 text-right font-mono">{g.n.toLocaleString("en-US")}</td>
                  <td className="px-2 py-1 text-right font-mono text-muted-foreground">{g.weeks}</td>
                  <td className={`px-2 py-1 text-right font-mono ${g.medEx > 0 ? "text-emerald-400" : g.medEx < 0 ? "text-pink-300" : ""}`}>{g.n ? `${g.medEx >= 0 ? "+" : ""}${g.medEx.toFixed(1)}%` : "—"}</td>
                  <td className="px-2 py-1 text-right font-mono">{g.n ? `${g.medRet >= 0 ? "+" : ""}${g.medRet.toFixed(1)}%` : "—"}</td>
                  <td className="px-2 py-1 text-right font-mono">{g.n ? `${g.hit.toFixed(0)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10.5px] text-muted-foreground">
            {resolvedWeeks} week{resolvedWeeks === 1 ? "" : "s"} with {h}-week results. Weeks overlap and one market regime can dominate a short record —
            read differences of a few points over a few weeks as noise (faded rows have under 30 cases); the record gets meaningful after several months of weekly scans.
          </p>
        </div>
      )}
    </section>
  );
}
