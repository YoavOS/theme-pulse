import { describe, expect, it } from "vitest";
import type { LensPayload } from "@/lib/lens/types";
import NVDA from "./__fixtures__/lens-NVDA.json";
import jpmRaw from "./__fixtures__/lens-JPM.json";
import facts from "./__fixtures__/jpm-bank-facts.json";
import { parseLensHistory } from "../../../supabase/functions/_shared/lensMetrics";
import { statements } from "../../../supabase/functions/_shared/financialStatements";
import { businessWords } from "./businessWords";
import { flowStepNote, wholePicture } from "./wholePicture";

const nvda = NVDA as unknown as LensPayload;
const jpm = { ...(jpmRaw as unknown as LensPayload), market: { price: 290, marketCap: 800e9, asOf: null }, statements: statements(parseLensHistory(facts as never)) } as LensPayload;
const clean = (s: string) => expect(s).not.toMatch(/undefined|NaN|Infinity|null|\$-|—%/);

describe("the whole picture", () => {
  it("uses the company's own words and dollars (chip maker)", () => {
    expect(businessWords(nvda).sells).toBe("chips and computing systems");
    const pic = wholePicture(nvda)!;
    expect(pic.steps.map((s) => s.key)).toEqual(["sells", "making", "running", "owners", "capital", "growth", "price"]);
    expect(pic.steps[0].text).toMatch(/^In the last 12 months NVIDIA Corporation sold \$\d+(\.\d)?B of chips and computing systems — \d+% more than the year before\.$/);
    expect(pic.steps[1].text).toMatch(/^Making the chips — wafers from the factories .* cost \$[\d.]+B — \$\d+ of every \$100 of revenue\./);
    expect(pic.steps[4].text).toMatch(/creates value/);
    expect(pic.summary).toMatch(/^In one line: NVIDIA Corporation earns well above what its money costs, growing fast, priced for less growth than it has delivered\.$/);
    const total = pic.per100.reduce((a, s) => a + s.per100, 0);
    expect(total).toBeGreaterThan(97); expect(total).toBeLessThan(103);
    pic.steps.forEach((s) => clean(s.text));
    wholePicture(nvda, true)!.steps.forEach((s) => clean(s.text));
  });
  it("banks: interest, running costs, bad loans, return on equity, book value", () => {
    expect(businessWords(jpm).sells).toBe("loans and banking services");
    const pic = wholePicture(jpm)!;
    expect(pic.bank).toBe(true);
    expect(pic.steps.map((s) => s.key)).toEqual(["sells", "running", "credit", "owners", "capital", "price"]);
    expect(pic.steps[0].text).toMatch(/net interest income/);
    expect(pic.steps[5].text).toMatch(/book value/);
    pic.steps.forEach((s) => clean(s.text));
  });
  it("flow notes speak the company's language", () => {
    expect(flowStepNote(nvda, "cost", 54e9, 187e9)).toBe("Making the chips — wafers from the factories that produce them, memory, packaging and testing: $54B, or $29 of every $100 of revenue.");
    expect(flowStepNote({ ...nvda, classification: { sector: "Consumer Discretionary", industry: "Textiles, Apparel & Luxury Goods", subIndustry: "Apparel Retail" } } as LensPayload, "cost", 6e9, 10e9))
      .toBe("The clothes themselves — buying or making them, shipping them to stores: $6B, or $60 of every $100 of revenue.");
  });
});
