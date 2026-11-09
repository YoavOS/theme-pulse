// ─────────────────────────────────────────────────────────────
// Industry strength on a chosen timeframe, and the ranked TradingView export.
//
// Group score (research: Bulkowski's industry RS test, Moskowitz & Grinblatt 1999, IBD group ranks):
//   1. each stock's RS for the timeframe (its return minus SPY's), clipped at the universe's
//      2.5th / 97.5th percentile so one +300% stock can't carry a small group;
//   2. equal-weighted mean of the members (cap-weighting lets one mega-cap decide a 5-stock group);
//   3. shrunk toward the universe mean for small groups (empirical Bayes):
//        score = (n·mean + k·universeMean) / (n + k)
//      k = 5 for 1M/3M/6M (a 5-stock group keeps half its own signal), 10 for the noisier 1D/1W.
//   Overall = 0.2·z(1M) + 0.4·z(3M) + 0.4·z(6M) of the group scores (1D/1W left out: no evidence
//   that short-term group ranks persist).
// Breadth (shown, not scored) = (members beating SPY + 1) / (n + 2).
// Groups with fewer than `minMembers` stocks are left out. Ties: more members, then breadth, then name.
// The k values, clip bounds and Overall weights are judgment calls — kept as named constants.
// ─────────────────────────────────────────────────────────────

export type Timeframe = "1d" | "1w" | "1m" | "3m" | "6m" | "overall";
export const TIMEFRAMES: { key: Timeframe; label: string; movers?: boolean }[] = [
  { key: "1d", label: "1D", movers: true },
  { key: "1w", label: "1W", movers: true },
  { key: "1m", label: "1M" },
  { key: "3m", label: "3M" },
  { key: "6m", label: "6M" },
  { key: "overall", label: "Overall" },
];
export const SHRINK_K: Record<Exclude<Timeframe, "overall">, number> = { "1d": 10, "1w": 10, "1m": 5, "3m": 5, "6m": 5 };
export const OVERALL_WEIGHTS: [Exclude<Timeframe, "overall" | "1d" | "1w">, number][] = [["1m", 0.2], ["3m", 0.4], ["6m", 0.4]];
const CLIP = [0.025, 0.975] as const;

export interface RsInput { symbol: string; group: string; rs: Partial<Record<Exclude<Timeframe, "overall">, number | null>> }

export interface GroupRank {
  group: string;
  n: number;            // members with RS on this timeframe
  members: number;      // all members
  score: number;        // shrunk mean RS (or blended z for Overall) — used for ordering
  pct: number;          // 1–99 percentile among the ranked groups
  rank: number;         // 1 = strongest
  breadth: number;      // 0–100, shrunk share of members beating SPY
  rawMean: number | null; // unshrunk mean of clipped RS (Overall: null)
  lowConfidence: boolean; // 3–4 members
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function groupScores(items: RsInput[], tf: Exclude<Timeframe, "overall">, minMembers: number) {
  const vals = items.map((x) => x.rs[tf]).filter(fin).sort((a, b) => a - b);
  if (!vals.length) return new Map<string, { score: number; n: number; breadth: number; rawMean: number }>();
  const lo = quantile(vals, CLIP[0]), hi = quantile(vals, CLIP[1]);
  const clip = (v: number) => Math.min(hi, Math.max(lo, v));
  const mu = vals.reduce((a, v) => a + clip(v), 0) / vals.length;
  const k = SHRINK_K[tf];
  const by = new Map<string, number[]>();
  for (const x of items) { const v = x.rs[tf]; if (fin(v)) by.set(x.group, [...(by.get(x.group) ?? []), clip(v)]); }
  const out = new Map<string, { score: number; n: number; breadth: number; rawMean: number }>();
  for (const [g, xs] of by) {
    if (xs.length < minMembers) continue;
    const n = xs.length, mean = xs.reduce((a, b) => a + b, 0) / n;
    out.set(g, { score: (n * mean + k * mu) / (n + k), n, breadth: ((xs.filter((v) => v > 0).length + 1) / (n + 2)) * 100, rawMean: mean });
  }
  return out;
}

/** Industries ranked strongest → weakest on the timeframe. */
export function rankGroups(items: RsInput[], tf: Timeframe, minMembers = 3): GroupRank[] {
  const members = new Map<string, number>();
  for (const x of items) members.set(x.group, (members.get(x.group) ?? 0) + 1);
  let rows: Omit<GroupRank, "pct" | "rank">[];
  if (tf !== "overall") {
    rows = [...groupScores(items, tf, minMembers)].map(([group, s]) => ({
      group, n: s.n, members: members.get(group) ?? s.n, score: s.score, breadth: s.breadth, rawMean: s.rawMean, lowConfidence: s.n < 5,
    }));
  } else {
    const parts = OVERALL_WEIGHTS.map(([t, w]) => {
      const m = groupScores(items, t, minMembers);
      const xs = [...m.values()].map((s) => s.score);
      const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
      const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length || 1)) || 1;
      return { m, w, z: (v: number) => (v - mean) / sd };
    });
    const groups = new Set(parts.flatMap((p) => [...p.m.keys()]));
    rows = [...groups].map((group) => {
      let sum = 0, wsum = 0, n = 0, br = 0;
      for (const p of parts) { const s = p.m.get(group); if (!s) continue; sum += p.w * p.z(s.score); wsum += p.w; n = Math.max(n, s.n); br += p.w * s.breadth; }
      return { group, n, members: members.get(group) ?? n, score: wsum ? sum / wsum : 0, breadth: wsum ? br / wsum : 50, rawMean: null, lowConfidence: n < 5 };
    });
  }
  rows.sort((a, b) => b.score - a.score || b.n - a.n || b.breadth - a.breadth || a.group.localeCompare(b.group));
  const N = rows.length;
  return rows.map((r, i) => ({ ...r, rank: i + 1, pct: N > 1 ? Math.max(1, Math.min(99, Math.round(((N - 1 - i) / (N - 1)) * 98 + 1))) : 99 }));
}

