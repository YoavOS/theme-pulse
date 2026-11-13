import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, BookOpen, Brain, ChevronDown, ExternalLink, GraduationCap, Info, Loader2, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { useFundamentalsLens, useLensExplanation } from "@/hooks/useFundamentalsLens";
import { PILLAR_INFO, STAGE_ORDER, STAGE_SHORT, type Benchmark, type ConceptCard, type LensPayload, type Lecture, type Metric, type PeerStat } from "@/lib/lens/types";
import { PROGRESS_EVENT, markConcept, readProgress } from "@/lib/lens/progress";
import AdjustCard from "./AdjustCard";
import ReviewView from "./ReviewView";
import { dueQuestions } from "@/lib/lens/review";
import TrackRecordCard from "@/components/proven/TrackRecordCard";
import PriceStoryCard from "./PriceStoryCard";
import ProvenBadge from "@/components/proven/ProvenBadge";
import { useProvenOne } from "@/hooks/useProvenStrength";

/**
 * Fundamentals Lens — a full tab that folds into a narrow side-panel column when its window is narrow; it teaches fundamentals on the stock you're
 * looking at, using Aswath Damodaran's framework: place the company in its life cycle, then read
 * growth, profitability, reinvestment and risk against what's normal for that stage and its peers.
 * Each concept opens in three layers: Basics → Worked example (this company's numbers) → Go deeper
 * (caveats and the lecture where Damodaran teaches it).
 */

const fmtMoney = (v: number | null) => {
  if (v === null || !Number.isFinite(v)) return null;
  const a = Math.abs(v);
  return a >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : a >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : a >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v.toFixed(0)}`;
};

const SHORT: Record<string, string> = {
  rev_growth_ttm: "Revenue growth, 1 yr", rev_growth_q: "Revenue growth, last qtr", rev_cagr_3y: "Revenue growth, 3 yr/yr",
  op_margin: "Operating margin", op_margin_change: "Op. margin change, 1 yr", gross_margin: "Gross margin", net_margin: "Net margin",
  roic: "Return on capital", roe: "Return on equity", fcf_margin: "Free cash flow margin", reinvestment_rate: "Reinvestment rate",
  sales_to_capital: "Sales to capital", sbc_intensity: "Stock comp % of revenue", cash_runway: "Cash runway", share_change: "Share count, 1 yr",
  interest_coverage: "Interest coverage", cash_return_vs_fcf: "Cash returned / FCF", cash_return: "Cash returned, 1 yr",
  excess_return: "Return − cost of capital", equity_spread: "ROE − cost of equity",
};
const TRACK: Record<string, string> = { startup: "Start-up", young_growth: "Young", high_growth: "High", mature_growth: "Mature", mature_stable: "Stable", decline: "Decline" };
const num = (s: string) => { const m = s.replace(/−/g, "-").match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : NaN; };
/** True when the peer rank is based on a figure noticeably different from the one on the card. */
const peerUsesOther = (m: Metric) => {
  if (!m.peer) return false;
  const a = num(m.display), b = num(m.peer.own);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > Math.max(1.5, Math.abs(a) * 0.1);
};

/** Neutral words + colour for a peer position, given whether higher is better for this metric. */
function peerTone(p: PeerStat, higherIsBetter: boolean | null) {
  const words = { top: "top fifth", upper: "above the median", middle: "around the median", lower: "below the median", bottom: "bottom fifth" }[p.position];
  const good = higherIsBetter === null ? null : (p.position === "top" || p.position === "upper") === higherIsBetter && p.position !== "middle";
  const bad = higherIsBetter === null ? null : (p.position === "bottom" || p.position === "lower") === higherIsBetter && p.position !== "middle";
  const cls = good ? "text-[hsl(222,82%,73%)]" : bad ? "text-[hsl(25,90%,64%)]" : "text-[hsl(210,70%,72%)]";
  return { words, cls };
}

function PeerBar({ p, higherIsBetter }: { p: PeerStat; higherIsBetter: boolean | null }) {
  const t = peerTone(p, higherIsBetter);
  return (
    <div className="space-y-0.5" title={`${p.own} vs a median of ${p.median} among ${p.n} ${p.group} companies in the app's universe (data-provider figures). ${p.level !== "sub-industry" ? `Compared at the ${p.level} level — too few peers in the sub-industry.` : ""}`}>
      <div className="relative h-1.5 rounded-full bg-muted/60">
        <div className="absolute inset-y-0 w-px bg-muted-foreground/60" style={{ left: "50%" }} />
        <div className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-foreground" style={{ left: `${Math.min(97, Math.max(3, p.pct))}%` }} />
      </div>
      <div className="flex justify-between gap-2 text-[10.5px] text-muted-foreground">
        <span className={t.cls}>{t.words} of {p.group}</span>
        <span className="whitespace-nowrap font-mono">median {p.median} · n={p.n}</span>
      </div>
    </div>
  );
}

