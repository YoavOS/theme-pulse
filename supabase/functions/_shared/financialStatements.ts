import { consecutiveQuarters, type CompanyHistory, type QuarterRow } from "./lensMetrics.ts";
export interface StatementPeriod {
  sourceUrl?: string; dilutedEPS?: number | null;
  id: string; end: string; kind: "ttm" | "quarter"; revenue: number | null; cost: number | null; gross: number | null;
  operating: number | null; net: number | null; tax: number | null; rnd: number | null; sga: number | null;
  ocf: number | null; capex: number | null; sbc: number | null; shares: number | null;
  /** Bank income statement lines (null for other companies). */
  nii?: number | null; nonii?: number | null; nonIntExp?: number | null; provision?: number | null; pretax?: number | null;
}
const fields = { revenue:"revenue", cost:"costOfRevenue", gross:"grossProfit", operating:"operatingIncome", net:"netIncome", tax:"tax", rnd:"rnd", sga:"sga", ocf:"ocf", capex:"capex", sbc:"sbc", nii:"netInterestIncome", nonii:"noninterestIncome", nonIntExp:"noninterestExpense", provision:"provision", pretax:"pretax" } as const;
export function statements(h: CompanyHistory): StatementPeriod[] {
  const build = (qs: QuarterRow[], kind: "ttm" | "quarter"): StatementPeriod => {
    const row: any = { id: kind + ":" + qs[0].end, end: qs[0].end, kind, shares: qs[0].shares };
    if (kind === "quarter") {
      row.dilutedEPS = qs[0].dilutedEPS ?? null;
      row.sourceUrl = qs[0].sourceUrl;
    }
    for (const [key, field] of Object.entries(fields)) {
      const xs = qs.map(q => q.flow[field as keyof QuarterRow["flow"]]);
      row[key] = xs.every(x => typeof x === "number" && Number.isFinite(x)) ? (xs as number[]).reduce((a,b)=>a+b,0) : null;
    }
    // Accounting identity; retain unknown when neither side is reported.
    if (row.cost === null && row.revenue !== null && row.gross !== null) row.cost = row.revenue-row.gross;
    return row;
  };
  const out = h.quarters.map(q=>build([q],"quarter"));
  if (h.quarters.length >= 4) {
    const qs=h.quarters.slice(0,4);
    if(consecutiveQuarters(qs)) out.unshift(build(qs,"ttm"));
  }
  return out;
}
