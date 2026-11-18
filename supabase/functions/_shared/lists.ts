// Pure list builders for daily-lists (no database here, so they can be tested on made-up prices).

export interface Bars { d: string[]; h: number[]; l: number[]; c: number[]; v: number[] }
export interface Ctx {
  info: Map<string, { name: string | null; industry: string | null; rs: number | null; cap: number | null }>;
  stage: Map<string, number | null>;
  themesOf: Map<string, string[]>;
}
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

/** Bars up to and including `day` (so a list can be rebuilt for a past date). */
function upTo(b: Bars, day: string): Bars | null {
  let end = b.d.length;
  while (end > 0 && b.d[end - 1] > day) end--;
  if (end === 0 || b.d[end - 1] !== day) return null;
  return { d: b.d.slice(0, end), h: b.h.slice(0, end), l: b.l.slice(0, end), c: b.c.slice(0, end), v: b.v.slice(0, end) };
}

export function ema(c: number[], n = 21): number[] {
  const out = new Array(c.length).fill(NaN);
  if (c.length < n) return out;
  let e = avg(c.slice(0, n));
  out[n - 1] = e;
  const k = 2 / (n + 1);
  for (let i = n; i < c.length; i++) { e = c[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
/** Average daily range %, last n sessions. */
export const adrPct = (b: Bars, n = 20) => avg(b.h.slice(-n).map((h, i) => 100 * (h / b.l.slice(-n)[i] - 1)));

/** Industry strength: average RS and share in stage 2, and its percentile among industries. */
function industryStrength(ctx: Ctx) {
  const by = new Map<string, { rs: number[]; s2: number; n: number }>();
  for (const [sym, i] of ctx.info) {
    if (!i.industry) continue;
    const g = by.get(i.industry) ?? { rs: [], s2: 0, n: 0 };
    if (i.rs != null) g.rs.push(i.rs);
    if (ctx.stage.get(sym) === 2) g.s2++;
    g.n++;
    by.set(i.industry, g);
  }
  const rows = [...by].filter(([, g]) => g.n >= 3).map(([name, g]) => ({ name, rs: avg(g.rs), pctS2: (100 * g.s2) / g.n, n: g.n }));
  rows.sort((a, b) => a.rs - b.rs);
  const out = new Map<string, { rs: number; pctS2: number; n: number; pctile: number }>();
  rows.forEach((r, i) => out.set(r.name, { rs: r.rs, pctS2: r.pctS2, n: r.n, pctile: rows.length > 1 ? Math.round((100 * i) / (rows.length - 1)) : 50 }));
  return out;
}

export interface ListRow { symbol: string; grp: string | null; score: number; evidence: Record<string, unknown> }

/**
 * 21 EMA pullbacks: a run of at least `minRun`% from the 21 EMA at its last touch to the peak, the peak in
 * the last ~30 sessions, and today's price back within about 1.5 days' range of the EMA (not far below it).
 */
export function buildEma21(all: Map<string, Bars>, ctx: Ctx, day: string, minRun = 40): ListRow[] {
  const ind = industryStrength(ctx);
  const out: ListRow[] = [];
  for (const [sym, info] of ctx.info) {
    const raw = all.get(sym);
    const b = raw && upTo(raw, day);
    if (!b || b.c.length < 80) continue;
    const e = ema(b.c);
    const n = b.c.length, last = n - 1;
    // the peak of the move: highest high in the last 30 sessions
    let p = last;
    for (let i = Math.max(0, n - 30); i < n; i++) if (b.h[i] > b.h[p]) p = i;
    if (p === last) continue; // still making highs today — not pulling back yet
    // last touch of the EMA before the peak
    let t = -1;
    for (let i = p - 1; i >= Math.max(21, n - 200); i--) if (b.l[i] <= e[i]) { t = i; break; }
    if (t < 0) continue;
    const run = 100 * (b.h[p] / e[t] - 1);
    if (run < minRun) continue;
    const adr = adrPct(b);
    if (!(adr > 0)) continue;
    const distPct = 100 * (b.c[last] / e[last] - 1);
    const distAdr = distPct / adr;
    const lowDistAdr = (100 * (b.l[last] / e[last] - 1)) / adr;
    if (distAdr > 1.5 || distAdr < -1) continue; // not near yet, or broke well below
    const zone = lowDistAdr <= 0.4 ? "at" : "near"; // your TradingView zone: about 0.4 ADR around the EMA
    const stage = ctx.stage.get(sym) ?? null;
    if (stage === 3 || stage === 4) continue;
    const volRun = avg(b.v.slice(t, p + 1)), volNow = avg(b.v.slice(-5));
    const dryUp = volRun > 0 ? volNow / volRun : null;
    const fromPeak = 100 * (b.c[last] / b.h[p] - 1);
    const g = info.industry ? ind.get(info.industry) : undefined;
    const themes = ctx.themesOf.get(sym) ?? [];
    // score: group strength, RS, how close, volume drying up, and run size (capped)
    const score = (g?.pctile ?? 40) * 0.35 + (info.rs ?? 50) * 0.3 + (zone === "at" ? 15 : 8) +
      (dryUp != null ? Math.max(0, Math.min(10, (1 - dryUp) * 20)) : 0) + Math.min(10, (run - minRun) / 6) + (stage === 2 ? 5 : 0);
    out.push({
      symbol: sym, grp: info.industry, score: r1(score),
      evidence: {
        name: info.name, run: r1(run), touchDate: b.d[t], peakDate: b.d[p], sessionsSincePeak: last - p, fromPeak: r1(fromPeak),
        ema21: r2(e[last]), close: r2(b.c[last]), distAdr: r2(distAdr), lowDistAdr: r2(lowDistAdr), zone, adr: r1(adr),
        volDryUp: dryUp != null ? r2(dryUp) : null, stage, rs: info.rs != null ? r1(info.rs) : null,
        industry: info.industry, industryRs: g ? r1(g.rs) : null, industryPctS2: g ? Math.round(g.pctS2) : null, industryPctile: g?.pctile ?? null, themes,
      },
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 60);
}

/**
 * Bought on red days: market red days are SPY down ≥ 0.75% (last 20 sessions; 40 if there were fewer than 3).
 * A stock "was bought" that day when it closed up, or beat SPY by ≥ 1.5 pts and closed in the top 40% of its range,
 * on at least average volume.
 */
export function buildRedDay(all: Map<string, Bars>, ctx: Ctx, day: string) {
  const spyRaw = all.get("SPY");
  const spy = spyRaw && upTo(spyRaw, day);
  if (!spy) return { stocks: [] as ListRow[], groups: [] as { name: string; kind: string; score: number; evidence: Record<string, unknown> }[], redDays: [] as string[] };
  const spyRet = new Map<string, number>();
  for (let i = 1; i < spy.c.length; i++) spyRet.set(spy.d[i], 100 * (spy.c[i] / spy.c[i - 1] - 1));
  let window = 20;
  let red = spy.d.slice(-window).filter((d) => (spyRet.get(d) ?? 0) <= -0.75);
  if (red.length < 3) { window = 40; red = spy.d.slice(-window).filter((d) => (spyRet.get(d) ?? 0) <= -0.75); }
  const redSet = new Set(red);

  const per = new Map<string, { bought: number; seen: number; excess: number[]; days: string[] }>();
  for (const sym of new Set([...ctx.info.keys(), ...ctx.themesOf.keys()])) {
    const raw = all.get(sym);
    const b = raw && upTo(raw, day);
    if (!b || b.c.length < 60) continue;
    const r = { bought: 0, seen: 0, excess: [] as number[], days: [] as string[] };
    for (let i = Math.max(51, b.c.length - window); i < b.c.length; i++) {
      if (!redSet.has(b.d[i])) continue;
      const ret = 100 * (b.c[i] / b.c[i - 1] - 1);
      const ex = ret - (spyRet.get(b.d[i]) ?? 0);
      const range = b.h[i] - b.l[i];
      const pos = range > 0 ? (b.c[i] - b.l[i]) / range : 0.5;
      const vAvg = avg(b.v.slice(i - 50, i));
      const rvol = vAvg > 0 ? b.v[i] / vAvg : 0;
      r.seen++;
      r.excess.push(ex);
      if ((ret > 0 || (ex >= 1.5 && pos >= 0.6)) && rvol >= 1.0) { r.bought++; r.days.push(b.d[i]); }
    }
    if (r.seen) per.set(sym, r);
  }

  const stocks: ListRow[] = [];
  for (const [sym, r] of per) {
    const info = ctx.info.get(sym);
    if (!info || r.seen < 2 || r.bought < 2 || r.bought / r.seen < 0.5) continue;
    const ex = avg(r.excess);
    stocks.push({
      symbol: sym, grp: info.industry, score: r1(100 * (r.bought / r.seen) + ex * 3 + (info.rs ?? 50) * 0.2),
      evidence: { name: info.name, bought: r.bought, redDays: r.seen, avgExcessOnRedDays: r2(ex), boughtOn: r.days, stage: ctx.stage.get(sym) ?? null, rs: info.rs != null ? r1(info.rs) : null, industry: info.industry, themes: ctx.themesOf.get(sym) ?? [] },
    });
  }
  stocks.sort((a, b) => b.score - a.score);

  // groups: industries and themes with ≥ 4 members that have data
  const members = new Map<string, { kind: string; syms: string[] }>();
  for (const [sym, info] of ctx.info) if (info.industry) {
    const k = `industry:${info.industry}`;
    members.set(k, { kind: "industry", syms: [...(members.get(k)?.syms ?? []), sym] });
  }
  for (const [sym, ths] of ctx.themesOf) for (const th of ths) {
    const k = `theme:${th}`;
    members.set(k, { kind: "theme", syms: [...(members.get(k)?.syms ?? []), sym] });
  }
  const groups: { name: string; kind: string; score: number; evidence: Record<string, unknown> }[] = [];
  for (const [key, g] of members) {
    const rs = g.syms.map((s) => ({ s, r: per.get(s) })).filter((x) => x.r && x.r.seen > 0) as { s: string; r: { bought: number; seen: number; excess: number[] } }[];
    if (rs.length < 4) continue;
    const share = avg(rs.map((x) => x.r.bought / x.r.seen));
    const ex = avg(rs.map((x) => avg(x.r.excess)));
    if (share < 0.3 && ex < 0.5) continue;
    const leaders = rs.filter((x) => x.r.bought / x.r.seen >= 0.5).sort((a, b) => avg(b.r.excess) - avg(a.r.excess)).slice(0, 6).map((x) => x.s);
    groups.push({ name: key.slice(key.indexOf(":") + 1), kind: g.kind, score: r1(100 * share + ex * 5), evidence: { members: rs.length, shareBought: Math.round(100 * share), avgExcessOnRedDays: r2(ex), leaders } });
  }
  groups.sort((a, b) => b.score - a.score);
  return { stocks: stocks.slice(0, 40), groups: groups.slice(0, 20), redDays: red };
}
