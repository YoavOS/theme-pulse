import { useState } from "react";
import { useLensLang } from "@/lib/lens/i18n";
import { comparablePeriods, isNumber, percentageChange } from "@/lib/lens/quarterly";
import type { StatementPeriod } from "../../../supabase/functions/_shared/financialStatements";
import { CHART } from "./QuarterlyChart";
import { AutoTerms, Term } from "./Term";

export const flowSteps = ["revenue", "gross", "operating", "net", "directCost", "operatingExpense", "nonOperating"] as const;
export type FlowStep = typeof flowSteps[number];

function difference(a: number | null, b: number | null) {
  return isNumber(a) && isNumber(b) ? a - b : null;
}

export function flowAmount(row: StatementPeriod, step: FlowStep) {
  switch (step) {
    case "directCost": return difference(row.revenue, row.gross) ?? row.cost;
    case "operatingExpense": return difference(row.gross, row.operating);
    case "nonOperating": return difference(row.operating, row.net);
    default: return row[step];
  }
}

export function shareOfRevenue(value: number | null, revenue: number | null) {
  return isNumber(value) && isNumber(revenue) && revenue > 0 ? 100 * value / revenue : null;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });
const asMoney = (n: number | null) => n === null ? "—" : usd.format(n);
const asPercent = (n: number | null) => n === null ? "—" : n.toFixed(1) + "%";
const signed = (n: number | null, unit: string) => n === null ? "—" : (n > 0 ? "+" : "") + n.toFixed(1) + unit;

