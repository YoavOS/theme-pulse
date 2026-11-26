import { describe, expect, it } from "vitest";
import type { LensPayload } from "./types";
import { quarterNote } from "./companyQuarterNote";

// Five consecutive quarters: latest YoY = 1300/1000 → +30%, QoQ = 1300/1250 → +4%; no year-earlier quarter for the one before.
const q = (end: string, revenue: number, extra: Record<string, number | null> = {}) =>
  ({ id: "quarter:" + end, end, kind: "quarter", revenue, cost: 520, gross: revenue - 520, operating: 260, net: 300, tax: 10, rnd: null, sga: null, ocf: null, capex: null, sbc: null, shares: null, dilutedEPS: null, ...extra });
const payload = {
  symbol: "TEST", financial: false,
  market: { price: 42.5, marketCap: 25e9, asOf: "2026-11-20T00:00:00Z" },
  marketPricing: { capDate: "2026-11-20", priceDate: null, multiplesDate: null, pe: null, ps: null, pb: 3.25, peerPe: null },
  statements: [
    q("2025-09-30", 1000, { dilutedEPS: 1.0 }), q("2025-12-31", 1000), q("2026-03-31", 1100), q("2026-06-30", 1250),
    q("2026-09-30", 1300, { dilutedEPS: 1.25 }),
  ],
} as unknown as LensPayload;

describe("company lines from the latest quarter", () => {
  it("reports YoY, and no acceleration without two comparable YoY rates", () => {
    const yoy = quarterNote("yoy", payload, "en")!;
    expect(yoy[0]).toContain("+30.0%");
    expect(yoy).toHaveLength(1);
    const acc = quarterNote("acceleration", payload, "en");
    expect(acc).toBeNull(); // the year-earlier quarter for the previous quarter is missing in this fixture
  });
  it("reports QoQ and points to YoY", () => {
    const qoq = quarterNote("qoq", payload, "en")!;
    expect(qoq[0]).toContain("+4.0%");
    expect(qoq[1]).toContain("+30.0%");
  });
  it("puts costs per $100 of sales and flags net above operating profit", () => {
    expect(quarterNote("cost_of_revenue", payload, "en")![0]).toContain("$40.0 of every $100");
    expect(quarterNote("operating_income", payload, "en")![0]).toContain("(20.0% of sales)");
    expect(quarterNote("net_income", payload, "en")![1]).toContain("above operating profit");
  });
  it("compares EPS with the same quarter a year earlier", () => {
    const eps = quarterNote("eps", payload, "en")!;
    expect(eps[0]).toContain("$1.25");
    expect(eps[1]).toContain("+25.0%");
  });
  it("uses the market snapshot and says nothing when data is missing", () => {
    expect(quarterNote("market_cap", payload, "en")![0]).toContain("$25.0B");
    expect(quarterNote("pb", payload, "en")![0]).toContain("3.3×");
    expect(quarterNote("opex", { ...payload, statements: [] } as LensPayload, "en")).toBeNull();
    expect(quarterNote("moat", payload, "en")).toBeNull();
  });
  it("writes Hebrew with left-to-right numbers", () => {
    const he = quarterNote("yoy", payload, "he")!;
    expect(he[0]).toContain("מול אותו רבעון אשתקד");
    expect(he[0]).toContain("⁦+30.0%⁩");
  });
});