function benchTone(b: Benchmark, higherIsBetter: boolean | null) {
  const words = b.position === "in line" ? `in line with ${b.industry}` : `${b.position} ${b.industry}`;
  const cls = higherIsBetter === null || b.position === "in line" ? "text-[hsl(210,70%,72%)]"
    : (b.position === "above") === higherIsBetter ? "text-[hsl(222,82%,73%)]" : "text-[hsl(25,90%,64%)]";
  return { words, cls };
}

function BenchLine({ b, higherIsBetter, asOf }: { b: Benchmark; higherIsBetter: boolean | null; asOf: string | null }) {
  const t = benchTone(b, higherIsBetter);
  return (
    <div className="space-y-0.5 text-[10.5px] leading-snug">
      <div className="flex justify-between gap-2" title={`Damodaran's aggregate for ${b.industry}${b.n ? ` (${b.n} US firms)` : ""}${asOf ? `, ${asOf} data` : ""}. Whole market: ${b.market ?? "n/a"}.`}>
        <span className={t.cls}>{t.words} avg</span>
        <span className="whitespace-nowrap font-mono text-muted-foreground">industry {b.display}{b.market ? ` · market ${b.market}` : ""}</span>
      </div>
      {b.smallSample && <p className="text-muted-foreground">Only {b.n} firms in this industry — the average is noisy.</p>}
      {b.note && <p className="text-muted-foreground">{b.note}</p>}
    </div>
  );
}

function LectureLink({ l }: { l: Lecture }) {
  return (
    <a href={l.url} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
      <span className={`mt-0.5 shrink-0 rounded px-1 font-mono text-[10px] ${l.course === "Valuation" ? "bg-[hsl(199,85%,62%)]/15 text-[hsl(199,85%,72%)]" : l.course === "Corporate Finance" ? "bg-[hsl(280,70%,66%)]/15 text-[hsl(280,70%,76%)]" : "bg-[hsl(40,90%,55%)]/15 text-[hsl(40,90%,68%)]"}`}>
        {l.course === "Valuation" ? "VAL" : l.course === "Corporate Finance" ? "CF" : "CLC"}{l.session ? ` ${l.session}` : ""}
      </span>
      <span className="min-w-0 text-xs leading-snug">
        <span className="group-hover:underline">{l.title}</span>
        {l.inferred && <span className="ml-1 text-[10px] text-muted-foreground">(placement inferred)</span>}
      </span>
      <ExternalLink size={11} className="ml-auto mt-0.5 shrink-0 text-muted-foreground" />
    </a>
  );
}

