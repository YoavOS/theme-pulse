import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { LensPayload } from "@/lib/lens/types";
import { useFundamentalsLens } from "@/hooks/useFundamentalsLens";
import { useIndustryPeers } from "@/hooks/useIndustryPeers";
import { hePayload } from "@/lib/lens/he/payload";
import { candidates, compareStory, quarterSeries, scorecard, size, tally, whatItTakes, type Candidate, type Group, type Momentum, type QPoint, type Role, type Row, type Side } from "@/lib/lens/compare";
import { technicals, type Bars } from "@/lib/portfolio/engine";
import { openChart } from "@/lib/chart";
import { Hero, Panel, SectionHead, Watch, type Kpi } from "./LensUI";
import { AutoTerms } from "./Term";
import { useT } from "./TabHeroes";
import { CHART } from "./QuarterlyChart";

/**
 * "vs Leader" — the stock next to the leader of its industry (the Industry Leaders panel's
 * fundamental #1 by default; any other company on request). Same design as the Company story.
 */
export const COL_A = "hsl(222,82%,66%)";
export const COL_B = "hsl(40,90%,58%)";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const toBars = (r: { d: string[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] }): Bars => ({ d: r.d, o: r.o.map(Number), h: r.h.map(Number), l: r.l.map(Number), c: r.c.map(Number), v: r.v.map(Number) });

