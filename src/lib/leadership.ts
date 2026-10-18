// ─────────────────────────────────────────────────────────────
// Group / theme leadership states.
//
// Research basis: industry momentum persists ~3–12 months but weekly
// "#1 group" rankings churn fast (Moskowitz & Grinblatt 1999); leadership
// usually ends in sequence — breadth stops expanding, leaders lose RS,
// the group's relative trend breaks (practitioner synthesis of the
// research). Thresholds are the research's engineering starting points,
// not optimised values.
//
// Inputs come from the stage scan: each stock's last ≤40 weekly closes
// (features.wc) and its weekly breadth flags (features.flags).
// ─────────────────────────────────────────────────────────────
import type { StockStage } from "@/lib/stageAnalysis";

export type LeadState = "emerging" | "confirmed" | "mature" | "warning" | "lost" | "lagging" | "neutral";

export const LEAD_INFO: Record<LeadState, { label: string; tip: string; cls: string; order: number }> = {
  confirmed: { order: 0, label: "Confirmed leader", cls: "bg-emerald-500/15 text-emerald-400", tip: "Top-20% relative strength in most of the last 6 weeks, beating the market over 4, 13 and 26 weeks, most members above their 10- and 40-week lines. The best place to look for setups." },
  emerging: { order: 1, label: "Emerging", cls: "bg-sky-500/15 text-sky-300", tip: "13-week RS rank jumped 20+ points into the top 30% with the group above a rising 10-week line and half its members above theirs. Early — needs a few more weeks to confirm." },
  mature: { order: 2, label: "Mature", cls: "bg-amber-500/15 text-amber-300", tip: "Still a top performer over 26 weeks, but breadth has stopped improving or volatility is rising. Not a sell signal — tighten stops and be less forgiving of failed breakouts." },
  warning: { order: 3, label: "Peak warning", cls: "bg-orange-500/15 text-orange-300", tip: "At least three warnings together: RS rank down 20+ points from its 13-week high, members above their 10-week line down 15+ points from the peak, volatility up 1.5×, group under its 10-week line. Leadership often ends this way. On your list it predicted weaker groups over the next ~4 weeks, not beyond." },
  lost: { order: 4, label: "Leadership lost", cls: "bg-pink-500/15 text-pink-300", tip: "Confirmed break: two weekly closes under the 10-week line, the group's relative-strength line under its 13-week low, and fewer than 40% of members above their 10-week line. Not a short signal — on your list these groups often rebounded within 13 weeks." },
  lagging: { order: 6, label: "Lagging", cls: "bg-muted text-muted-foreground", tip: "Bottom-30% 13-week relative strength." },
  neutral: { order: 5, label: "Neutral", cls: "bg-muted text-muted-foreground", tip: "No clear leadership signal either way." },
};

export interface GroupLead {
  name: string;
  n: number;                     // members with enough weekly data
  state: LeadState;
  rs4: number; rs13: number; rs26: number;   // equal-weight group return − SPY, %
  rank13: number; rank13Chg4: number | null; rank26: number;  // percentile among groups (0–100)
  p50: number; p50Peak13: number; p200: number; highs4: number;  // breadth (%)
  aboveMa10: boolean; weeksBelowMa10: number;
  volRatio: number | null;
  reasons: string[];
  ew: number[];                  // equal-weight index (last ≤40 weeks, starts at 100)
  rsLine: number[];              // ew / SPY, normalised
}

const bit = (f: string | undefined, ago: number) => (f && f.length > ago ? parseInt(f[f.length - 1 - ago], 32) : NaN);

function equalWeight(members: StockStage[], len: number): number[] | null {
  const series = members.map((r) => r.features?.wc).filter((w): w is number[] => !!w && w.length >= len).map((w) => w.slice(-len));
  if (series.length < 3) return null;
  const idx = [100];
  for (let t = 1; t < len; t++) {
    let s = 0, k = 0;
    for (const w of series) { if (w[t - 1] > 0) { s += w[t] / w[t - 1] - 1; k++; } }
    idx.push(idx[t - 1] * (1 + (k ? s / k : 0)));
  }
  return idx;
}

const sd = (a: number[]) => { const m = a.reduce((x, y) => x + y, 0) / (a.length || 1); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };

