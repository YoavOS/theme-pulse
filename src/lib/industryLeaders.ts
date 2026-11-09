// ─────────────────────────────────────────────────────────────
// Industry fundamental leaders.
//
// Every stock is ranked against the other stocks in its own industry (percentile 0–100), not the
// whole market: 30% margins are ordinary in software and exceptional in trucking. Research basis:
// Mohanram's G-score (industry-relative growth-stock fundamentals) and O'Neil's "leader in a
// leading group".
//
// Four pillars, each the average industry percentile of its inputs:
//   Growth   — quarterly EPS growth, quarterly revenue growth, Earnings-momentum profile
//   Trend    — Sales-acceleration and Margin-expansion profiles
//   Quality  — Quality profile, ROE, net margin
//   Strength — Current-fundamentals profile
// Fundamental score = weighted mean of the pillars it has (35 / 20 / 25 / 20).
// "Top fundamentals" = score 80+ or #1 in the industry.
// A stock needs half of the 9 inputs to be ranked; a profile score under the app's minimum data
// coverage counts as missing.
// ─────────────────────────────────────────────────────────────

import { savedScore, type ProfileKey, type SavedRow } from "@/lib/superperfProfiles";

export type PillarKey = "growth" | "trend" | "quality" | "strength";
export const PILLARS: { key: PillarKey; label: string; weight: number; tip: string }[] = [
  { key: "growth", label: "Growth", weight: 0.35, tip: "Quarterly EPS and revenue growth vs last year, and the Earnings-momentum profile — ranked within the industry." },
  { key: "trend", label: "Trend", weight: 0.2, tip: "Is it getting better? Sales-acceleration and Margin-expansion profiles, ranked within the industry." },
  { key: "quality", label: "Quality", weight: 0.25, tip: "Quality profile (gross profit / assets, cash conversion, dilution…), ROE and net margin, ranked within the industry." },
  { key: "strength", label: "Strength", weight: 0.2, tip: "Current-fundamentals profile score, ranked within the industry." },
];

export interface LeaderInputs {
  symbol: string;
  group: string;
  rsRating: number | null;      // 1–99 across the whole universe
  epsQ: number | null; revQ: number | null; roe: number | null; netMargin: number | null;
  momentum: number | null; growthProfile: number | null; margins: number | null; quality: number | null; current: number | null;
}

export type Bucket = "confirmed" | "emerging" | "price_only" | null;
export const BUCKET_INFO: Record<Exclude<Bucket, null>, { label: string; tip: string; cls: string }> = {
  confirmed: { label: "Confirmed leader", tip: "Top fundamentals in its industry AND strong RS (80+): the classic leader in a group.", cls: "bg-[hsl(150,60%,45%)]/15 text-[hsl(150,65%,60%)] border-[hsl(150,60%,45%)]/40" },
  emerging: { label: "Emerging", tip: "Top fundamentals in its industry, but RS hasn't caught up yet (under 70). Watch for price to confirm.", cls: "bg-[hsl(199,85%,62%)]/15 text-[hsl(199,85%,70%)] border-[hsl(199,85%,62%)]/40" },
  price_only: { label: "Price only", tip: "Strong RS but bottom-half fundamentals for its industry: momentum without the business to back it.", cls: "bg-[hsl(25,90%,55%)]/15 text-[hsl(25,90%,65%)] border-[hsl(25,90%,55%)]/40" },
};

export interface LeaderRow {
  symbol: string;
  group: string;
  score: number | null;                         // 0–100 industry-relative fundamental score
  pillars: Record<PillarKey, number | null>;    // 0–100 percentiles
  coverage: number;                             // share of the 9 inputs present, 0–100
  rank: number | null;                          // 1 = fundamental leader of the industry
  ranked: number;                               // stocks ranked in the industry
  rsRating: number | null;
  bucket: Bucket;
}

export interface IndustrySummary {
  group: string;
  members: number;
  ranked: number;
  rsMedian: number | null;   // median RS rating of the members
  rsRank: number;            // 1 = strongest industry by median RS
  fundMedian: number | null; // median fundamental score (for context)
  leaders: LeaderRow[];      // ranked members, best first
  unranked: LeaderRow[];     // too little data
}

const INPUTS: (keyof LeaderInputs)[] = ["epsQ", "revQ", "momentum", "growthProfile", "margins", "quality", "roe", "netMargin", "current"];
const PILLAR_INPUTS: Record<PillarKey, (keyof LeaderInputs)[]> = {
  growth: ["epsQ", "revQ", "momentum"],
  trend: ["growthProfile", "margins"],
  quality: ["quality", "roe", "netMargin"],
  strength: ["current"],
};
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Percentile (0–100) of each value within its list; ties share the average rank. Missing → null. */
function percentiles(values: (number | null)[]): (number | null)[] {
  const idx = values.map((v, i) => [v, i] as const).filter(([v]) => fin(v)) as [number, number][];
  const out: (number | null)[] = values.map(() => null);
  if (!idx.length) return out;
  if (idx.length === 1) { out[idx[0][1]] = 50; return out; }
  idx.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const p = (((i + j) / 2) / (idx.length - 1)) * 100;
    for (let k = i; k <= j; k++) out[idx[k][1]] = Math.round(p);
    i = j + 1;
  }
  return out;
}

