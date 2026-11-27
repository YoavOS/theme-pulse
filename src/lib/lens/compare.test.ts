import { describe, expect, it } from "vitest";
import type { LensPayload } from "@/lib/lens/types";
import NVDA from "./__fixtures__/lens-NVDA.json";
import jpmRaw from "./__fixtures__/lens-JPM.json";
import facts from "./__fixtures__/jpm-bank-facts.json";
import { parseLensHistory } from "../../../supabase/functions/_shared/lensMetrics";
import { statements } from "../../../supabase/functions/_shared/financialStatements";
import { candidates, cell, compareStory, quarterSeries, scorecard, size, tally, whatItTakes, type PeerRow } from "./compare";

const nvda = NVDA as unknown as LensPayload;
/** A smaller, faster-growing, lower-margin chip maker built from NVDA's payload. */
function challenger(): LensPayload {
  const p = JSON.parse(JSON.stringify(nvda)) as LensPayload;
  p.symbol = "CRDO"; p.company = "Credo";
  const set = (id: string, v: number, d: string) => { for (const c of p.cards) for (const m of c.metrics) if (m.id === id) { m.value = v; m.display = d; } };
  set("rev_growth_q", 210, "+210%"); set("rev_growth_ttm", 160, "+160%"); set("op_margin", 20, "20.0%"); set("roic", 30, "30.0%"); set("ps", 25, "25.0×"); set("pe", 80, "80.0×");
  p.statements = (p.statements ?? []).map((s) => ({ ...s, revenue: (s.revenue ?? 0) / 40, operating: (s.operating ?? 0) / 130 }));
  p.market = { ...p.market, marketCap: 25e9 };
  return p;
}

describe("vs leader", () => {
  const A = { p: challenger(), m: { rs_rating: 97, stage: 2, substage: "2A", return_1m: 12, return_3m: 40, fromHigh: -3 } };
  const B = { p: nvda, m: { rs_rating: 91, stage: 2, substage: "2B", return_1m: 4, return_3m: 15, fromHigh: -6 } };
  const groups = scorecard(A, B);

  it("scores each row in the right direction", () => {
    const row = (id: string) => groups.flatMap((g) => g.rows).find((r) => r.id === id)!;
    expect(row("rev_growth_q").winner).toBe("a");
    expect(row("op_margin").winner).toBe("b");
    expect(row("ps").winner).toBe("b");               // lower multiple = cheaper
    expect(row("interest_coverage").winner).toBe("tie"); // both carry no real interest burden
    expect(row("rs_rating").winner).toBe("a");
  });
  it("tallies business rows only and names the clearest edges", () => {
    const t = tally(groups);
    expect(t.compared).toBeGreaterThan(5);
    expect(t.bestA).toBe("Growth");
  });
  it("writes the headline from the numbers", () => {
    const s = compareStory(A, B, groups);
    expect(s.title).toMatch(/^CRDO grows 2\.0× faster than NVDA \(210% vs 106%\) and keeps less of each sales dollar \(20% vs 65% operating margin\); the market pays more for each dollar of its sales \(25\.0× vs 12\.4×\)$/);
    expect(s.paras.join(" ")).toMatch(/NVDA is 40× CRDO's size by revenue/);
    expect(compareStory(A, B, groups, true).title).toMatch(/^CRDO גדלה פי 2\.0 מהר יותר מ־NVDA/);
  });
  it("what it would take: the leader's margins on the challenger's sales", () => {
    const t = whatItTakes(A, B);
    expect(t[0].title).toBe("NVDA's margins on CRDO's sales");
    expect(t[0].text).toMatch(/would earn about \$[\d.]+[BM] more operating profit a year/);
  });
  it("size, quarterly series and bank rows", () => {
    expect(size(A, B).revX).toBeCloseTo(40, 0);
    const q = quarterSeries(nvda);
    expect(q).toHaveLength(8);
    expect(q.at(-1)!.growth).toBeCloseTo(cell({ p: nvda }, "rev_growth_q").value!, 0);
    const jpm = { ...(jpmRaw as unknown as LensPayload), market: { price: 290, marketCap: 800e9, asOf: null }, statements: statements(parseLensHistory(facts as never)) } as LensPayload;
    const banks = scorecard({ p: jpm }, { p: jpm });
    expect(banks.flatMap((g) => g.rows).some((r) => r.id === "bank_efficiency" && r.winner === "tie")).toBe(true);
    expect(banks.flatMap((g) => g.rows).some((r) => r.id === "pb" && r.a.value != null)).toBe(true);
    const words = [compareStory({ p: jpm }, { p: nvda }, scorecard({ p: jpm }, { p: nvda })).title, ...whatItTakes({ p: jpm }, { p: nvda }, true).map((x) => x.text)].join(" ");
    expect(words).not.toMatch(/undefined|NaN|Infinity|null/);
  });
  it("candidates: fundamental #1, largest and strongest RS; runner-up when the stock leads", () => {
    const peers: PeerRow[] = [
      { symbol: "AVGO", company: null, rank: 1, ranked: 5, score: 92, rsRating: 85, marketCap: 1.5e12 },
      { symbol: "NVDA", company: null, rank: 2, ranked: 5, score: 90, rsRating: 91, marketCap: 4e12 },
      { symbol: "CRDO", company: null, rank: 3, ranked: 5, score: 88, rsRating: 97, marketCap: 25e9 },
      { symbol: "ALAB", company: null, rank: 4, ranked: 5, score: 80, rsRating: 99, marketCap: 30e9 },
    ];
    const c = candidates("CRDO", peers);
    expect(c[0]).toMatchObject({ symbol: "AVGO", roles: ["fundamental"] });
    expect(c.find((x) => x.symbol === "NVDA")!.roles).toContain("largest");
    expect(c.find((x) => x.symbol === "ALAB")!.roles).toContain("rs");
    expect(candidates("AVGO", peers)[0]).toMatchObject({ symbol: "NVDA", roles: ["runner_up", "largest"] });
  });
});