function Explain({ symbol, conceptId, label }: { symbol: string; conceptId: string; label: string }) {
  const { exp, loading, run } = useLensExplanation(symbol, conceptId);
  if (!exp) {
    return (
      <button onClick={run} disabled={loading} className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50">
        {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {label}
      </button>
    );
  }
  if (exp.error) return <p className="text-xs text-loss-medium">{exp.error}</p>;
  return (
    <div className="space-y-1.5 rounded-md border border-primary/25 bg-primary/[0.05] p-2.5">
      {exp.sentences.map((s, i) => <p key={i} className="text-[13px] leading-snug">{s.text}</p>)}
      {exp.missing.length > 0 && <p className="text-[11px] text-muted-foreground">Missing for a full picture: {exp.missing.join("; ")}</p>}
      <p className="text-[10.5px] text-muted-foreground">
        {exp.source === "model" ? "AI-written from the numbers on this card — every figure was checked against them." : "Plain summary (the AI explanation wasn't available or didn't pass the number check)."}
      </p>
    </div>
  );
}

function MetricLine({ m, higherIsBetter, asOf }: { m: Metric; higherIsBetter: boolean | null; asOf: string | null }) {
  return (
    <div className="space-y-1 py-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted-foreground">{m.label}{m.approx && <span title="Uses a fallback figure or assumption — see the worked example"> *</span>}</span>
        <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">{m.display}</span>
      </div>
      {m.peer && <PeerBar p={m.peer} higherIsBetter={higherIsBetter} />}
      {m.peer && peerUsesOther(m) && (
        <p className="text-[10.5px] leading-snug text-muted-foreground">The peer rank uses the data provider's figure ({m.peer.own}) so every company is measured the same way; the {m.display} above is computed from the filings. Definitions differ slightly.</p>
      )}
      {m.bench && <BenchLine b={m.bench} higherIsBetter={higherIsBetter} asOf={asOf} />}
      {m.note && <p className="text-[11px] leading-snug text-[hsl(40,90%,66%)]">{m.note}</p>}
    </div>
  );
}

/** Damodaran's view of the industry: what capital costs there and how it differs from the market. */
function IndustryCard({ p }: { p: LensPayload }) {
  const [open, setOpen] = useState(false);
  const d = p.damodaran;
  if (!d || d.match === "market") return null;
  const contrasts = ["gross_margin", "op_margin", "roic", "sales_to_capital", "reinvestment_rate", "debt_to_capital"]
    .map((id) => p.cards.flatMap((c) => c.metrics).find((m) => m.id === id))
    .filter((m): m is Metric => !!m?.bench?.market);
  const how = d.match === "damodaran" ? "Damodaran's own classification of this company"
    : `Mapped by the app from "${d.from}"${d.confidence === "approx" ? " — nearest of his groups, a judgement call" : ""}`;
  return (
    <section className="rounded-lg border border-[hsl(199,85%,62%)]/30 bg-[hsl(199,85%,62%)]/[0.04] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(199,85%,72%)]">Industry context</span>
        <span className="text-[10.5px] text-muted-foreground">Damodaran · {d.asOf}</span>
      </div>
      <p className="mt-1 text-[13px] leading-snug"><span className="font-semibold">{d.name}</span>{d.n ? <span className="text-muted-foreground"> · {d.n} US firms</span> : null}</p>
      <p className="text-[10.5px] text-muted-foreground">{how}.</p>
      <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
        {[["Cost of capital", d.costOfCapital, d.marketCostOfCapital ? `market ${d.marketCostOfCapital}` : null], ["Beta", d.beta, "market 1.00"], ["Losing money", d.pctMoneyLosing, "of firms"]].map(([k, v, sub]) => (
          <div key={k} className="rounded-md bg-muted/25 px-1 py-1.5">
            <div className="text-[10px] text-muted-foreground">{k}</div>
            <div className="font-mono text-[13px] font-semibold tabular-nums">{v ?? "—"}</div>
            {sub && <div className="text-[9.5px] text-muted-foreground">{sub}</div>}
          </div>
        ))}
      </div>
      {d.costOfCapital && !p.financial && (
        <p className="mt-2 text-[12px] leading-snug">The hurdle: a business in this industry adds value only if its return on capital beats about <span className="font-mono">{d.costOfCapital}</span>, what investors require for its risk.</p>
      )}
      {d.costOfEquity && p.financial && (
        <p className="mt-2 text-[12px] leading-snug">The hurdle for a financial company is on equity: return on equity has to beat about <span className="font-mono">{d.costOfEquity}</span>, the industry's cost of equity.</p>
      )}
      {contrasts.length > 0 && (
        <>
          <button onClick={() => setOpen(!open)} className="mt-1.5 flex items-center gap-1 text-[11.5px] text-[hsl(199,85%,72%)] hover:underline">
            How this industry differs from the market <ChevronDown size={12} className={open ? "rotate-180" : ""} />
          </button>
          {open && (
            <div className="mt-1 space-y-0.5">
              {contrasts.map((m) => (
                <div key={m.id} className="flex justify-between gap-2 text-[11.5px]">
                  <span className="text-muted-foreground">{SHORT[m.id] ?? m.label}</span>
                  <span className="whitespace-nowrap font-mono tabular-nums">{m.bench!.display} <span className="text-muted-foreground">vs {m.bench!.market}</span></span>
                </div>
              ))}
              <p className="pt-1 text-[10.5px] leading-snug text-muted-foreground">Industry vs whole-market averages. Each concept card below explains why numbers like these differ between industries, and compares {p.symbol} with both.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ConceptView({ c, symbol, stageLabel, seen, asOf = null }: { c: ConceptCard; symbol: string; stageLabel: string | null; seen: boolean; asOf?: string | null }) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<1 | 2 | 3>(1);
  const [revealed, setRevealed] = useState(false);
  const prim = c.metrics.find((m) => m.id === c.primary) ?? c.metrics[0];
  const toggle = () => { const o = !open; setOpen(o); if (o) markConcept(c.id, symbol, 1); };
  const pick = (l: 1 | 2 | 3) => { setLevel(l); markConcept(c.id, symbol, l); };
  const tone = prim?.peer ? { ...peerTone(prim.peer, c.higherIsBetter), words: `${peerTone(prim.peer, c.higherIsBetter).words} of ${prim.peer.group}` }
    : prim?.bench ? { ...benchTone(prim.bench, c.higherIsBetter), words: `${benchTone(prim.bench, c.higherIsBetter).words} avg` } : null;
  return (
    <div className="border-b border-border/50 last:border-0">
      <button onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/30">
        {!seen && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" title="Not opened yet" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{c.title}</span>
          {tone && <span className={`block truncate text-[10.5px] ${tone.cls}`}>{tone.words}</span>}
        </span>
        {prim && <span className="shrink-0 font-mono text-sm tabular-nums">{prim.display}</span>}
        <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3 px-3 pb-3">
          <div className="inline-flex rounded-md border border-border p-0.5 text-[11px]" role="tablist">
            {([[1, "Basics"], [2, "Worked example"], [3, "Go deeper"]] as const).map(([l, t]) => (
              <button key={l} role="tab" aria-selected={level === l} onClick={() => pick(l)}
                className={`rounded px-2 py-0.5 font-medium ${level === l ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>{t}</button>
            ))}
          </div>

          {level === 1 && (
            <div className="space-y-2.5 text-[13px] leading-snug">
              <div className="rounded-md bg-muted/30 p-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Think first</div>
                <p className="mt-0.5 italic">{c.question}</p>
                {!revealed && <button onClick={() => setRevealed(true)} className="mt-1 text-[11px] text-primary hover:underline">I've thought about it — show me</button>}
              </div>
              {(revealed || c.metrics.length === 0) && <>
                <p>{c.what}</p>
                <p className="text-foreground/85">{c.why}</p>
              </>}
              {c.metrics.length > 0 && (
                <div className="rounded-md border border-border/60 px-2.5">
                  <div className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{symbol}</div>
                  {c.metrics.map((m) => <MetricLine key={m.id} m={m} higherIsBetter={c.higherIsBetter} asOf={asOf} />)}
                </div>
              )}
              {c.stageNote && stageLabel && <p><span className="font-semibold text-[hsl(40,90%,66%)]">At the {stageLabel} stage: </span>{c.stageNote}</p>}
              {c.industry && <p className="text-foreground/85"><span className="font-semibold">Why industries differ: </span>{c.industry}</p>}
              {c.metrics.length > 0 && <Explain symbol={symbol} conceptId={c.id} label={`What this means for ${symbol}`} />}
            </div>
          )}

          {level === 2 && (
            <div className="space-y-3">
              {c.metrics.length === 0 && <p className="text-xs text-muted-foreground">This is a framework concept — see the Basics and the lecture.</p>}
              {c.metrics.map((m) => (
                <div key={m.id} className="rounded-md border border-border/60 p-2.5 text-xs">
                  <div className="font-semibold">{m.label}</div>
                  <div className="mt-0.5 text-muted-foreground">{m.formula}</div>
                  {m.inputs.length > 0 && (
                    <table className="mt-1.5 w-full">
                      <tbody>
                        {m.inputs.map((x) => <tr key={x.label}><td className="py-0.5 pr-2 text-muted-foreground">{x.label}</td><td className="py-0.5 text-right font-mono tabular-nums">{x.display}</td></tr>)}
                        <tr className="border-t border-border/60"><td className="pt-1 font-semibold">= {m.label}</td><td className="pt-1 text-right font-mono font-semibold tabular-nums">{m.display}</td></tr>
                      </tbody>
                    </table>
                  )}
                  <div className="mt-1 text-[10.5px] text-muted-foreground">{m.period}</div>
                  {m.note && <p className="mt-1 text-[11px] text-[hsl(40,90%,66%)]">{m.note}</p>}
                </div>
              ))}
            </div>
          )}

          {level === 3 && (
            <div className="space-y-2.5">
              {c.caveats.length > 0 && (
                <ul className="list-disc space-y-1 pl-4 text-[12.5px] leading-snug text-foreground/90">
                  {c.caveats.map((x) => <li key={x}>{x}</li>)}
                </ul>
              )}
              <div>
                <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Where Damodaran teaches this</div>
                {c.lectures.map((l) => <LectureLink key={l.title + l.session} l={l} />)}
                <p className="px-2 text-[10.5px] text-muted-foreground">Spring 2025 recordings · links open the full session on YouTube.</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StageCard({ p }: { p: LensPayload }) {
  const [open, setOpen] = useState(false);
  const lc = p.lifeCycle!;
  const idx = STAGE_ORDER.indexOf(lc.stage), lean = lc.leaning ? STAGE_ORDER.indexOf(lc.leaning) : -1;
  return (
    <section className="rounded-lg border border-[hsl(40,90%,55%)]/35 bg-[hsl(40,90%,55%)]/[0.05]">
      <button onClick={() => { setOpen(!open); if (!open) markConcept("life_cycle", p.symbol, 1); }} className="w-full px-3 py-2.5 text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(40,90%,66%)]">Life-cycle stage</span>
          <span className="text-[10.5px] text-muted-foreground">app rule of thumb · {lc.confidence} confidence</span>
        </div>
        <div className="mt-1.5 flex items-center gap-1" aria-label={`Stage: ${lc.label}`}>
          {STAGE_ORDER.map((s, i) => (
            <div key={s} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className={`h-1.5 w-full rounded-full ${i === idx ? "bg-[hsl(40,90%,58%)]" : i === lean ? "bg-[hsl(40,90%,58%)]/40" : "bg-muted/60"}`} />
              <span className={`truncate text-[9.5px] ${i === idx ? "font-semibold text-foreground" : "text-muted-foreground"}`} title={STAGE_SHORT[s]}>{TRACK[s]}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[13px] leading-snug"><span className="font-semibold">{lc.label}{lc.leaningLabel ? `, leaning ${lc.leaningLabel}` : ""}.</span> The question that matters most: <span className="italic">{lc.question}</span></p>
        <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary">{open ? "Less" : "How it was placed, and what's normal here"} <ChevronDown size={12} className={open ? "rotate-180" : ""} /></span>
      </button>
      {open && (
        <div className="space-y-2.5 border-t border-[hsl(40,90%,55%)]/20 px-3 py-2.5 text-[12.5px] leading-snug">
          <p><span className="font-semibold">Typical numbers: </span>{lc.signature}</p>
          <p><span className="font-semibold">How the market prices it: </span>{lc.pricing}</p>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">The signals used</div>
            <ul className="mt-1 space-y-0.5">
              {lc.signals.map((s) => (
                <li key={s.id} className="flex justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className={`font-mono ${s.points.includes(lc.stage) ? "" : "text-muted-foreground line-through decoration-dotted"}`} title={`Points to: ${s.points.map((x) => STAGE_SHORT[x]).join(", ")}`}>{s.display}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[10.5px] text-muted-foreground">Damodaran sorts companies by age, industry and operating numbers but gives no numeric cut-offs — these thresholds are the app's. Crossed-out signals point to a different stage.</p>
          </div>
          {lc.lectures.map((l) => <LectureLink key={l.title + l.session} l={l} />)}
        </div>
      )}
    </section>
  );
}

/** Width-driven layout: the panel measures itself, so it adapts to the window you drag around. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((es) => setW(Math.round(es[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}
const WIDE = 980;        // two columns: overview left, concepts right
const VERY_WIDE = 1440;  // concepts in two columns

export default function LensPanel({ symbol: symbolProp, onSymbolChange, onClose, compactHeader, homeLink }: {
  symbol: string | null;
  onSymbolChange?: (s: string) => void;
  onClose?: () => void;
  compactHeader?: boolean;
  /** Show a link back to the dashboard (full-tab use, wide windows only). */
  homeLink?: boolean;
}) {
  const [rootRef, width] = useWidth<HTMLDivElement>();
  const wide = width >= WIDE;
  const veryWide = width >= VERY_WIDE;
  const [own, setOwn] = useState<string | null>(symbolProp);
  useEffect(() => { setOwn(symbolProp); }, [symbolProp]);
  const symbol = own;
  const [input, setInput] = useState(symbolProp ?? "");
  useEffect(() => { setInput(symbolProp ?? ""); }, [symbolProp]);
  const { data, loading, error, refresh } = useFundamentalsLens(symbol);
  const proven = useProvenOne(data?.symbol ?? null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState(readProgress);
  useEffect(() => {
    const on = () => setProgress(readProgress());
    window.addEventListener(PROGRESS_EVENT, on);
    return () => window.removeEventListener(PROGRESS_EVENT, on);
  }, []);
  // "/" focuses the ticker box (when not typing elsewhere)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))) { e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  const submit = () => { const s = input.trim().toUpperCase(); if (!s) return; setOwn(s); onSymbolChange?.(s); };

  const byId = useMemo(() => new Map((data?.cards ?? []).flatMap((c) => c.metrics.map((m) => [m.id, { m, c }] as const))), [data]);
  const totalConcepts = (data?.cards.length ?? 0) + (data?.foundations.length ?? 0);
  const seenCount = data ? [...data.cards, ...data.foundations].filter((c) => progress[c.id]).length : 0;
  const pillars = Object.keys(PILLAR_INFO) as (keyof typeof PILLAR_INFO)[];
  const stageLabel = data?.lifeCycle?.label ?? null;
  const [reviewing, setReviewing] = useState(false);
  const [reviewTick, setReviewTick] = useState(0);
  const opened = useMemo(() => new Set(Object.keys(progress)), [progress]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dueCount = useMemo(() => dueQuestions(opened).length, [opened, reviewTick]);
  const dm = data?.damodaran && data.damodaran.match !== "market" ? data.damodaran : null;
  const asOf = dm?.asOf ?? null;

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-background text-foreground">
      {/* Header */}
      <div className={`sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur ${wide ? "px-6 py-3" : "px-3 py-2"}`}>
        <div className={`flex items-center gap-1.5 ${wide ? "mx-auto max-w-[1680px]" : ""}`}>
          {homeLink && wide && (
            <Link to="/" title="Back to Dashboard" className="mr-1 rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><ArrowLeft size={15} /></Link>
          )}
          <GraduationCap size={wide ? 20 : 15} className="shrink-0 text-[hsl(40,90%,60%)]" />
          {!compactHeader && <span className={`mr-1 font-semibold ${wide ? "mr-4 font-['Syne',sans-serif] text-2xl font-bold tracking-tight" : "text-[13px]"}`}>Fundamentals Lens</span>}
          <form className={`flex min-w-0 items-center gap-1 ${wide ? "w-72" : "flex-1"}`} onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <span className="relative min-w-0 flex-1">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} placeholder="Ticker  ( / )" aria-label="Ticker"
                className="h-7 w-full rounded-md border border-border bg-muted/30 pl-6 pr-2 font-mono text-[13px] uppercase" />
            </span>
          </form>
          <button onClick={() => refresh()} disabled={!symbol || loading} title="Recompute from the latest filings" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
          <button onClick={() => { setReviewing(!reviewing); setReviewTick((t) => t + 1); }} title="Review what you've learned (spaced repetition)"
            className={`relative rounded p-1 hover:bg-muted hover:text-foreground ${reviewing ? "text-primary" : "text-muted-foreground"}`}>
            <Brain size={14} />
            {dueCount > 0 && !reviewing && <span className="absolute -right-1 -top-1 min-w-[14px] rounded-full bg-primary px-0.5 text-center text-[9px] font-bold leading-[14px] text-primary-foreground">{dueCount > 9 ? "9+" : dueCount}</span>}
          </button>
          {onClose && <button onClick={onClose} aria-label="Close" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X size={14} /></button>}
        </div>
        {data && (
          <div className={`mt-1.5 space-y-1 ${wide ? "mx-auto max-w-[1680px]" : ""}`}>
            <div className="flex items-baseline gap-2">
              <span className={`font-mono font-bold ${wide ? "text-xl" : "text-base"}`}>{data.symbol}</span>
              <span className={`min-w-0 truncate text-muted-foreground ${wide ? "text-sm" : "text-xs"}`}>{data.company}</span>
            </div>
            <div className="flex flex-wrap gap-1 text-[10.5px]">
              <span className="rounded bg-muted/50 px-1.5 py-0.5" title={`${data.classification.sector} › ${data.classification.industry} › ${data.classification.subIndustry}`}>{data.classification.subIndustry !== "Other" ? data.classification.subIndustry : data.classification.industry}</span>
              {dm && <span className="rounded bg-[hsl(199,85%,62%)]/15 px-1.5 py-0.5 text-[hsl(199,85%,72%)]" title={`Damodaran industry group (${dm.asOf})`}>{dm.name}</span>}
              {data.lifeCycle && <span className="rounded bg-[hsl(40,90%,55%)]/15 px-1.5 py-0.5 text-[hsl(40,90%,68%)]">{data.lifeCycle.label}</span>}
              {proven.row?.status === "ok" && <ProvenBadge row={proven.row} short={false} className="!text-[10.5px] !font-normal py-0.5" />}
              {fmtMoney(data.market.marketCap) && <span className="rounded bg-muted/50 px-1.5 py-0.5 font-mono">cap {fmtMoney(data.market.marketCap)}</span>}
              {data.sec.asOf && <span className="rounded bg-muted/50 px-1.5 py-0.5" title={data.sec.filed ? `Filed ${data.sec.filed}` : undefined}>filings to {data.sec.asOf}</span>}
            </div>
          </div>
        )}
      </div>

      {/* Body */}
      <div className={`min-h-0 flex-1 overflow-y-auto ${wide ? "px-6 py-5" : "px-3 py-3"}`}>
       <div className={`space-y-3 ${wide ? "mx-auto max-w-[1680px]" : ""}`}>
        {reviewing && <div className={wide ? "mx-auto max-w-2xl" : ""}><ReviewView opened={opened} payload={data} onExit={() => { setReviewing(false); setReviewTick((t) => t + 1); }} /></div>}
        {!reviewing && <>
        {!symbol && (
          <div className="space-y-2 py-6 text-center text-sm text-muted-foreground">
            <BookOpen size={22} className="mx-auto opacity-60" />
            <p>Enter a ticker to read its fundamentals — and learn what each number means.</p>
          </div>
        )}
        {loading && !data && <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Reading {symbol}'s filings…</div>}
        {error && <p className="rounded-md border border-loss-medium/40 bg-loss-medium/10 p-2 text-sm text-loss-medium">{symbol}: {error}</p>}

        {data && (
          <>
           <div className={wide ? "grid items-start gap-5" : "space-y-3"} style={wide ? { gridTemplateColumns: "minmax(380px, 460px) minmax(0, 1fr)" } : undefined}>
            {/* Overview: who the company is and where it stands */}
            <div className="space-y-3">
            {data.sec.status !== "ok" && <p className="flex gap-1.5 rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground"><Info size={13} className="mt-px shrink-0" />{data.sec.status}</p>}
            {data.financial && <p className="flex gap-1.5 rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground"><Info size={13} className="mt-px shrink-0" />A financial company: debt is part of how it makes money, so ROIC, free cash flow and coverage are left out — ROE is the main return measure here.</p>}

            {/* Story */}
            {data.story.length > 0 && (
              <section className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">The story in numbers</div>
                <div className="space-y-1 text-[13px] leading-snug">{data.story.map((s) => <p key={s}>{s}</p>)}</div>
                <Explain symbol={data.symbol} conceptId="story" label="Explain it in plain words" />
              </section>
            )}

            {/* Snapshot: the numbers that matter most at this stage */}
            {data.snapshot.length > 0 && (
              <section>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What matters most{stageLabel ? ` for a ${stageLabel} company` : ""}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {data.snapshot.map((id) => {
                    const hit = byId.get(id);
                    if (!hit) return null;
                    return (
                      <div key={id} className="rounded-md border border-border/60 bg-muted/20 p-2">
                        <div className="truncate text-[10.5px] text-muted-foreground" title={hit.m.label}>{SHORT[id] ?? hit.m.label}</div>
                        <div className="font-mono text-[15px] font-semibold tabular-nums">{hit.m.display}</div>
                        {hit.m.peer && <div className={`truncate text-[10px] ${peerTone(hit.m.peer, hit.c.higherIsBetter).cls}`}>{peerTone(hit.m.peer, hit.c.higherIsBetter).words}</div>}
                        {hit.m.bench && <div className="truncate text-[10px] text-muted-foreground" title={`${hit.m.bench.industry} average (Damodaran)`}>industry {hit.m.bench.display}</div>}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {data.lifeCycle && <StageCard p={data} />}
            <TrackRecordCard row={proven.row} loading={proven.loading} />
            {data.valuation && <PriceStoryCard key={data.symbol} p={data} proven={proven.row} />}
            <IndustryCard p={data} />

            {/* Foundations */}
            <section className="rounded-lg border border-border">
              <div className="flex items-center justify-between px-3 pt-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Start here</span>
                <span className="text-[10.5px] text-muted-foreground">{seenCount}/{totalConcepts} concepts explored</span>
              </div>
              {data.foundations.map((c) => <ConceptView key={c.id} c={c} symbol={data.symbol} stageLabel={stageLabel} seen={!!progress[c.id]} asOf={asOf} />)}
            </section>
            </div>

            {/* Concepts, by pillar */}
            <div className={veryWide ? "columns-2 gap-3" : "space-y-3"}>

            {/* Pillars */}
            {pillars.map((pk) => {
              const cards = data.cards.filter((c) => c.pillar === pk);
              if (!cards.length) return null;
              return (
                <div key={pk} className={`space-y-3 ${veryWide ? "mb-3 break-inside-avoid" : ""}`}>
                <section className="rounded-lg border border-border">
                  <div className="px-3 pt-2">
                    <div className="text-[13px] font-semibold">{PILLAR_INFO[pk].label}</div>
                    <div className="text-[11px] text-muted-foreground">{PILLAR_INFO[pk].question}</div>
                  </div>
                  <div className="mt-1">{cards.map((c) => <ConceptView key={c.id} c={c} symbol={data.symbol} stageLabel={stageLabel} seen={!!progress[c.id]} asOf={asOf} />)}</div>
                </section>
                {pk === "profitability" && data.adjust && <AdjustCard a={data.adjust} symbol={data.symbol} />}
                </div>
              );
            })}
            </div>
           </div>

            <footer className={`space-y-1 pb-2 text-[10.5px] leading-snug text-muted-foreground ${wide ? "pt-2" : ""}`}>
              <p>Company numbers: SEC filings ({data.sec.ttmLabel}), computed by the app. Peer comparisons: data-provider figures for companies in the app's universe. Market cap{data.market.asOf ? ` as of ${data.market.asOf.slice(0, 10)}` : ""}.</p>
              {dm && <p>Industry averages: Aswath Damodaran, <a href={dm.source} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">NYU Stern data</a> ({dm.asOf}, US firms), shared freely by him. They're a year-start snapshot, so they lag the company's latest quarters.</p>}
              <p>Framework and lectures: Aswath Damodaran, NYU Stern (Valuation and Corporate Finance, Spring 2025). Summaries are the app's own words. Educational — not investment advice.</p>
            </footer>
          </>
        )}
        </>}
       </div>
      </div>
    </div>
  );
}
