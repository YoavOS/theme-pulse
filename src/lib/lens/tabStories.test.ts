import { describe, expect, it } from "vitest";
import type { LensPayload } from "./types";
import nvdaRaw from "./__fixtures__/lens-NVDA.json";
import jpmRaw from "./__fixtures__/lens-JPM.json";
import facts from "./__fixtures__/jpm-bank-facts.json";
import { parseLensHistory } from "../../../supabase/functions/_shared/lensMetrics";
import { statements } from "../../../supabase/functions/_shared/financialStatements";
import { bankMeasures, capPriceCheck, evidenceStory, learnStory, statementsStory, valuationFacts, valuationStory, type TabStory } from "./tabStories";

// Saved Lens responses (Nov 22). JPM gets the bank statement lines parsed from its SEC facts.
const NVDA = nvdaRaw as unknown as LensPayload;
// The saved JPM response has no market snapshot; give it one ($800B cap, $290/share) so the price logic runs.
const JPM = { ...(jpmRaw as unknown as LensPayload), market: { price: 290, marketCap: 800e9, asOf: "2026-11-20T00:00:00Z" }, statements: statements(parseLensHistory(facts as never)) } as LensPayload;
const words = (s: TabStory) => [s.title, ...s.paras, ...s.kpis.flatMap((k) => [k.label, k.value, k.caption ?? ""]), s.footer ?? "", s.watch ?? ""].join(" | ");

describe("tab stories", () => {
  it("never print undefined, NaN or Infinity, in either language", () => {
    for (const he of [false, true]) for (const s of [statementsStory(NVDA, he), statementsStory(JPM, he), valuationStory(NVDA, he), valuationStory(JPM, he),
      evidenceStory(NVDA, null, he), evidenceStory(JPM, null, he), learnStory(NVDA, 3, 23, 120, he)])
      expect(words(s)).not.toMatch(/undefined|NaN|Infinity|null/);
  });
  it("statements: NVDA keeps about $64 of every $100 as net profit", () => {
    const s = statementsStory(NVDA, false);
    expect(s.title).toContain("$64");
    expect(s.kpis.map((k) => k.value)).toEqual([expect.stringMatching(/^\$303(\.0)?B$/), "74.7%", "65.2%", "63.7%"]);
    expect(s.footer).toContain("Free cash flow");
  });
  it("statements: a bank gets the bank view (efficiency, provisions)", () => {
    const s = statementsStory(JPM, false);
    expect(s.title).toContain("of revenue");
    expect(s.kpis[1]).toMatchObject({ label: "Efficiency ratio", value: "52%" });   // 105.44 ÷ 203.15
    expect(s.paras[1]).toContain("net interest income");
  });
  it("valuation: NVDA's price turned into the growth it needs, and the cap/price mismatch is flagged", () => {
    const s = valuationStory(NVDA, false);
    expect(s.title).toMatch(/keeps today's margins, the price needs about \d+% revenue growth/);
    expect(s.kpis[3].value).toMatch(/^\d+%\/yr$/);
    const c = capPriceCheck(NVDA)!;
    expect(Math.round(c.gapPct)).toBe(23);              // $3.76T ÷ $125.53 = 30.0B shares vs 24.3B reported
    expect(s.watch).toContain("don't match");
  });
  it("valuation: a bank is read as price to book against return on equity", () => {
    const f = valuationFacts(JPM);
    expect(f.justifiedPb).toBeCloseTo((18.3 - 3) / (7.3 - 3), 1);
    expect(f.pb).toBeCloseTo(800 / (66.0 / 0.183), 1);   // book equity = net profit ÷ ROE
    expect(valuationStory(JPM, false).title).toMatch(/Investors pay 2\.2× book value for a 18\.3% return on equity/);
    expect(valuationStory({ ...JPM, market: { price: null, marketCap: null, asOf: null } } as LensPayload, false).title).toMatch(/read the price against its return on equity/);
  });
  it("evidence: return against the hurdle", () => {
    expect(evidenceStory(NVDA, null, false).title).toBe("Earns 320% on capital that costs 10.6%");
    expect(evidenceStory(JPM, null, false).title).toBe("Earns 18% on equity that costs 7.3%");
  });
  it("bank measures: efficiency and provisions per quarter, with the year-earlier quarter", () => {
    const b = bankMeasures(JPM.statements!)!;
    expect(b.latest.end).toBe("2026-09-30");
    expect(b.latest.efficiency).toBeCloseTo(100 * 27.295 / 50.172, 1);
    expect(b.yearAgo?.end).toBe("2025-09-30");
    expect(bankMeasures(NVDA.statements!)).toBeNull();
  });
});
