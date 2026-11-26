import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bell, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TvExportButton } from "./TvExportButton";
import { supabase } from "@/integrations/supabase/client";
import type { AiLang } from "@/lib/ai";
import { touchLab } from "@/lib/labs";

/**
 * Today's lists, built every night from the price history on your PC:
 * 21 EMA pullbacks after a big run, stocks bought on red market days, and groups bought on red days.
 * Each list also shows how its past picks did afterwards (against SPY), so you can judge whether it works.
 */
type ListId = "ema21" | "redday" | "redday_group";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface Row { day: string; list: ListId; symbol: string; rank: number; grp: string | null; score: number; evidence: any; ai_line: string | null; ai_line_he: string | null }
interface Outcome { list: string; ret10: number | null; vs_spy10: number | null; vs_spy20: number | null }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const LISTS: { id: ListId; en: string; he: string; about: string }[] = [
  { id: "ema21", en: "21 EMA pullbacks", he: "פולבק ל-21 EMA", about: "Ran a lot since its last touch of the daily 21 EMA and is back near it now (\"at\" = inside your ~0.4 ADR zone), not in stage 3/4. Ranked by group strength, RS, closeness, volume drying up and run size." },
  { id: "redday", en: "Bought on red days", he: "נקנו בימים אדומים", about: "On days SPY fell 0.75% or more (last ~4 weeks), these closed up — or beat SPY by 1.5+ points and closed near the high — on at least normal volume, on most of those days." },
  { id: "redday_group", en: "Groups bought on red days", he: "קבוצות שנקנו בימים אדומים", about: "Industries and your themes whose members held up or were bought on those red days." },
];