export const LEADER_PCT = 80;   // top fundamentals = score 80+ (top ~20% of the industry)
export const MIN_COVERAGE = 50;

export function rankIndustries(items: LeaderInputs[], minMembers = 3): IndustrySummary[] {
  const groups = new Map<string, LeaderInputs[]>();
  for (const it of items) groups.set(it.group, [...(groups.get(it.group) ?? []), it]);
  const out: IndustrySummary[] = [];
  for (const [group, list] of groups) {
    if (list.length < minMembers) continue;
    const pct = new Map<keyof LeaderInputs, (number | null)[]>();
    for (const k of INPUTS) pct.set(k, percentiles(list.map((x) => (fin(x[k]) ? (x[k] as number) : null))));
    const rows: LeaderRow[] = list.map((x, i) => {
      const present = INPUTS.filter((k) => fin(x[k])).length;
      const coverage = Math.round((present / INPUTS.length) * 100);
      const pillars = {} as Record<PillarKey, number | null>;
      for (const p of PILLARS) {
        const vals = PILLAR_INPUTS[p.key].map((k) => pct.get(k)![i]).filter(fin);
        pillars[p.key] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
      }
      const have = PILLARS.filter((p) => pillars[p.key] !== null);
      const w = have.reduce((a, p) => a + p.weight, 0);
      const score = coverage >= MIN_COVERAGE && w > 0 ? Math.round(have.reduce((a, p) => a + (pillars[p.key] as number) * p.weight, 0) / w) : null;
      return { symbol: x.symbol, group, score, pillars, coverage, rank: null, ranked: 0, rsRating: x.rsRating, bucket: null };
    });
    const ranked = rows.filter((r) => r.score !== null).sort((a, b) => (b.score as number) - (a.score as number) || (b.rsRating ?? 0) - (a.rsRating ?? 0));
    ranked.forEach((r, i) => {
      r.rank = i + 1; r.ranked = ranked.length;
      const s = r.score as number, rs = r.rsRating;
      const top = s >= LEADER_PCT || i === 0;   // the industry's #1 always counts as top, even in small groups
      r.bucket = top && rs !== null && rs >= 80 ? "confirmed"
        : top && (rs === null || rs < 70) ? "emerging"
        : s < 50 && rs !== null && rs >= 80 ? "price_only" : null;
    });
    const rsVals = list.map((x) => x.rsRating).filter(fin);
    out.push({
      group, members: list.length, ranked: ranked.length, rsMedian: median(rsVals), rsRank: 0,
      fundMedian: median(ranked.map((r) => r.score as number)),
      leaders: ranked, unranked: rows.filter((r) => r.score === null),
    });
  }
  out.sort((a, b) => (b.rsMedian ?? -1) - (a.rsMedian ?? -1) || b.members - a.members);
  out.forEach((g, i) => { g.rsRank = i + 1; });
  return out;
}

// ── Shared input building (Industry Leaders panel and the ranked export) ───────

interface StockLike { symbol: string; sector: string | null; rsOverall: number | null }
interface FundLike { eps_quarterly_yoy: number | null; revenue_quarterly_yoy: number | null; roe: number | null; net_margin: number | null }

/** RS rating 1–99 across the given stocks (rank of rsOverall), keyed by upper-case symbol. */
export function rsRatings(stocks: StockLike[]): Map<string, number> {
  const vals = stocks.filter((s) => fin(s.rsOverall)).sort((a, b) => (a.rsOverall as number) - (b.rsOverall as number));
  const m = new Map<string, number>();
  vals.forEach((s, i) => m.set(s.symbol.toUpperCase(), Math.max(1, Math.min(99, Math.round(((i + 1) / vals.length) * 99)))));
  return m;
}

export function buildLeaderInputs<S extends StockLike>(
  stocks: S[], groupOf: (s: S) => string, fundamentals: Map<string, FundLike>,
  savedBy: Map<string, SavedRow>, rating: Map<string, number>,
): LeaderInputs[] {
  return stocks.map((s) => {
    const sym = s.symbol.toUpperCase(), f = fundamentals.get(s.symbol) ?? fundamentals.get(sym), row = savedBy.get(sym);
    const sc = (k: ProfileKey) => savedScore(row, k);
    return {
      symbol: sym, group: groupOf(s), rsRating: rating.get(sym) ?? null,
      epsQ: f?.eps_quarterly_yoy ?? null, revQ: f?.revenue_quarterly_yoy ?? null, roe: f?.roe ?? null, netMargin: f?.net_margin ?? null,
      momentum: sc("momentum"), growthProfile: sc("growth"), margins: sc("margins"), quality: sc("quality"), current: sc("current"),
    };
  });
}
