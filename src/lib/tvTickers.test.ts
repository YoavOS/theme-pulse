import { describe, expect, it } from "vitest";
import { tickersIn } from "@/lib/tvTickers";
import { buildTvText } from "@/lib/industryRanking";

const known = new Set(["NVDA", "AMD", "ON", "NOW", "BRK.B", "IT", "A", "RCEL"]);
describe("tickers in AI-written text", () => {
  it("keeps universe tickers in order and skips words that look like tickers", () => {
    const text = "NVDA leads; AMD is ON watch NOW. The EMA and RS of RCEL look fine. NVDA again. IT and A are words.";
    expect(tickersIn(text, known)).toEqual(["NVDA", "AMD", "RCEL"]);
  });
  it("accepts ambiguous tickers written as $TICKER or `TICKER`", () => {
    expect(tickersIn("Watch $ON and `NOW` and BRK.B.", known)).toEqual(["ON", "NOW", "BRK.B"]);
  });
});
describe("TradingView text", () => {
  it("writes sections, de-duplicates and uses TradingView share-class format", () => {
    const b = buildTvText([{ name: "21 EMA pullbacks", symbols: ["RCEL", "BRK-B"] }, { name: "Bought on red days", symbols: ["RCEL", "SG"] }]);
    expect(b.text).toBe("###21 EMA pullbacks\nRCEL,BRK.B\n###Bought on red days\nSG\n");
    expect([b.symbols, b.dupes]).toEqual([3, 1]);
  });
});