const sgn = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(d)}`);
const tone = (v: number | null | undefined) => (v == null ? "" : v > 0 ? "text-[hsl(210,90%,65%)]" : v < 0 ? "text-[hsl(330,80%,65%)]" : "");

export default function TodayList({ lang }: { lang: AiLang }) {
  const he = lang === "he";
  const [tab, setTab] = useState<ListId>("ema21");
  useEffect(() => { touchLab("today-list"); }, []);
  const q = useQuery({
    queryKey: ["today-list"],
    queryFn: async () => {
      const { data: last } = await db.from("today_list").select("day").order("day", { ascending: false }).limit(1).maybeSingle();
      if (!last) return { day: null as string | null, rows: [] as Row[] };
      const { data } = await db.from("today_list").select("*").eq("day", last.day).order("rank");
      return { day: last.day as string, rows: (data ?? []) as Row[] };
    },
    staleTime: 5 * 60_000,
  });
  const outcomes = useQuery({
    queryKey: ["today-list-outcomes"],
    queryFn: async () => {
      const since = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
      const { data } = await db.from("today_list_outcomes").select("list, ret10, vs_spy10, vs_spy20").gte("day", since).limit(5000);
      return (data ?? []) as Outcome[];
    },
    staleTime: 30 * 60_000,
  });
  const progress = useQuery({
    queryKey: ["daily-bars-progress"],
    queryFn: async () => {
      const [{ count: have }, { count: total }] = await Promise.all([
        db.from("daily_bars_state").select("symbol", { count: "exact", head: true }).not("last_d", "is", null),
        db.from("qualified_rs_universe").select("symbol", { count: "exact", head: true }),
      ]);
      return { have: have ?? 0, total: total ?? 0 };
    },
    enabled: !q.isLoading && !q.data?.day,
    refetchInterval: 60_000,
  });

  const grade = useMemo(() => {
    const m = new Map<string, { n: number; beat: number; avg10: number; avg20: number }>();
    for (const l of ["ema21", "redday"]) {
      const rows = (outcomes.data ?? []).filter((o) => o.list === l && o.vs_spy10 != null);
      if (!rows.length) continue;
      const avg = (k: "vs_spy10" | "vs_spy20") => { const v = rows.map((r) => r[k]).filter((x): x is number => x != null); return v.length ? v.reduce((s, x) => s + Number(x), 0) / v.length : NaN; };
      m.set(l, { n: rows.length, beat: Math.round((100 * rows.filter((r) => Number(r.vs_spy10) > 0).length) / rows.length), avg10: avg("vs_spy10"), avg20: avg("vs_spy20") });
    }
    return m;
  }, [outcomes.data]);

  const rows = (q.data?.rows ?? []).filter((r) => r.list === tab);
  const info = LISTS.find((l) => l.id === tab)!;
  const g = grade.get(tab);

  const section = (l: (typeof LISTS)[number]) => ({ name: he ? l.he : l.en,
    symbols: (q.data?.rows ?? []).filter((r) => r.list === l.id).sort((a, b) => a.rank - b.rank).map((r) => r.symbol) });
  const tvOptions = [
    { label: he ? `הרשימה הזו: ${info.he}` : `This list: ${info.en}`, sections: [section(info)] },
    { label: he ? "כל שלוש הרשימות" : "All three lists", sections: LISTS.map(section) },
  ];
  const askNotify = async () => {
    if (!("Notification" in window)) { toast.error("This browser can't show notifications."); return; }
    const p = await Notification.requestPermission();
    toast[p === "granted" ? "success" : "error"](p === "granted" ? "You'll get a notification with the new list when you open the app on a new day." : "Notifications are blocked for this site.");
  };

  if (q.isLoading) return <div className="flex items-center gap-2 text-[13px] text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>;
  if (!q.data?.day) {
    const p = progress.data;
    return (
      <div className="rounded-lg border border-dashed border-border p-5 text-[13px] text-muted-foreground">
        <p>{he ? "הרשימות עוד לא נבנו. קודם האפליקציה מורידה היסטוריית מחירים יומית (כ-5 שנים לכל מניה) — פעם אחת, ברקע." : "The lists aren't built yet. First the app downloads daily price history (about 5 years per stock) — once, in the background."}</p>
        {p && p.total > 0 && <p className="mt-2">{he ? "התקדמות" : "Progress"}: {p.have.toLocaleString()} / {p.total.toLocaleString()} {he ? "מניות" : "stocks"}</p>}
      </div>
    );
  }
  const old = Date.now() - new Date(q.data.day).getTime() > 4 * 864e5;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <div className="flex overflow-hidden rounded-md border border-border" role="tablist">
          {LISTS.map((l) => {
            const n = (q.data?.rows ?? []).filter((r) => r.list === l.id).length;
            return (
              <button key={l.id} role="tab" aria-selected={tab === l.id} onClick={() => setTab(l.id)}
                className={`px-3 py-1.5 ${tab === l.id ? "bg-primary/15 font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                {he ? l.he : l.en} <span className="opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
        <span className={`text-muted-foreground ${old ? "text-[hsl(40,90%,60%)]" : ""}`}>{he ? "נכון ל-" : "As of "}{q.data.day}</span>
        <span className="ml-auto inline-flex gap-1.5">
          <button onClick={askNotify} title="Desktop notification when a new list is ready" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-muted-foreground hover:text-foreground"><Bell size={11} /> {he ? "התראות" : "Notify me"}</button>
          <TvExportButton options={tvOptions} fileName={`today-${tab}`} he={he} />
        </span>
      </div>
      <p className="text-[12px] text-muted-foreground">{info.about}</p>
      {g && tab !== "redday_group" && (
        <p className="rounded-md border border-border bg-muted/20 px-3 py-1.5 text-[12px]">
          <span className="font-semibold">How this list has done</span> (picks of the last 4 months, {g.n}): beat SPY over the next 10 sessions <span className="font-semibold">{g.beat}%</span> of the time; on average <span className={tone(g.avg10)}>{sgn(g.avg10)} pts</span> vs SPY after 10 sessions, <span className={tone(g.avg20)}>{sgn(g.avg20)} pts</span> after 20.
        </p>
      )}
      {rows.length === 0 ? <p className="text-[13px] text-muted-foreground">{he ? "אין מניות ברשימה היום." : "Nothing on this list today."}</p> : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[12.5px]">
            <thead className="bg-muted/30 text-[11px] uppercase tracking-wide text-muted-foreground">
              {tab === "ema21" && <tr><Th>#</Th><Th>Stock</Th><Th>Group</Th><Th r>Run</Th><Th r>From EMA</Th><Th r>Vol vs run</Th><Th r>RS</Th><Th>Note</Th></tr>}
              {tab === "redday" && <tr><Th>#</Th><Th>Stock</Th><Th>Group</Th><Th r>Bought</Th><Th r>vs SPY on red days</Th><Th r>RS</Th><Th>Note</Th></tr>}
              {tab === "redday_group" && <tr><Th>#</Th><Th>Group</Th><Th r>Members</Th><Th r>Bought</Th><Th r>vs SPY on red days</Th><Th>Leaders</Th><Th>Note</Th></tr>}
            </thead>
            <tbody>
              {rows.map((r) => {
                const e = r.evidence ?? {};
                const line = (he ? r.ai_line_he : r.ai_line) ?? r.ai_line;
                return (
                  <tr key={r.symbol} className="border-t border-border/60 align-top">
                    <Td>{r.rank}</Td>
                    {tab !== "redday_group" ? (
                      <Td><Link to={`/ai?tab=stock&symbol=${r.symbol}`} className="font-mono font-semibold hover:text-primary">{r.symbol}</Link><div className="max-w-[160px] truncate text-[11px] text-muted-foreground">{e.name}</div></Td>
                    ) : <Td><span className="font-semibold">{r.symbol}</span><div className="text-[11px] text-muted-foreground">{r.grp}</div></Td>}
                    {tab === "ema21" && <>
                      <Td><div className="max-w-[170px] truncate">{r.grp ?? "—"}</div><div className="text-[11px] text-muted-foreground">{e.industryPctS2 != null ? `${e.industryPctS2}% stage 2 · top ${100 - (e.industryPctile ?? 0)}%` : ""}{e.themes?.length ? ` · ${e.themes.slice(0, 2).join(", ")}` : ""}</div></Td>
                      <Td r>+{e.run}%<div className="text-[11px] text-muted-foreground">{e.sessionsSincePeak}d since peak</div></Td>
                      <Td r><span className={e.zone === "at" ? "font-semibold text-[hsl(210,90%,65%)]" : ""}>{sgn(e.distAdr, 2)} ADR</span><div className="text-[11px] text-muted-foreground">{e.zone === "at" ? "in your zone" : "nearing"}</div></Td>
                      <Td r>{e.volDryUp != null ? `${Math.round(e.volDryUp * 100)}%` : "—"}</Td>
                      <Td r>{e.rs ?? "—"}</Td>
                    </>}
                    {tab === "redday" && <>
                      <Td><div className="max-w-[170px] truncate">{r.grp ?? "—"}</div>{e.stage ? <div className="text-[11px] text-muted-foreground">Stage {e.stage}</div> : null}</Td>
                      <Td r>{e.bought} of {e.redDays}</Td>
                      <Td r className={tone(e.avgExcessOnRedDays)}>{sgn(e.avgExcessOnRedDays)} pts</Td>
                      <Td r>{e.rs ?? "—"}</Td>
                    </>}
                    {tab === "redday_group" && <>
                      <Td r>{e.members}</Td>
                      <Td r>{e.shareBought}%</Td>
                      <Td r className={tone(e.avgExcessOnRedDays)}>{sgn(e.avgExcessOnRedDays)} pts</Td>
                      <Td><span className="font-mono text-[11.5px]">{(e.leaders ?? []).join(" ")}</span></Td>
                    </>}
                    <Td><div dir="auto" className="min-w-[220px] max-w-[420px] text-[12px] text-foreground/85">{line ?? <span className="text-muted-foreground">—</span>}</div></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const Th = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => <th className={`px-2.5 py-2 font-medium ${r ? "text-right" : "text-left"}`}>{children}</th>;
const Td = ({ children, r, className = "" }: { children?: React.ReactNode; r?: boolean; className?: string }) => <td className={`px-2.5 py-2 ${r ? "text-right tabular-nums" : ""} ${className}`}>{children}</td>;