/** Leadership state for each group. `groups` maps group name → member rows (latest week only). */
export function computeLeadership(groups: Map<string, StockStage[]>, spy: StockStage | null, minMembers = 5): GroupLead[] {
  const sw = spy?.features?.wc;
  if (!sw || sw.length < 30) return [];
  const L = Math.min(40, sw.length);
  const spyW = sw.slice(-L);
  const base: Omit<GroupLead, "state" | "rank13" | "rank13Chg4" | "rank26" | "reasons">[] = [];
  const rs13Hist: number[][] = [];   // per group: RS13 at 0..13 weeks ago
  for (const [name, members] of groups) {
    if (members.length < minMembers) continue;
    const ew = equalWeight(members, L);
    if (!ew) continue;
    const ret = (a: number[], k: number, ago = 0) => (a[a.length - 1 - ago] / a[a.length - 1 - ago - k] - 1) * 100;
    const rsAt = (k: number, ago: number) => ret(ew, k, ago) - ret(spyW, k, ago);
    const hist: number[] = [];
    for (let ago = 0; ago <= 13 && L - 1 - ago - 13 >= 0; ago++) hist.push(rsAt(13, ago));
    // breadth from the members' weekly flags
    const pAt = (ago: number, mask: number) => {
      let n = 0, a = 0;
      for (const r of members) { const b = bit(r.features?.flags, ago); if (!Number.isFinite(b)) continue; n++; if (b & mask) a++; }
      return n ? (a / n) * 100 : 0;
    };
    const p50 = pAt(0, 1), p200 = pAt(0, 2);
    let p50Peak13 = p50;
    for (let ago = 1; ago <= 13; ago++) p50Peak13 = Math.max(p50Peak13, pAt(ago, 1));
    let highs4 = 0;
    for (const r of members) { for (let ago = 0; ago < 4; ago++) { const b = bit(r.features?.flags, ago); if (Number.isFinite(b) && b & 4) { highs4++; break; } } }
    highs4 = (highs4 / members.length) * 100;
    // equal-weight index vs its 10-week average
    const ma10 = (ago: number) => ew.slice(ew.length - 10 - ago, ew.length - ago).reduce((x, y) => x + y, 0) / 10;
    const aboveMa10 = ew[ew.length - 1] > ma10(0);
    let weeksBelowMa10 = 0;
    for (let ago = 0; ago < 8 && ew.length - 10 - ago >= 0; ago++) { if (ew[ew.length - 1 - ago] < ma10(ago)) weeksBelowMa10++; else break; }
    const wr = ew.slice(1).map((x, k) => x / ew[k] - 1);
    const volRatio = wr.length >= 30 ? sd(wr.slice(-8)) / (sd(wr.slice(-38, -8)) || 1) : null;
    const rsLine = ew.map((x, k) => (x / ew[0]) / (spyW[k] / spyW[0]) * 100);
    base.push({
      name, n: members.filter((r) => (r.features?.wc?.length ?? 0) >= L).length,
      rs4: rsAt(4, 0), rs13: rsAt(13, 0), rs26: rsAt(26, 0),
      p50, p50Peak13, p200, highs4, aboveMa10, weeksBelowMa10, volRatio, ew, rsLine,
    });
    rs13Hist.push(hist);
  }
  if (base.length < 4) return [];
  // cross-sectional ranks (percentile among groups) for each week
  const rankOf = (vals: number[], x: number) => Math.round((vals.filter((v) => v < x).length / Math.max(1, vals.length - 1)) * 100);
  const weeks = Math.min(...rs13Hist.map((h) => h.length));
  const rankHist = rs13Hist.map(() => [] as number[]);
  for (let ago = 0; ago < weeks; ago++) {
    const vals = rs13Hist.map((h) => h[ago]);
    rs13Hist.forEach((h, g) => rankHist[g].push(rankOf(vals, h[ago])));
  }
  const rs26s = base.map((b) => b.rs26);
  return base.map((b, g) => {
    const rh = rankHist[g];                              // [now, 1w ago, …]
    const rank13 = rh[0] ?? 50;
    const rank13Chg4 = rh.length > 4 ? rank13 - rh[4] : null;
    const rank26 = rankOf(rs26s, b.rs26);
    const top20Weeks = rh.slice(0, 6).filter((x) => x >= 80).length;
    const rankHigh13 = Math.max(...rh);
    const rsLow13 = Math.min(...b.rsLine.slice(-14, -1));
    const reasons: string[] = [];
    // warnings
    const warn: string[] = [];
    if (rankHigh13 - rank13 >= 20) warn.push(`RS rank down ${rankHigh13 - rank13} pts from its 13-week high`);
    if (b.p50Peak13 - b.p50 >= 15) warn.push(`members above 10w line down ${Math.round(b.p50Peak13 - b.p50)} pts from peak`);
    if (b.volRatio !== null && b.volRatio >= 1.5) warn.push(`volatility ${b.volRatio.toFixed(1)}× normal`);
    if (!b.aboveMa10) warn.push("group under its 10-week line");
    let state: LeadState;
    if (b.weeksBelowMa10 >= 2 && b.rsLine[b.rsLine.length - 1] < rsLow13 && b.p50 < 40 && (rankHigh13 >= 70 || rank26 >= 60)) {
      state = "lost"; reasons.push("2+ weeks under the 10-week line", "RS line at a 13-week low", `${Math.round(b.p50)}% of members above their 10-week line`);
    } else if (warn.length >= 3 && (rankHigh13 >= 70 || rank26 >= 70)) {
      state = "warning"; reasons.push(...warn);
    } else if (rank26 >= 80 && b.rs26 > 0 && (b.p50Peak13 - b.p50 >= 10 || (b.volRatio ?? 0) >= 1.3)) {
      state = "mature"; reasons.push(`top ${100 - rank26}% over 26 weeks (+${b.rs26.toFixed(0)}% vs SPY)`, ...warn.slice(0, 2));
    } else if (top20Weeks >= 4 && b.rs4 > 0 && b.rs13 > 0 && b.rs26 > 0 && b.p50 >= 60 && b.p200 >= 50) {
      state = "confirmed"; reasons.push(`top-20% RS in ${top20Weeks} of the last 6 weeks`, `${Math.round(b.p50)}% above 10w line`, `beating SPY over 4/13/26 weeks`);
    } else if (rank13Chg4 !== null && rank13Chg4 >= 20 && rank13 >= 70 && b.aboveMa10 && b.p50 >= 50) {
      state = "emerging"; reasons.push(`RS rank up ${rank13Chg4} pts in 4 weeks`, `${Math.round(b.p50)}% above 10w line`);
    } else if (rank13 <= 30) {
      state = "lagging"; reasons.push(`bottom ${rank13 + 1}% over 13 weeks`);
    } else {
      state = "neutral";
    }
    return { ...b, state, rank13, rank13Chg4, rank26, reasons };
  }).sort((a, b) => LEAD_INFO[a.state].order - LEAD_INFO[b.state].order || b.rank13 - a.rank13);
}
