import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Lightbulb } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { PRINCIPLES, TAKES } from "@/lib/proven/principles";
import { ARCHETYPE_TEXT, LABEL_TEXT, type ProvenRow } from "@/lib/proven/types";
import { valueOf, type Story } from "@/lib/lens/valuation";
import ProvenBadge from "./ProvenBadge";

type Row = Pick<ProvenRow, "symbol" | "label" | "sentence" | "industry" | "archetype" | "archetypes" | "score" | "median_spread" | "series" | "track">;
const GOOD = new Set(["elite", "proven"]);

function useProvenRows(enabled: boolean) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!enabled || rows) return;
    let alive = true;
    (async () => {
      const out: Row[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await (supabase as unknown as SupabaseClient).from("proven_strength")
          .select("symbol, label, sentence, industry, archetype, archetypes, score, median_spread, series, track").eq("status", "ok").range(from, from + 999) as { data: Row[] | null; error: unknown };
        if (error || !data) break;
        out.push(...data);
        if (data.length < 1000) break;
      }
      if (alive) setRows(out);
    })();
    return () => { alive = false; };
  }, [enabled, rows]);
  return rows;
}
const med = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null && Number.isFinite(x)).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };

/** Growth adds value only when new capital earns more than it costs (Damodaran, Myth 5.3). */
function GrowthLab() {
  const [roic, setRoic] = useState(15), [wacc, setWacc] = useState(9), [g, setG] = useState(12);
  const story = (r: number): Story => ({ revenue: 1000, opMargin: 20, targetMargin: 20, taxRate: 0.25, salesToCapital: r / 15, costOfCapital: wacc, riskFree: 4, terminalEdge: 0 });
  const vg = valueOf(story(roic), g).value, v0 = valueOf(story(roic), 0).value;
  const diff = (vg / v0 - 1) * 100;
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="text-[13px] font-semibold">Growth lab: when does growth add value?</div>
      {[["Return on new capital", roic, setRoic, 2, 40], ["Cost of capital", wacc, setWacc, 4, 16], ["Revenue growth (5 yrs)", g, setG, 0, 40]].map(([l, v, set, mn, mx]) => (
        <label key={l as string} className="block">
          <div className="flex justify-between text-[11px]"><span className="text-muted-foreground">{l as string}</span><span className="font-mono">{(v as number).toFixed(0)}%</span></div>
          <input type="range" min={mn as number} max={mx as number} step={1} value={v as number} onChange={(e) => (set as (n: number) => void)(Number(e.target.value))} className="w-full accent-[hsl(var(--primary))]" />
        </label>
      ))}
      <p className="text-[13px] leading-snug">
        Growing {g}% a year makes this business worth <span className={`font-mono font-semibold ${diff >= 0 ? "text-[hsl(199,85%,70%)]" : "text-[hsl(35,95%,66%)]"}`}>{diff >= 0 ? "+" : "−"}{Math.abs(diff).toFixed(0)}%</span> {diff >= 0 ? "more" : "less"} than not growing at all.
      </p>
      <p className="text-[11.5px] leading-snug text-muted-foreground">
        {roic > wacc + 0.5 ? "New capital earns more than it costs, so every reinvested dollar is worth more than a dollar — growth creates value." : roic < wacc - 0.5 ? "New capital earns less than it costs, so the faster it grows, the more value it destroys. Try raising the return above the cost of capital." : "New capital earns about what it costs: growth just makes the company bigger, not more valuable."}
      </p>
    </div>
  );
}

