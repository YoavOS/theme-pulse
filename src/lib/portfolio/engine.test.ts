import { describe, expect, it } from "vitest";
import { alertsFor, buildHoldings, closedStats, closedTrades, headline, nextEarnings, pastReports, sessionsUntil, summarize, technicals, type Bars, type PositionRow } from "./engine";

// Wed 2026-12-02, 11:00 New York (16:00 UTC)
const NOW = new Date("2026-12-02T16:00:00Z");
const row = (p: Partial<PositionRow>): PositionRow => ({ id: Math.random().toString(), symbol: "AAA", entry_date: "2026-11-02", entry_price: 100, shares: 10, initial_stop: 92, stop: null, target: null, setup: null, status: "open", exit_date: null, exit_price: null, notes: null, ...p });
function bars(n: number, f: (i: number) => number, start = "2025-12-01"): Bars {
  const d: string[] = []; let t = Date.parse(`${start}T12:00:00Z`);
  while (d.length < n) { const w = new Date(t).getUTCDay(); if (w && w !== 6) d.push(new Date(t).toISOString().slice(0, 10)); t += 86400_000; }
  const c = d.map((_, i) => f(i));
  return { d, o: c.map((x) => x * 0.995), h: c.map((x) => x * 1.01), l: c.map((x) => x * 0.99), c, v: c.map(() => 1e6) };
}

describe("earnings plan", () => {
  it("before the open: the last full session is the day before; after the close: the report day", () => {
    const bmo = nextEarnings([{ date: "2026-12-08", hour: "bmo", quarter: 3, year: 2026, epsActual: null, epsEstimate: 1, revenueActual: null, revenueEstimate: null }], NOW)!;
    expect(bmo.lastSession).toBe("2026-12-07");
    expect(bmo.sessionsLeft).toBe(4); // Wed, Thu, Fri, Mon
    const amc = nextEarnings([{ date: "2026-12-08", hour: "amc", quarter: 3, year: 2026, epsActual: null, epsEstimate: 1, revenueActual: null, revenueEstimate: null }], NOW)!;
    expect(amc.lastSession).toBe("2026-12-08");
    expect(amc.sessionsLeft).toBe(5);
  });
  it("skips holidays and counts today only before the close", () => {
    // Thanksgiving 2026-11-26: a before-open report on Fri 11-27 → last full session Wed 11-25
    const p = nextEarnings([{ date: "2026-11-27", hour: "bmo", quarter: 1, year: 2027, epsActual: null, epsEstimate: null, revenueActual: null, revenueEstimate: null }], new Date("2026-11-25T22:00:00Z"))!;
    expect(p.lastSession).toBe("2026-11-25");
    expect(p.sessionsLeft).toBe(0); // after Wednesday's close
    expect(sessionsUntil("2026-12-02", NOW)).toBe(1);
  });
  it("past reports: surprise and the reaction on the right day", () => {
    const b = bars(260, (i) => 100 + i * 0.1);
    const i = b.d.indexOf("2026-11-04");
    b.o[i + 1] = b.c[i] * 1.08; b.c[i + 1] = b.c[i] * 1.1;
    const r = pastReports([{ date: "2026-11-04", hour: "amc", quarter: 3, year: 2026, epsActual: 1.2, epsEstimate: 1, revenueActual: 110, revenueEstimate: 100 }], b, NOW)[0];
    expect(r.reactionDate).toBe("2026-11-05");
    expect(r.epsSurprisePct).toBeCloseTo(20);
    expect(r.gapPct).toBeCloseTo(8, 0);
    expect(r.dayPct).toBeCloseTo(10, 0);
  });
});

describe("holdings", () => {
  it("combines lots, P&L, R and day P&L (a lot bought today counts from its entry)", () => {
    const rows = [row({ shares: 10, entry_price: 100, initial_stop: 90 }), row({ shares: 10, entry_price: 110, initial_stop: 100, entry_date: "2026-12-02" })];
    const [h] = buildHoldings(rows, { AAA: { price: 120, prevClose: 115, dayHigh: null, dayLow: null, volume: null, time: null } }, {}, NOW);
    expect(h.shares).toBe(20);
    expect(h.avgCost).toBe(105);
    expect(h.openPnl).toBe(300);
    expect(h.rMultiple).toBeCloseTo(1.5); // 300 / (10*10 + 10*10)
    expect(h.dayPnl).toBe(10 * 5 + 10 * 10);
    expect(h.stop).toBe(90);
    expect(h.riskToStop).toBe(20 * 30);
    expect(h.weight).toBe(100);
  });
  it("closed trades and stats", () => {
    const t = closedTrades([row({ status: "closed", exit_price: 120, exit_date: "2026-11-20" }), row({ status: "closed", exit_price: 95, exit_date: "2026-11-10" })]);
    const s = closedStats(t);
    expect(s.realized).toBe(200 - 50);
    expect(s.winRate).toBe(50);
    expect(t[0].r).toBeCloseTo(2.5);
  });
});

describe("technicals and alerts", () => {
  it("RS line new high, distances, extended and earnings alerts", () => {
    const b = bars(260, (i) => 50 + i * 0.3), spy = bars(260, () => 500);
    const t = technicals(b, spy)!;
    expect(t.rs?.newHigh).toBe(true);
    expect(t.vsSma50).toBeGreaterThan(0);
    const [h] = buildHoldings([row({ symbol: "AAA", stop: 100 })], {}, { AAA: b }, NOW);
    const plan = nextEarnings([{ date: "2026-12-03", hour: "amc", quarter: 3, year: 2026, epsActual: null, epsEstimate: null, revenueActual: null, revenueEstimate: null }], NOW);
    const a = alertsFor(h, t, plan, [{ headline: "x", summary: null, source: null, url: "u", time: NOW.getTime() / 1000 - 3600 }], 5, NOW);
    expect(a.map((x) => x.kind)).toEqual(expect.arrayContaining(["earnings", "rsHigh", "news"]));
    expect(a.find((x) => x.kind === "earnings")!.level).toBe("high");
    const s = summarize([h], {}, { AAA: plan }, 100000);
    expect(headline(s)).toMatch(/^1 position, \+\$.* open .*; AAA reports in 1 day$/);
  });
  it("a falling stock below its averages and its stop", () => {
    const b = bars(260, (i) => 200 - i * 0.4);
    const t = technicals(b, null)!;
    const [h] = buildHoldings([row({ stop: 120 })], {}, { AAA: b }, NOW);
    const kinds = alertsFor(h, t, null, null, 5, NOW).map((x) => x.kind);
    expect(kinds).toContain("stop");
    expect(kinds).toContain("below50");
  });
});