function useMarketSide(symbols: string[]) {
  const key = symbols.join(",");
  const [state, setState] = useState<{ ctx: Record<string, Momentum>; bars: Record<string, Bars> }>({ ctx: {}, bars: {} });
  useEffect(() => {
    if (!symbols.length) return;
    let live = true;
    (async () => {
      const [c, b] = await Promise.all([db.rpc("portfolio_context", { syms: symbols }), db.rpc("portfolio_bars", { syms: symbols, n: 520 })]);
      const bars: Record<string, Bars> = {};
      for (const r of b.data ?? []) bars[r.symbol] = toBars(r);
      const ctx: Record<string, Momentum> = {};
      for (const s of symbols) {
        const r = (c.data ?? []).find((x: { symbol: string }) => x.symbol === s);
        const t = technicals(bars[s] ?? null, null);
        ctx[s] = { rs_rating: r?.rs_rating ?? null, stage: r?.stage ?? null, substage: r?.substage ?? null, return_1m: r?.return_1m ?? null, return_3m: r?.return_3m ?? null, fromHigh: t?.fromHigh ?? null };
      }
      if (live) setState({ ctx, bars });
    })().catch(() => null);
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

const ROLE: Record<Role, [string, string]> = { fundamental: ["Fundamental #1", "מובילה ביסודות"], largest: ["Largest", "הגדולה ביותר"], rs: ["Strongest RS", "RS החזק ביותר"], runner_up: ["Runner-up (you lead)", "השנייה (את מובילה)"] };

export default function CompareView({ p }: { p: LensPayload }) {
  const { he, t } = useT();
  const peers = useIndustryPeers(p.symbol);
  const cands = useMemo(() => candidates(p.symbol, peers.peers), [p.symbol, peers.peers]);
  const memKey = `vs-leader:${peers.group ?? p.classification.industry}`;
  const [picked, setPicked] = useState<string | null>(() => { try { return localStorage.getItem(memKey); } catch { return null; } });
  useEffect(() => { try { setPicked(localStorage.getItem(memKey)); } catch { /* ignore */ } }, [memKey]);
  const leader = (picked && picked !== p.symbol ? picked : null) ?? cands[0]?.symbol ?? null;
  const choose = (s: string) => { const v = s.toUpperCase(); setPicked(v); try { localStorage.setItem(memKey, v); } catch { /* ignore */ } };
  const [q, setQ] = useState("");

  const L = useFundamentalsLens(leader);
  const lp = useMemo(() => (L.data && he ? hePayload(L.data) : L.data), [L.data, he]);
  const market = useMarketSide(leader ? [p.symbol, leader] : [p.symbol]);
  const A: Side = { p, m: market.ctx[p.symbol] ?? null };
  const B: Side | null = lp ? { p: lp, m: market.ctx[lp.symbol] ?? null } : null;
  const groups = useMemo(() => (B ? scorecard(A, B, he) : []), [A.p, A.m, B?.p, B?.m, he]); // eslint-disable-line react-hooks/exhaustive-deps

  const picker = (
    <Panel eyebrow={t("Compared with", "בהשוואה ל־")} title={peers.group ? t(`Leaders of ${peers.group}`, `המובילות של ${peers.group}`) : t("Pick a company", "בחירת חברה")}>
      {peers.loading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" />{t("Ranking the industry…", "מדרגים את הענף…")}</p> : (
        <div className="space-y-3">
          {!peers.inUniverse && <p className="text-sm text-muted-foreground">{t(`${p.symbol} isn't in the RS universe, so there's no industry ranking for it — pick a company to compare with.`, `‏${p.symbol} לא נמצאת ביקום ה־RS, ולכן אין לה דירוג ענפי — אפשר לבחור חברה להשוואה.`)}</p>}
          <div className="flex flex-wrap gap-2">
            {cands.map((c: Candidate) => (
              <button key={c.symbol} onClick={() => choose(c.symbol)} aria-pressed={leader === c.symbol}
                className={`rounded-xl border px-3 py-2 text-start transition-colors ${leader === c.symbol ? "border-primary/60 bg-primary/15" : "border-border hover:bg-muted/40"}`}>
                <p className="flex items-baseline gap-2"><span className="font-mono text-sm font-semibold">{c.symbol}</span>{c.rank != null && <span className="text-[11px] text-muted-foreground">#{c.rank} {t("of", "מתוך")} {c.ranked}</span>}</p>
                <p className="text-[11px] text-primary">{c.roles.length ? c.roles.map((r) => (he ? ROLE[r][1] : ROLE[r][0])).join(" · ") : t("Next in the ranking", "הבאה בדירוג")}</p>
                <p className="max-w-[180px] truncate text-[11px] text-muted-foreground">{[c.company, c.score != null ? `${t("score", "ציון")} ${c.score}` : null, c.rsRating != null ? `RS ${c.rsRating}` : null].filter(Boolean).join(" · ")}</p>
              </button>
            ))}
            <form onSubmit={(e) => { e.preventDefault(); if (/^[A-Za-z][A-Za-z0-9.-]{0,9}$/.test(q.trim())) { choose(q.trim()); setQ(""); } }}
              className="flex items-center gap-1.5 self-stretch rounded-xl border border-dashed border-border px-3">
              <Search size={13} className="text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Any ticker…", "כל סימול…")} className="w-24 bg-transparent font-mono text-sm uppercase outline-none" dir="ltr" />
            </form>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("Fundamental #1 is the Industry Leaders panel's top score (growth, trend, quality, strength — ranked within the industry). Your choice is remembered for this industry.", "מובילה ביסודות = הציון הגבוה בפאנל מובילי הענפים (צמיחה, מגמה, איכות, חוזק — בדירוג בתוך הענף). הבחירה נשמרת לענף הזה.")}</p>
        </div>
      )}
    </Panel>
  );

  if (!leader) return <div className="space-y-5">{picker}</div>;
  if (L.error) return <div className="space-y-5">{picker}<Watch>{t(`Couldn't load ${leader}: ${L.error}`, `לא ניתן לטעון את ${leader}: ${L.error}`)}</Watch></div>;
  if (!B) return <div className="space-y-5">{picker}<p className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 size={15} className="animate-spin" />{t(`Loading ${leader}'s fundamentals (the first time takes a little longer)…`, `טוענים את היסודות של ${leader} (בפעם הראשונה זה לוקח קצת יותר)…`)}</p></div>;

  const a = p.symbol, b = B.p.symbol;
  const story = compareStory(A, B, groups, he);
  const tl = tally(groups, "business", he), tp = tally(groups, "price", he);
  const sz = size(A, B);
  const kpis: Kpi[] = [
    { label: t("Business measures ahead", "מדדי עסק בהובלה"), value: `${tl.aWins} : ${tl.bWins}`, caption: t(`${a} : ${b}${tl.ties ? `, ${tl.ties} even` : ""}`, `${a} : ${b}${tl.ties ? `, ${tl.ties} שווים` : ""}`), tone: "neutral" },
    { label: t("Size (revenue)", "גודל (הכנסות)"), value: sz.revX == null ? "—" : sz.revX >= 1 ? `${sz.revX.toFixed(sz.revX >= 10 ? 0 : 1)}×` : `1/${(1 / sz.revX).toFixed(1)}`, caption: t(`${b} vs ${a}`, `${b} מול ${a}`), tone: "neutral" },
    { label: t("Cheaper on price", "זולה יותר במחיר"), value: tp.compared ? (tp.aWins > tp.bWins ? a : tp.bWins > tp.aWins ? b : t("Even", "שקול")) : "—", caption: tp.compared ? t(`${tp.aWins} : ${tp.bWins} of the price measures`, `${tp.aWins} : ${tp.bWins} ממדדי המחיר`) : undefined, tone: "neutral" },
    { label: t("3-month return gap", "פער תשואה, 3 חודשים"), value: A.m?.return_3m != null && B.m?.return_3m != null ? `${A.m.return_3m - B.m.return_3m >= 0 ? "+" : "−"}${Math.abs(A.m.return_3m - B.m.return_3m).toFixed(0)} ${he ? "נק׳" : "pts"}` : "—", caption: t(`${a} minus ${b}`, `${a} פחות ${b}`) },
  ];

  return (
    <div className="space-y-5">
      <Hero eyebrow={`${t("vs Leader", "מול המוביל")} · ${a} ${t("vs", "מול")} ${b}`} title={story.title}
        meta={`${p.company ?? a} · ${B.p.company ?? b}${peers.group ? ` · ${peers.group}` : ""}`}
        aside={{ title: t("Head to head", "ראש בראש"), subtitle: t("Counted only where both have the number", "נספר רק כשלשתיהן יש מספר"), items: kpis }}
        steps={[
          { label: t("01 · Scorecard", "01 · כרטיס ניקוד"), question: t("Who is ahead, measure by measure?", "מי מקדימה, מדד אחרי מדד?"), target: "cmp-score" },
          { label: t("02 · Trends", "02 · מגמות"), question: t("Is the gap closing?", "האם הפער נסגר?"), target: "cmp-trends" },
          { label: t("03 · Price race", "03 · מרוץ המחיר"), question: t("Which stock is winning lately?", "איזו מניה מנצחת לאחרונה?"), target: "cmp-race" },
        ]}>
        {story.paras.map((s, i) => <p key={i} className={i === story.paras.length - 1 && story.paras.length > 2 ? "text-muted-foreground" : ""}><AutoTerms text={s} /></p>)}
      </Hero>

      {picker}
      {(A.p.financial !== B.p.financial) && <Watch>{t("One is a bank and the other isn't — margins, ROIC and cash-flow measures don't line up, so those rows are mostly blank. ROE and the price rows still compare.", "אחת בנק והשנייה לא — מרווחים, ROIC ותזרים אינם ברי השוואה, ולכן רוב השורות האלה ריקות. ROE ושורות המחיר עדיין משתוות.")}</Watch>}

      <SectionHead id="cmp-score" title={t("The scorecard", "כרטיס הניקוד")} subtitle={t(`Each row: ${a} on one side, ${b} on the other; the coloured side is ahead. Industry median where the app has one.`, `כל שורה: ${a} בצד אחד, ${b} בצד השני; הצד הצבוע מקדים. חציון הענף כשיש.`)} />
      <div className="grid gap-5 xl:grid-cols-2">
        {groups.map((g) => <ScoreGroup key={g.def.key} g={g} a={a} b={b} he={he} />)}
      </div>

      <SectionHead id="cmp-trends" title={t("Quarter by quarter", "רבעון אחרי רבעון")} subtitle={t("The last eight quarters of each company, on a shared timeline — fiscal quarters may end on different dates.", "שמונת הרבעונים האחרונים של כל חברה על ציר זמן משותף — רבעונים פיסקליים יכולים להסתיים בתאריכים שונים.")} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title={t("Revenue growth vs a year earlier", "צמיחת הכנסות מול שנה קודם")}><DuoLines a={a} b={b} sa={quarterSeries(A.p)} sb={quarterSeries(B.p)} k="growth" /></Panel>
        <Panel title={A.p.financial || B.p.financial ? t("Net margin", "מרווח נקי") : t("Operating margin", "מרווח תפעולי")}><DuoLines a={a} b={b} sa={quarterSeries(A.p)} sb={quarterSeries(B.p)} k="margin" /></Panel>
        <Panel title={t("Free cash flow margin", "מרווח תזרים חופשי")}><DuoLines a={a} b={b} sa={quarterSeries(A.p)} sb={quarterSeries(B.p)} k="fcf" /></Panel>
      </div>

      <SectionHead id="cmp-race" title={t("The price race", "מרוץ המחיר")} subtitle={t("Both stocks start at 100; the gap is how much one has beaten the other over the window.", "שתי המניות מתחילות ב־100; הפער הוא בכמה אחת הכתה את השנייה בחלון.")} />
      <Panel>{market.bars[a] && market.bars[b] ? <PriceRace a={a} b={b} A={market.bars[a]} B={market.bars[b]} he={he} /> : <p className="text-sm text-muted-foreground">{t("Daily prices for one of the two aren't on the PC yet.", "המחירים היומיים של אחת מהשתיים עדיין לא נמצאים במחשב.")}</p>}</Panel>

      <SectionHead title={t("What it would take", "מה זה היה דורש")} subtitle={t("The distance between the two, in plain numbers.", "המרחק בין השתיים, במספרים פשוטים.")} />
      <div className="grid gap-5 lg:grid-cols-3">
        {whatItTakes(A, B, he).map((x) => <Panel key={x.title} title={x.title}><p className="text-sm leading-relaxed"><AutoTerms text={x.text} /></p></Panel>)}
      </div>
    </div>
  );
}

