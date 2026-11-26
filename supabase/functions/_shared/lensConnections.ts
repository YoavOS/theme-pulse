import type { QuarterRow } from "./lensMetrics.ts";

export function lensConnection(quarters: QuarterRow[]) {
  const latest = quarters[0];
  if (!latest) return null;
  const before = quarters.find(q => {
    const days = (Date.parse(latest.end) - Date.parse(q.end)) / 86400000;
    return days >= 75 && days <= 105;
  });
  const yearAgo = quarters.find(q => {
    const days = (Date.parse(latest.end) - Date.parse(q.end)) / 86400000;
    return days >= 350 && days <= 380;
  });
  const delta = (a: number | null | undefined, b: number | null | undefined) =>
    typeof a === "number" && typeof b === "number" ? a - b : null;
  const flow = latest.flow;
  const comparableAdvances = before && latest.fallback.includes("contractLiability") === before.fallback.includes("contractLiability");
  return {
    end: latest.end, priorEnd: before?.end ?? null,
    revenue: flow.revenue ?? null, priorRevenue: before?.flow.revenue ?? null,
    net: flow.netIncome ?? null, operatingIncome: flow.operatingIncome ?? null,
    priorOperatingIncome: before?.flow.operatingIncome ?? null,
    cash: latest.inst.cashOnly ?? null, priorCash: before?.inst.cashOnly ?? null,
    cashChange: delta(latest.inst.cashOnly, before?.inst.cashOnly),
    customerAdvancesChange: comparableAdvances ? delta(latest.inst.contractLiability, before?.inst.contractLiability) : null,
    receivablesChange: delta(latest.inst.receivables, before?.inst.receivables),
    operatingCash: flow.ocf ?? null, investingCash: flow.investingCash ?? null, financingCash: flow.financingCash ?? null,
    borrowing: flow.borrowingProceeds ?? null, repaid: flow.borrowingRepayments ?? null,
    capex: flow.capex ?? null, priorCapex: before?.flow.capex ?? null,
    priorOperatingCash: before?.flow.ocf ?? null, acquisitions: flow.acquisitions ?? null,
    tax: flow.tax ?? null, pretax: flow.pretax ?? null,
    interest: flow.interest ?? null, priorInterest: before?.flow.interest ?? null,
    longTermDebt: latest.fallback.includes("ltdNoncurrent") ? null : latest.inst.ltdNoncurrent ?? null,
    shortTermDebt: latest.fallback.includes("debtCurrent") ? null : latest.inst.debtCurrent ?? null,
    buybacks: flow.buybacks ?? null, stockCompensation: flow.sbc ?? null, stockIssued: flow.stockIssued ?? null,
    dilutedShares: latest.dilutedShares ?? null, yearAgoDilutedShares: yearAgo?.dilutedShares ?? null,
  };
}

export type LensConnection = NonNullable<ReturnType<typeof lensConnection>>;
export interface BusinessContext {
  description: string | null;
  industry: string | null;
  annualUrl: string | null;
  annualFiled: string | null;
}
export interface MarketPricing {
  capDate: string | null;
  priceDate: string | null;
  multiplesDate: string | null;
  pe: number | null;
  ps: number | null;
  pb: number | null;
  peerPe: { median: string; group: string; n: number } | null;
}

