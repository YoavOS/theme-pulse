import { describe, expect, it } from "vitest";
import { canonEn, canonHe } from "./canon";

describe("one name per idea", () => {
  it("revenue, with the verb fixed", () => {
    expect(canonEn("Sales are growing — sales grew 83%")).toBe("Revenue is growing — revenue grew 83%");
    expect(canonEn("Over the last twelve months, sales grew 83.4%.")).toBe("Over the last 12 months, revenue grew 83.4%.");
    expect(canonEn("74.7% of sales · price ÷ yearly sales · sales growth")).toBe("74.7% of revenue · price ÷ yearly revenue · revenue growth");
    expect(canonEn("Each dollar of its sales")).toBe("Each dollar of its revenue");
  });
  it("keeps real metric names", () => {
    expect(canonEn("Price to sales (P/S) and Sales to invested capital")).toBe("Price to sales (P/S) and Sales to capital");
    expect(canonEn("Free cash flow (TTM) · TTM to 2026-07-26 · Revenue TTM · market value of all shares")).toBe("Free cash flow (last 12 months) · last 12 months to 2026-07-26 · Revenue, last 12 months · market cap of all shares");
    expect(canonEn("sales-to-capital and sales to capital")).toBe("sales-to-capital and sales to capital");
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
    expect(canonHe("המכירות צומחות · מכפיל מכירות · מכירות להון המושקע · תזרים חופשי")).toBe("ההכנסות צומחות · מכפיל מכירות · מכירות להון המושקע · תזרים מזומנים חופשי");
  });
});

import { canonEn as ce, canonHe as ch } from "./canon";
import { it as it2, expect as ex2 } from "vitest";
it2("keeps 'sales' when it means the sales team or function", () => {
  ex2(ce("$5B on sales, marketing and administration")).toBe("$5B on sales, marketing and administration");
  ex2(ce("Sales grew 10% and sales commissions rose")).toBe("Revenue grew 10% and sales commissions rose");
  ex2(ch("על מכירות ומטה")).toBe("על מכירות ומטה");
  ex2(ch("מכירות, שיווק ומטה")).toBe("מכירות, שיווק ומטה");
});