// ── Scorecard group ───────────────────────────────────────────────────────────
function ScoreGroup({ g, a, b, he }: { g: Group; a: string; b: string; he: boolean }) {
  return (
    <Panel eyebrow={he ? g.def.he : g.def.en} title={he ? g.def.qHe : g.def.qEn}>
      <div className="mb-2 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 text-[11px] text-muted-foreground">
        <span />
        <span className="text-end font-mono font-semibold" style={{ color: COL_A }}>{a}</span>
        <span className="font-mono font-semibold" style={{ color: COL_B }}>{b}</span>
      </div>
      <ul className="space-y-1.5">
        {g.rows.map((r) => <ScoreRow key={r.id} r={r} />)}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">{g.aWins + g.bWins === 0 ? (he ? "אין כאן מי שמקדימה בבירור." : "No clear leader here.") : he ? `${a} מקדימה ב־${g.aWins}, ${b} ב־${g.bWins}.` : `${a} ahead on ${g.aWins}, ${b} on ${g.bWins}.`}</p>
    </Panel>
  );
}

function ScoreRow({ r }: { r: Row }) {
  const av = r.a.value, bv = r.b.value;
  const max = Math.max(Math.abs(av ?? 0), Math.abs(bv ?? 0)) || 1;
  const w = (v: number | null) => v == null ? 0 : Math.max(4, (Math.abs(v) / max) * 100);
  const win = r.winner;
  const bar = (side: "a" | "b") => {
    const v = side === "a" ? av : bv, col = side === "a" ? COL_A : COL_B, lead = win === side;
    return <div className={`flex h-2 ${side === "a" ? "justify-end" : ""}`}><div className="h-2 rounded-sm" style={{ width: `${w(v)}%`, background: col, opacity: lead ? 0.95 : win === "tie" ? 0.5 : 0.22 }} /></div>;
  };
  return (
    <li className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 text-[12.5px]" title={r.formula ?? undefined}>
      <span className="min-w-0 truncate text-muted-foreground"><AutoTerms text={r.label} />{r.median && <span className="ms-1 text-[10.5px] opacity-70">· med {r.median}</span>}</span>
      <div className="min-w-0" dir="ltr">
        <p className="text-end font-mono" style={{ color: win === "a" ? COL_A : undefined, fontWeight: win === "a" ? 600 : 400 }}>{r.a.display}</p>
        {bar("a")}
      </div>
      <div className="min-w-0" dir="ltr">
        <p className="font-mono" style={{ color: win === "b" ? COL_B : undefined, fontWeight: win === "b" ? 600 : 400 }}>{r.b.display}</p>
        {bar("b")}
      </div>
    </li>
  );
}