/** Two companies in the same industry — one proven, one not. Predict before you look. */
function ComparePairs({ rows, onOpen }: { rows: Row[]; onOpen: (s: string) => void }) {
  const pairs = useMemo(() => {
    const byInd = new Map<string, Row[]>();
    for (const r of rows) if (r.industry && r.track !== "young" && r.track !== "financial") { if (!byInd.has(r.industry)) byInd.set(r.industry, []); byInd.get(r.industry)!.push(r); }
    const out: { industry: string; a: Row; b: Row }[] = [];
    for (const [industry, rs] of byInd) {
      const good = rs.filter((r) => GOOD.has(r.label ?? "")).sort((x, y) => (y.score ?? 0) - (x.score ?? 0));
      const weak = rs.filter((r) => r.label === "not_proven").sort((x, y) => (x.median_spread ?? 0) - (y.median_spread ?? 0));
      if (good.length && weak.length) out.push({ industry, a: good[0], b: weak[0] });
    }
    return out.sort((x, y) => x.industry.localeCompare(y.industry));
  }, [rows]);
  const [idx, setIdx] = useState(0);
  const [guess, setGuess] = useState("");
  const [shown, setShown] = useState(false);
  const pair = pairs[idx];
  // show them in a fixed but arbitrary order so the proven one isn't always first
  const [first, second] = useMemo(() => (pair ? (pair.a.symbol < pair.b.symbol ? [pair.a, pair.b] : [pair.b, pair.a]) : [null, null]), [pair]);
  if (!pairs.length || !first || !second) return <p className="text-xs text-muted-foreground">Comparisons appear once enough companies have been scored (the nightly job fills this in).</p>;
  const prof = (r: Row) => ({ margin: med((r.series ?? []).map((s) => s.margin)), turn: med((r.series ?? []).map((s) => s.turnover)) });
  const pa = prof(pair.a), pb = prof(pair.b);
  const route = pa.margin !== null && pb.margin !== null && pa.turn !== null && pb.turn !== null
    ? (pa.margin / Math.max(0.1, pb.margin) >= pa.turn / Math.max(0.01, pb.turn) ? "margin — it keeps much more of each sale (pricing power, differentiation, scale costs)" : "capital efficiency — it needs far less capital for each dollar of sales")
    : null;
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold">Compare two companies</span>
        <select value={idx} onChange={(e) => { setIdx(Number(e.target.value)); setShown(false); setGuess(""); }} className="ml-auto rounded border border-border bg-background px-1.5 py-0.5 text-xs">
          {pairs.map((p, i) => <option key={p.industry} value={i}>{p.industry}</option>)}
        </select>
      </div>
      <p className="text-[12.5px] leading-snug">Both are in <span className="font-semibold">{pair.industry}</span>. One has earned more than its cost of capital for years; the other hasn't. Look at both charts in the Lens if you like — then decide which, and <em>why</em>, before revealing.</p>
      <div className="flex gap-2">
        {[first, second].map((r) => <button key={r.symbol} onClick={() => onOpen(r.symbol)} className="rounded border border-border px-2 py-1 font-mono text-sm font-bold hover:bg-muted/40">{r.symbol}</button>)}
      </div>
      <textarea value={guess} onChange={(e) => setGuess(e.target.value)} rows={2} placeholder="My guess and why…" className="w-full rounded-md border border-border bg-muted/20 p-2 text-[12.5px]" />
      {!shown ? (
        <button onClick={() => setShown(true)} disabled={guess.trim().length < 3} className="rounded-md bg-primary/15 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/25 disabled:opacity-40">Reveal</button>
      ) : (
        <div className="space-y-1.5">
          {[pair.a, pair.b].map((r) => (
            <div key={r.symbol} className="text-[12px] leading-snug"><span className="font-mono font-bold">{r.symbol}</span> <ProvenBadge row={r} short={false} /> <span className="text-muted-foreground">{r.sentence}</span></div>
          ))}
          <div className="grid grid-cols-3 gap-1 text-[11px]">
            <span /> <span className="text-center font-mono">{pair.a.symbol}</span><span className="text-center font-mono">{pair.b.symbol}</span>
            <span className="text-muted-foreground">after-tax margin</span><span className="text-center font-mono">{pa.margin?.toFixed(1) ?? "n/a"}%</span><span className="text-center font-mono">{pb.margin?.toFixed(1) ?? "n/a"}%</span>
            <span className="text-muted-foreground">sales per $ capital</span><span className="text-center font-mono">{pa.turn?.toFixed(2) ?? "n/a"}×</span><span className="text-center font-mono">{pb.turn?.toFixed(2) ?? "n/a"}×</span>
          </div>
          {route && <p className="text-[12.5px] leading-snug"><span className="font-semibold">The principle: </span>return on capital = margin × capital efficiency. {pair.a.symbol} wins mainly on {route}. Same industry, same cost of capital — the difference is the business.</p>}
        </div>
      )}
    </div>
  );
}