export function IncomeFlowTrend({ periods, period, step, label, onSelect }: {
  periods: StatementPeriod[];
  period: StatementPeriod;
  step: FlowStep;
  label: string;
  onSelect: (id: string) => void;
}) {
  const he = useLensLang() === "he";
  const t = (en: string, translated: string) => he ? translated : en;
  const [view, setView] = useState<"amount" | "share">("amount");
  const byShare = step !== "revenue" && view === "share";
  const quarters = periods.filter(p => p.kind === "quarter").sort((a, b) => a.end.localeCompare(b.end));
  const current = period.kind === "quarter" ? period : quarters[quarters.length - 1];
  const earlier = current && quarters.find(p => comparablePeriods(current.end, p.end, 4));
  const toPoint = (p: StatementPeriod) => {
    const amount = flowAmount(p, step);
    return { ...p, amount, share: shareOfRevenue(amount, p.revenue) };
  };
  const selected = current && toPoint(current);
  const prior = earlier && toPoint(earlier);
  const get = (p: ReturnType<typeof toPoint>) => byShare ? p.share : p.amount;
  const selectedIndex = quarters.findIndex(quarter => quarter.id === period.id);
  // Keep a recently selected quarter visible, including quarters outside the latest eight.
  const start = selectedIndex >= 0 ? Math.min(selectedIndex, Math.max(0, quarters.length - 8)) : Math.max(0, quarters.length - 8);
  const points = quarters.slice(start, start + 8).map(toPoint);
  const values = points.map(get).filter(isNumber);
  const amountChange = selected && prior ? percentageChange(selected.amount, prior.amount) : null;
  const shareChange = selected && prior ? difference(selected.share, prior.share) : null;
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const y = (n: number) => 102 - (n - low) * 90 / (high - low || 1);
  const x = (i: number) => 56 + (i + .5) * 488 / Math.max(1, points.length);
  const format = byShare ? asPercent : asMoney;
  const ticks = high === low ? [0] : low < 0 && high > 0 ? [high, 0, low] : [high, (high + low) / 2, low];
  const path = points.map((p, i) => {
    const value = get(p);
    if (value === null) return "";
    const previous = points[i - 1];
    const connected = previous && get(previous) !== null && comparablePeriods(p.end, previous.end, 1);
    const command = connected ? "L" : "M";
    return command + x(i) + " " + y(value);
  }).join(" ");

  return <div className="mt-4 rounded-xl border border-border bg-background/35 p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold"><AutoTerms text={label}/> · {t("Quarterly trend", "מגמה רבעונית")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("Select a quarter in the trend to update the flow above.", "בחירת רבעון במגמה מעדכנת את תרשים הזרימה למעלה.")}</p>
      </div>
      {step !== "revenue" && <div role="group" aria-label={t("Trend units", "יחידות לתצוגת המגמה")} className="flex rounded-lg border border-border p-0.5">
        {(["amount", "share"] as const).map(unit => <button key={unit} type="button" aria-pressed={view === unit} onClick={() => setView(unit)}
          className={"rounded-md px-2 py-1 text-xs " + (unit === view ? "bg-primary/20 text-primary" : "text-muted-foreground")}>
          {unit === "amount" ? t("Dollars", "דולרים") : t("% of revenue", "% מההכנסות")}
        </button>)}
      </div>}
    </div>
    {selected && <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <bdi>{selected.end}</bdi>
      <span><bdi className="font-mono font-semibold text-foreground">{asMoney(selected.amount)}</bdi>{" · "}<Term id="yoy">{t("YoY", "שינוי שנתי")}</Term> <bdi>{signed(amountChange, "%")}</bdi></span>
      {step !== "revenue" && <span><bdi className="font-mono font-semibold text-foreground">{asPercent(selected.share)}</bdi>{" "}<Term id="per100">{t("of revenue", "מההכנסות")}</Term>
        {" · "}<Term id="yoy">{t("YoY", "שינוי שנתי")}</Term> <bdi>{signed(shareChange, " pp")}</bdi></span>}
    </div>}
    {points.length ? <div className="mt-3 overflow-x-auto">
      <svg className="mx-auto block w-full min-w-[480px] max-w-4xl" viewBox="0 0 570 134" direction="ltr" role="group"
        aria-label={label + " · " + (byShare ? t("Share of revenue", "חלק מההכנסות") : t("Dollars", "דולרים"))}>
        {ticks.map(v => <g key={v}>
          <line x1="56" x2="544" y1={y(v)} y2={y(v)} stroke="currentColor" opacity={v === 0 ? ".4" : ".15"} />
          {(v === 0 || Math.abs(y(v) - y(0)) > 15) && <text x="51" y={y(v) + 4} textAnchor="end" fill="currentColor" opacity=".7" fontSize="10">{format(v)}</text>}
        </g>)}
        <path d={path} stroke={byShare ? CHART.growth : CHART.positive} fill="none" strokeWidth="2" />
        {points.map((p, i) => {
          const value = get(p);
          const active = p.id === period.id;
          const description = p.end + " · " + format(value);
          return <g key={p.id} role="button" tabIndex={0} aria-label={description} aria-pressed={active}
            onClick={() => onSelect(p.id)}
            onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(p.id); } }}
            className="group cursor-pointer focus-visible:outline-none">
            <rect x={x(i) - 15} y="5" width="30" height="126" rx="4" fill="currentColor"
              className={active ? "opacity-15" : "opacity-0 group-hover:opacity-10 group-focus-visible:opacity-20"} />
            {value !== null && <circle cx={x(i)} cy={y(value)} r={active ? 5 : 3.5}
              fill={value < 0 ? CHART.negative : byShare ? CHART.growth : CHART.positive} />}
            <text x={x(i)} y="124" textAnchor="middle" fill="currentColor" opacity={active ? 1 : .75} fontSize="11">{p.end.slice(2, 7)}</text>
            <title>{description}</title>
          </g>;
        })}
        {!values.length && <text x="300" y="52" textAnchor="middle" fill="currentColor" opacity=".7" fontSize="11">
          {t("No reported figures for this view", "אין נתונים מדווחים לתצוגה הזו")}
        </text>}
      </svg>
    </div> : <p className="mt-3 text-xs text-muted-foreground">{t("No quarterly history available.", "אין היסטוריה רבעונית זמינה.")}</p>}
  </div>;
}