// ── Two-company quarterly lines on a shared timeline ──────────────────────────
function DuoLines({ a, b, sa, sb, k }: { a: string; b: string; sa: QPoint[]; sb: QPoint[]; k: "growth" | "margin" | "fcf" }) {
  const [hover, setHover] = useState<{ x: number; side: "a" | "b"; i: number } | null>(null);
  const sane = (x: QPoint) => x[k] != null && Math.abs(x[k] as number) <= 300; // a quarter with odd cash-flow timing can produce absurd ratios
  const pa = sa.filter(sane), pb = sb.filter(sane);
  if (pa.length < 2 && pb.length < 2) return <p className="text-sm text-muted-foreground">—</p>;
  const W = 360, H = 170, padL = 34, padR = 8, padT = 10, padB = 20;
  const ts = [...pa, ...pb].map((x) => Date.parse(x.end)), t0 = Math.min(...ts), t1 = Math.max(...ts);
  const vs = [...pa, ...pb].map((x) => x[k] as number);
  let lo = Math.min(0, ...vs), hi = Math.max(0, ...vs); const sp = hi - lo || 1; lo -= sp * 0.08; hi += sp * 0.08;
  const x = (d: string) => padL + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const line = (pts: QPoint[]) => pts.map((q, i) => `${i ? "L" : "M"}${x(q.end).toFixed(1)},${y(q[k] as number).toFixed(1)}`).join("");
  const years = [...new Set([...pa, ...pb].map((q) => q.end.slice(0, 4)))];
  const hp = hover ? (hover.side === "a" ? pa : pb)[hover.i] : null;
  return (
    <div className="relative" dir="ltr" onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {[0, lo + (hi - lo) * 0.1, hi - (hi - lo) * 0.1].filter((v, i) => i === 0 || Math.abs(y(v) - y(0)) > 14).map((v, i) => <g key={i}><line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="hsl(var(--border))" strokeWidth={v === 0 ? 1 : 0.5} opacity={v === 0 ? 0.9 : 0.5} />
          <text x={padL - 4} y={y(v) + 3} fontSize={9} textAnchor="end" fill="hsl(var(--muted-foreground))">{Math.round(v)}%</text></g>)}
        {years.map((yr) => { const d = `${yr}-07-01`, xx = x(d); return xx > padL && xx < W - padR ? <text key={yr} x={xx} y={H - 5} fontSize={9} textAnchor="middle" fill="hsl(var(--muted-foreground))">{yr}</text> : null; })}
        {[{ pts: pb, col: COL_B, side: "b" as const }, { pts: pa, col: COL_A, side: "a" as const }].map(({ pts, col, side }) => (
          <g key={side}>
            <path d={line(pts)} fill="none" stroke={col} strokeWidth={2} />
            {pts.map((q, i) => <circle key={q.end} cx={x(q.end)} cy={y(q[k] as number)} r={hover?.side === side && hover.i === i ? 4.5 : 3} fill={col}
              onPointerEnter={() => setHover({ x: x(q.end), side, i })} />)}
          </g>
        ))}
      </svg>
      {hp && hover && <div role="tooltip" className="pointer-events-none absolute top-1 rounded-md border border-border bg-popover px-2 py-1 text-[11px] shadow-md" style={{ left: `${Math.min(62, (hover.x / W) * 100)}%` }}>
        <span className="font-mono font-semibold" style={{ color: hover.side === "a" ? COL_A : COL_B }}>{hover.side === "a" ? a : b}</span> <span className="text-muted-foreground">{hp.end}</span>
        <p className="font-mono">{(hp[k] as number) >= 0 ? "+" : ""}{(hp[k] as number).toFixed(1)}%</p></div>}
      <div className="mt-1 flex gap-4 text-[11px]"><span style={{ color: COL_A }}>● {a}</span><span style={{ color: COL_B }}>● {b}</span></div>
    </div>
  );
}