/** Proven companies grouped by how they earn their spread. */
function Gallery({ rows, onOpen }: { rows: Row[]; onOpen: (s: string) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) if (GOOD.has(r.label ?? "") && r.archetype) { if (!m.has(r.archetype)) m.set(r.archetype, []); m.get(r.archetype)!.push(r); }
    return [...m.entries()].map(([k, rs]) => [k, rs.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 8)] as const).sort((a, b) => b[1].length - a[1].length);
  }, [rows]);
  if (!groups.length) return <p className="text-xs text-muted-foreground">Proven companies appear here once the nightly job has scored them.</p>;
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
      {groups.map(([k, rs]) => (
        <div key={k} className="rounded-lg border border-border p-3">
          <div className="text-[13px] font-semibold">{ARCHETYPE_TEXT[k] ?? k}</div>
          <div className="mt-1.5 space-y-1">
            {rs.map((r) => (
              <button key={r.symbol} onClick={() => onOpen(r.symbol)} title={r.sentence ?? ""} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-muted/40">
                <span className="w-14 font-mono text-xs font-bold">{r.symbol}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{r.industry}</span>
                <span className="font-mono text-[11px]">{r.median_spread !== null ? `+${r.median_spread.toFixed(0)} pp` : ""}</span>
                <span className="text-[10px] text-muted-foreground">{r.label ? LABEL_TEXT[r.label].replace("Proven · ", "") : ""}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** "Damodaran's ideas" — the principles behind every card in the Lens, taught through real companies. */
export default function IdeasView({ onOpen, active = true }: { onOpen: (symbol: string) => void; active?: boolean }) {
  const rows = useProvenRows(active);
  const [openP, setOpenP] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-[1680px] space-y-6 px-4 py-5 sm:px-6">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-xl font-bold"><Lightbulb size={18} className="text-[hsl(40,90%,60%)]" /> Think like Damodaran</h2>
        <p className="max-w-3xl text-[13px] leading-snug text-muted-foreground">Twelve questions he asks of every company. Each card says where the app shows it. Learn the questions, not the numbers — the questions work on any company, at any age.</p>
      </header>

      <section className="grid items-start gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
        {PRINCIPLES.map((p, i) => {
          const open = openP === p.id;
          return (
            <article key={p.id} className="rounded-lg border border-border p-3">
              <button onClick={() => setOpenP(open ? null : p.id)} className="w-full text-left">
                <div className="text-[10.5px] font-semibold text-muted-foreground">{i + 1}</div>
                <div className="text-[14px] font-semibold leading-snug">{p.question}</div>
              </button>
              {open ? (
                <div className="mt-2 space-y-1.5 text-[12.5px] leading-snug">
                  <p>{p.idea}</p>
                  <p><span className="font-semibold">See it: </span><span className="text-muted-foreground">{p.seeIt}</span></p>
                  <p><span className="font-semibold">The trap: </span><span className="text-muted-foreground">{p.trap}</span></p>
                  <div className="space-y-0.5 pt-1">
                    {p.sources.map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-1 text-[11px] text-primary hover:underline">
                        <ExternalLink size={11} className="mt-0.5 shrink-0" /> {s.title} ({s.date}){s.note ? ` — ${s.note}` : ""}
                      </a>
                    ))}
                  </div>
                </div>
              ) : <button onClick={() => setOpenP(p.id)} className="mt-1 text-[11px] text-primary hover:underline">Open</button>}
            </article>
          );
        })}
      </section>

      <section className="grid items-start gap-3 lg:grid-cols-2">
        <GrowthLab />
        {rows ? <ComparePairs rows={rows} onOpen={onOpen} /> : <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground">Loading companies…</div>}
      </section>

      <section className="space-y-2">
        <h3 className="text-[15px] font-semibold">Proven companies, by how they earn it</h3>
        <p className="max-w-3xl text-[12px] text-muted-foreground">Return on capital = margin × capital efficiency, so there's more than one route to a great business. Click a company to open it in the Lens and see its record. Good companies aren't automatically good investments — check what the price is betting on.</p>
        {rows ? <Gallery rows={rows} onOpen={onOpen} /> : null}
      </section>

      <section className="space-y-2">
        <h3 className="text-[15px] font-semibold">In his own analysis</h3>
        <p className="max-w-3xl text-[12px] text-muted-foreground">Dated snapshots of companies he has written about — his views change as prices do. In the app's words; read the originals.</p>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
          {TAKES.map((t) => (
            <div key={t.date + t.tickers[0]} className="space-y-1.5 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-1">
                {t.tickers.filter((x) => !x.includes(".") && x !== "GOOG").map((x) => <button key={x} onClick={() => onOpen(x)} className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] font-bold hover:bg-muted">{x}</button>)}
                <span className="ml-auto text-[10.5px] text-muted-foreground">{t.date}</span>
              </div>
              <p className="text-[12.5px] leading-snug">{t.text}</p>
              <a href={t.source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"><ExternalLink size={11} /> {t.source.title}</a>
            </div>
          ))}
        </div>
      </section>

      <p className="pb-4 text-[10.5px] text-muted-foreground">Ideas from Aswath Damodaran (NYU Stern), summarised in the app's own words with links to his writing. Educational — not investment advice.</p>
    </div>
  );
}