// ── TradingView text ──────────────────────────────────────────────────────────

/** Section names: no commas (they separate symbols), no '#', plain ASCII, ≤ 40 characters. */
export function tvSectionName(s: string): string {
  return s.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[,#\n\r]/g, " ").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim().slice(0, 40).trim();
}

/** TradingView writes share classes with a dot: BRK-B / BRK/B → BRK.B. */
export function tvSymbol(s: string): string {
  const u = s.trim().toUpperCase();
  return u.replace(/^([A-Z]{1,5})[-/]([A-Z])$/, "$1.$2");
}

/** "{rank} {name} | {tail}" within 40 characters; the name is shortened at a word boundary. */
export function tvSectionHeader(rank: number, name: string, tail: string): string {
  const head = `${rank} `, end = ` | ${tail}`;
  let n = tvSectionName(name);
  const room = 40 - head.length - end.length;
  if (n.length > room) {
    const cut = n.slice(0, room);
    n = (cut.lastIndexOf(" ") > room * 0.6 ? cut.slice(0, cut.lastIndexOf(" ")) : cut).replace(/[\s&|-]+$/, "");
  }
  return tvSectionName(`${head}${n}${end}`);
}

export const TV_SYMBOL_LIMIT = 1000;
/** Headroom: section headers are counted too, in case TradingView counts them. */
export const TV_SAFE_LIMIT = 990;

export interface TvSection { name: string; symbols: string[] }

/**
 * Builds the watchlist text: "###Section" on its own line, then that section's symbols comma-separated.
 * Each symbol appears once (first section wins). Sections that would push past the limit are cut.
 */
export function buildTvText(sections: TvSection[], limit = TV_SAFE_LIMIT): { text: string; symbols: number; sections: number; cut: number; dupes: number } {
  const seen = new Set<string>();
  const out: string[] = [];
  let used = 0, kept = 0, cut = 0, dupes = 0, count = 0;
  for (const s of sections) {
    const syms: string[] = [];
    for (const raw of s.symbols) { const t = tvSymbol(raw); if (!t) continue; if (seen.has(t)) { dupes++; continue; } syms.push(t); }
    if (!syms.length) continue;
    const room = limit - used - 1;
    if (room <= 0) { cut += syms.length; continue; }
    const take = syms.slice(0, room);
    cut += syms.length - take.length;
    take.forEach((t) => seen.add(t));
    out.push(`###${tvSectionName(s.name) || "Group"}`, take.join(","));
    used += take.length + 1; kept++; count += take.length;
  }
  return { text: out.join("\n") + (out.length ? "\n" : ""), symbols: count, sections: kept, cut, dupes };
}