// ── Price race (both rebased to 100) ──────────────────────────────────────────
const RACE = { "3M": 63, "6M": 126, "1Y": 252, "2Y": 504 } as const;
function PriceRace({ a, b, A, B, he }: { a: string; b: string; A: Bars; B: Bars; he: boolean }) {
  const [range, setRange] = useState<keyof typeof RACE>("1Y");
  const [hover, setHover] = useState<number | null>(null);
  const bm = useMemo(() => new Map(B.d.map((d, i) => [d, B.c[i]])), [B]);
  const both = useMemo(() => A.d.map((d, i) => ({ d, a: A.c[i], b: bm.get(d) })).filter((x): x is { d: string; a: number; b: number } => x.b != null), [A, bm]);
  const win = both.slice(-RACE[range]);
  if (win.length < 5) return <p className="text-sm text-muted-foreground">—</p>;
  const a0 = win[0].a, b0 = win[0].b;
  const pts = win.map((x) => ({ d: x.d, a: (x.a / a0) * 100, b: (x.b / b0) * 100 }));
  const W = 900, H = 260, padL = 40, padR = 64, padT = 10, padB = 20;
  const vs = pts.flatMap((p) => [p.a, p.b]); let lo = Math.min(...vs), hi = Math.max(...vs); const sp = hi - lo || 1; lo -= sp * 0.06; hi += sp * 0.06;
  const step = (W - padL - padR) / Math.max(1, pts.length - 1);
  const x = (i: number) => padL + i * step, y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const path = (k: "a" | "b") => pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  const last = pts[pts.length - 1], gap = last.a - last.b;
  const hp = hover != null ? pts[hover] : null;
  const months = pts.map((p, i) => ({ i, m: p.d.slice(0, 7) })).filter((m, k, arr) => k > 0 && m.m !== arr[k - 1].m);
  const ticks = months.length > 8 ? months.filter((_, k) => k % 2 === 0) : months;
  return (
    <div dir="ltr">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[12px]">
        <span className="font-mono" style={{ color: COL_A }}>{a} {last.a >= 100 ? "+" : "−"}{Math.abs(last.a - 100).toFixed(1)}%</span>
        <span className="font-mono" style={{ color: COL_B }}>{b} {last.b >= 100 ? "+" : "−"}{Math.abs(last.b - 100).toFixed(1)}%</span>
        <span className="text-muted-foreground">{he ? `${gap >= 0 ? a : b} מקדימה ב־${Math.abs(gap).toFixed(1)} נקודות` : `${gap >= 0 ? a : b} ahead by ${Math.abs(gap).toFixed(1)} points`}</span>
        <div className="ms-auto flex overflow-hidden rounded-md border border-border">
          {(Object.keys(RACE) as (keyof typeof RACE)[]).map((r) => <button key={r} onClick={() => setRange(r)} aria-pressed={range === r} disabled={both.length < RACE[r] * 0.6 && r !== "3M"}
            className={`px-2 py-0.5 font-mono text-[11px] disabled:opacity-30 ${range === r ? "bg-primary/20 font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}>{r}</button>)}
        </div>
      </div>
      <div className="relative" onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          <line x1={padL} x2={W - padR} y1={y(100)} y2={y(100)} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeWidth={0.8} opacity={0.6} />
          <text x={padL - 4} y={y(100) + 3} fontSize={10} textAnchor="end" fill="hsl(var(--muted-foreground))">100</text>
          {ticks.map((t) => <text key={t.m} x={x(t.i)} y={H - 4} fontSize={9.5} fill="hsl(var(--muted-foreground))">{new Date(`${t.m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</text>)}
          <path d={path("b")} fill="none" stroke={COL_B} strokeWidth={1.8} />
          <path d={path("a")} fill="none" stroke={COL_A} strokeWidth={1.8} />
          {[["a", COL_A], ["b", COL_B]].map(([k, col]) => <g key={k}><rect x={W - padR + 3} y={y(last[k as "a" | "b"]) - 8} width={padR - 6} height={16} rx={3} fill={col} opacity={0.2} />
            <text x={W - padR + 7} y={y(last[k as "a" | "b"]) + 4} fontSize={10} fill={col} className="font-mono">{last[k as "a" | "b"].toFixed(0)}</text></g>)}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeWidth={0.6} />}
          {pts.map((p, i) => <rect key={p.d} x={x(i) - step / 2} y={padT} width={Math.max(step, 1)} height={H - padT - padB} fill="transparent" onPointerEnter={() => setHover(i)} />)}
        </svg>
        {hp && <div role="tooltip" className="pointer-events-none absolute top-2 rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11px] shadow-md" style={{ left: `${Math.min(72, ((x(hover!) / W) * 100) + 2)}%` }}>
          <p className="font-medium">{hp.d}</p>
          <p className="font-mono" style={{ color: COL_A }}>{a} {hp.a.toFixed(1)}</p>
          <p className="font-mono" style={{ color: COL_B }}>{b} {hp.b.toFixed(1)}</p>
        </div>}
      </div>
      <div className="mt-1 flex gap-3 text-[11px] text-muted-foreground">
        <button onClick={() => openChart(a)} className="hover:text-foreground">{he ? `גרף ${a}` : `${a} chart`}</button>
        <button onClick={() => openChart(b)} className="hover:text-foreground">{he ? `גרף ${b}` : `${b} chart`}</button>
        <span className="ms-auto" style={{ color: gap >= 0 ? CHART.positive : CHART.negative }} />
      </div>
    </div>
  );
}
