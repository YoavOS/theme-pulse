// ─────────────────────────────────────────────────────────────
// SEPA alignment — Minervini's method needs several things to line up:
// trend (Trend Template + RS), fundamentals, a proper setup (VCP / base near
// the pivot), the market, and the stock's group. Everything except the
// fundamentals already exists in the app's scans; this joins them per stock.
// ─────────────────────────────────────────────────────────────
import type { StockStage } from "@/lib/stageAnalysis";
import type { StockBase } from "@/lib/bases";
import { EARN_LABELS } from "@/lib/bases";
import type { GroupLead } from "@/lib/leadership";
import { LEAD_INFO } from "@/lib/leadership";

export type Mark = "pass" | "partial" | "fail" | "unknown";
export interface Pillar { key: string; label: string; mark: Mark; value: string; detail: string }

const TT_TEXT: Record<string, string> = {
  aboveMa150_200: "price above the 150- and 200-day", ma150AboveMa200: "150-day above the 200-day", ma200Rising: "200-day rising",
  ma50Above: "50-day above 150/200-day", aboveMa50: "price above the 50-day", above52wLow30: "30%+ above the 52-week low", near52wHigh: "within 25% of the 52-week high",
};
export const ttText = (k: string) => TT_TEXT[k] ?? k;

/** RS rank 1–99 from the stage scan's 52-week relative performance (same as the Stages tab). */
export function rsRanks(rows: StockStage[]): Map<string, number> {
  const vals = rows.filter((r) => r.symbol !== "SPY" && r.features?.mrs52 != null).map((r) => ({ s: r.symbol, v: r.features!.mrs52 as number }));
  vals.sort((a, b) => a.v - b.v);
  const m = new Map<string, number>();
  vals.forEach((x, i) => m.set(x.s, Math.max(1, Math.min(99, Math.round(((i + 1) / vals.length) * 99)))));
  return m;
}

export function marketTypeFromCache(): { key: string; name: string } | null {
  try {
    const p = JSON.parse(localStorage.getItem("market_flag_cache_v2") ?? "null") as { payload?: { type?: { key: string; name: string } } } | null;
    return p?.payload?.type ?? null;
  } catch { return null; }
}

export function sepaPillars(opts: {
  stage: StockStage | null; base: StockBase | null; rs: number | null; group: GroupLead | null; groupName: string | null;
  market: { key: string; name: string } | null; fundamentalScore: number | null; code33Count: number | null;
}): Pillar[] {
  const { stage, base, rs, group, market } = opts;
  const out: Pillar[] = [];
  // 1. Trend Template (7 price rules from the stage scan + RS ≥ 70)
  const tt = stage?.features?.tt ?? null;
  if (tt) {
    const rsOk = rs !== null && rs >= 70;
    const count = tt.count + (rsOk ? 1 : 0);
    out.push({
      key: "trend", label: "Trend Template", mark: tt.pass && rsOk ? "pass" : count >= 6 ? "partial" : "fail",
      value: `${count}/8 · RS ${rs ?? "—"}`,
      detail: tt.failed.length || !rsOk ? `Missing: ${[...tt.failed.map(ttText), ...(rsOk ? [] : ["RS rank ≥ 70"])].join(", ")}.` : "All 8 rules met (weekly proxies for the daily averages).",
    });
  } else out.push({ key: "trend", label: "Trend Template", mark: "unknown", value: "—", detail: "Not in the last stage scan." });
  // 2. Stage
  if (stage) {
    const s2 = stage.stage === 2;
    out.push({ key: "stage", label: "Stage", mark: s2 ? (stage.substage === "2A" || stage.substage === "2B" ? "pass" : "partial") : "fail", value: stage.substage, detail: s2 ? "Minervini only buys Stage 2 — early in the advance is best." : "Not in Stage 2 — outside Minervini's buy zone." });
  }
  // 3. Fundamentals
  if (opts.fundamentalScore !== null) {
    const f = opts.fundamentalScore;
    out.push({
      key: "fund", label: "Fundamentals", mark: f >= 80 ? "pass" : f >= 60 ? "partial" : "fail",
      value: `${f}/100${opts.code33Count !== null ? ` · Code 33 ${opts.code33Count}/3` : ""}`,
      detail: "Minervini profile score below; Code 33 = EPS growth, sales growth and margins all rising 3 quarters in a row.",
    });
  } else out.push({ key: "fund", label: "Fundamentals", mark: "unknown", value: "not run", detail: "Run the analysis to score the fundamentals." });
  // 4. Setup (base / VCP)
  if (base) {
    const f = base.features;
    const ready = base.state === "ready" || base.state === "qualified";
    const vcp = base.labels?.includes("vcp") || f.daily?.contracting;
    out.push({
      key: "setup", label: "Setup", mark: (ready || base.state === "triggered") && (base.score ?? 0) >= 75 ? "pass" : base.state === "failed" || base.state === "extended" ? "fail" : "partial",
      value: `${base.state ?? "—"} · ${base.primary_label ?? "base"}${vcp ? " · tightening" : ""}`,
      detail: `Base score ${base.score ?? "—"}; pivot ${(base.pivot ?? f.pivot).toFixed(2)} (${(base.dist_to_pivot ?? f.distToPivotPct).toFixed(1)}% away), stop ${(base.support ?? f.support).toFixed(2)}.${f.earn && f.earn.sessionsAgo <= 45 ? ` Last earnings: ${EARN_LABELS[f.earn.label].text}.` : ""}`,
    });
  } else out.push({ key: "setup", label: "Setup", mark: "fail", value: "no base", detail: "No base candidate in the last scan — wait for a proper VCP / base." });
  // 5. Group
  if (group) {
    const m: Mark = group.state === "confirmed" || group.state === "emerging" ? "pass" : group.state === "warning" || group.state === "lost" || group.state === "lagging" ? "fail" : "partial";
    out.push({ key: "group", label: "Group", mark: m, value: LEAD_INFO[group.state].label, detail: `${opts.groupName}: 13-week RS rank ${group.rank13} among groups.` });
  } else out.push({ key: "group", label: "Group", mark: "unknown", value: opts.groupName ?? "—", detail: "Group too small or no weekly history yet." });
  // 6. Market
  if (market) {
    const good = ["healthy", "extended"].includes(market.key), bad = ["downtrend", "bear", "panic"].includes(market.key);
    out.push({ key: "market", label: "Market", mark: good ? "pass" : bad ? "fail" : "partial", value: market.name, detail: "Minervini: 3 of 4 stocks follow the market — size down outside a healthy uptrend." });
  } else out.push({ key: "market", label: "Market", mark: "unknown", value: "—", detail: "Open Market Flag once to include it." });
  return out;
}
