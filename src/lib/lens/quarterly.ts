import type { StatementPeriod } from '../../../supabase/functions/_shared/financialStatements';
export const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export function percentageChange(current: number | null, previous: number | null): number | null {
  return isNumber(current) && isNumber(previous) && previous > 0 && current >= 0 ? (current / previous - 1) * 100 : null;
}
/** Positive means a smaller loss. Only compares two strictly negative results. */
export function lossChange(current: number | null, previous: number | null): number | null {
  return isNumber(current) && isNumber(previous) && current < 0 && previous < 0
    ? ((current - previous) / Math.abs(previous)) * 100 : null;
}
export function signCrossover(current: number | null, previous: number | null): "up" | "down" | null {
  if (!isNumber(current) || !isNumber(previous)) return null;
  if (previous < 0 && current > 0) return "up";
  if (previous > 0 && current < 0) return "down";
  return null;
}
export function comparablePeriods(current: string, previous: string, lag: 1 | 4): boolean {
  const days = (Date.parse(current) - Date.parse(previous)) / 86400000;
  return lag === 1 ? days >= 75 && days <= 105 : days >= 350 && days <= 380;
}
export function comparisonQuarter(rows: StatementPeriod[], index: number, lag: 1 | 4): StatementPeriod | null {
  const current = rows[index], prior = rows[index - lag];
  return current && prior && comparablePeriods(current.end, prior.end, lag) ? prior : null;
}
export function quarterGrowth(rows: StatementPeriod[], index: number, field: keyof StatementPeriod, lag: 1 | 4,
  measure = percentageChange): number | null {
  const prior = comparisonQuarter(rows, index, lag);
  return prior ? measure(rows[index][field] as number | null, prior[field] as number | null) : null;
}
export function growthAcceleration(rows: StatementPeriod[], index: number, field: keyof StatementPeriod, lag: 1 | 4,
  measure = percentageChange): number | null {
  if (!comparisonQuarter(rows, index, 1)) return null;
  const current = quarterGrowth(rows, index, field, lag, measure);
  const previous = quarterGrowth(rows, index - 1, field, lag, measure);
  return current !== null && previous !== null ? current - previous : null;
}
export function latestQuarterSummary(periods: StatementPeriod[]) {
  const rows = periods.filter(p => p.kind === 'quarter').slice().sort((a,b) => a.end.localeCompare(b.end));
  const i = rows.length - 1, latest = rows[i], previous = rows[i-1];
  const yoy = quarterGrowth(rows,i,'revenue',4), priorYoy = quarterGrowth(rows,i-1,'revenue',4);
  return { rows, latest, previous, qoq:quarterGrowth(rows,i,'revenue',1), yoy, priorYoy,
    acceleration: growthAcceleration(rows, i, 'revenue', 4) };
}
