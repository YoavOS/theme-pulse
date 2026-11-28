import { describe, expect, it } from "vitest";
import { canonEn, canonHe } from "./canon";

describe("one name per idea", () => {
  it("revenue, with the verb fixed", () => {
    expect(canonEn("Sales are growing — sales grew 83%")).toBe("Revenue is growing — revenue grew 83%");
    expect(canonEn("Over the last twelve months, sales grew 83.4%.")).toBe("Over the last 12 months, revenue grew 83.4%.");
    expect(canonEn("74.7% of sales · price ÷ yearly sales · sales growth")).toBe("74.7% of revenue · price ÷ yearly revenue · revenue growth");
    expect(canonEn("Each dollar of its sales")).toBe("Each dollar of its revenue");
  });
  it("renames metric names too", () => {
    expect(canonEn("Price to sales (P/S) and Sales to invested capital")).toBe("Price to revenue (P/S) and Revenue to capital");
    expect(canonEn("Free cash flow (TTM) · TTM to 2026-07-26 · Revenue TTM · market value of all shares")).toBe("Free cash flow (last 12 months) · last 12 months to 2026-07-26 · Revenue, last 12 months · market cap of all shares");
    expect(canonEn("sales-to-capital and sales to capital")).toBe("revenue-to-capital and revenue to capital");
  });
  it("profit names, market cap, returns", () => {
    expect(canonEn("Operating income growth and net income")).toBe("Operating profit growth and net profit");
    expect(canonEn("Equity market value · bigger by market value")).toBe("Market cap · bigger by market cap");
    expect(canonEn("Return on capital minus cost of capital")).toBe("Excess return (return on invested capital minus cost of capital)");
    expect(canonEn("its return on capital beats")).toBe("its return on invested capital beats");
    expect(canonEn("return on new capital")).toBe("return on new capital");
    expect(canonEn("runway and cash runway; after direct costs; stock compensation")).toBe("cash runway and cash runway; after cost of revenue; stock-based compensation");
  });
  it("Hebrew", () => {
    expect(canonHe("המכירות צומחות · מכפיל מכירות · מכירות להון המושקע · תזרים חופשי")).toBe("ההכנסות צומחות · מכפיל הכנסות · הכנסות להון המושקע · תזרים מזומנים חופשי");
  });
});

import { canonEn as ce, canonHe as ch } from "./canon";
import { it as it2, expect as ex2 } from "vitest";
it2("never shows the word sale: it is revenue everywhere", () => {
  ex2(ce("Sales are up and each sale earns more")).toBe("Revenue is up and each dollar of revenue earns more");
  ex2(ce("Price to sales (P/S) and Sales to invested capital")).toBe("Price to revenue (P/S) and Revenue to capital");
  ex2(ce("$5B on sales, marketing and administration; sales teams")).toBe("$5B on selling, marketing and administration; selling teams");
  ex2(ch("מכפיל מכירות, מכירות להון ועל מכירות ומטה")).toBe("מכפיל הכנסות, הכנסות להון ועל שיווק ומטה");
  ex2(ch("מכל מכירה")).toBe("מכל דולר הכנסות");
});
