import { describe, expect, it } from "vitest";
import facts from "./__fixtures__/jpm-bank-facts.json";
import { parseLensHistory } from "../../../supabase/functions/_shared/lensMetrics";
import { statements } from "../../../supabase/functions/_shared/financialStatements";

// JPMorgan's SEC company facts, 2025–Q3 2026, for the tags a bank reports (no cost of revenue,
// gross or operating profit). Q4 2025 exists only as a full year, so it must be derived.
const rows = statements(parseLensHistory(facts as never));
const B = (v: number | null | undefined) => (v == null ? null : Math.round(v / 1e7) / 100);   // $ billions, 2 decimals

describe("bank income lines from SEC facts (JPM)", () => {
  it("reads the bank lines and leaves industrial lines empty", () => {
    const q = rows.find((r) => r.id === "quarter:2026-09-30")!;
    expect([B(q.revenue), B(q.nii), B(q.nonii), B(q.nonIntExp), B(q.provision), B(q.pretax), B(q.tax), B(q.net)])
      .toEqual([50.17, 27.04, 23.14, 27.3, 2.74, 20.13, 4.83, 15.31]);
    expect([q.cost, q.gross, q.operating]).toEqual([null, null, null]);
  });
  it("derives Q4 from the full year minus three quarters", () => {
    const q4 = rows.find((r) => r.id === "quarter:2025-12-31")!;
    expect([B(q4.revenue), B(q4.nonIntExp), B(q4.provision), B(q4.net)]).toEqual([45.8, 23.98, 4.66, 13.03]);
  });
  it("reconciles: revenue − expenses − provisions = profit before tax", () => {
    for (const r of rows) if (r.revenue != null && r.nonIntExp != null && r.provision != null && r.pretax != null)
      expect(Math.abs(r.revenue - r.nonIntExp - r.provision - r.pretax)).toBeLessThan(5e7);
    const ttm = rows.find((r) => r.kind === "ttm")!;
    expect([B(ttm.revenue), B(ttm.nonIntExp), B(ttm.provision), B(ttm.pretax)]).toEqual([203.15, 105.44, 12.42, 85.29]);
  });
});
