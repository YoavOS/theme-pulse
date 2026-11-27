import type { LensPayload, Metric } from "@/lib/lens/types";
import type { StatementPeriod } from "../../../supabase/functions/_shared/financialStatements";
import { isNumber } from "@/lib/lens/quarterly";
import { bankMeasures, valuationFacts } from "@/lib/lens/tabStories";

/**
 * "vs Leader" — one company against the leader of its industry (or any company you pick).
 * Pure functions, tested in compare.test.ts. Both sides come from the same Fundamentals payload,
 * so every number is measured the same way. Describes the data; never says buy or sell.
 */

type T = (en: string, he: string) => string;
const tr = (he: boolean): T => (en, h) => (he ? h : en);
const money = (n: number | null | undefined) => !isNumber(n) ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n);
const pct = (n: number | null | undefined, d = 1) => !isNumber(n) ? "—" : `${n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}%`;
const times = (n: number | null | undefined, d = 1) => !isNumber(n) ? "—" : `${n.toFixed(d)}×`;
const ratio = (a: number, b: number) => (a >= b ? a / b : b / a);

export interface Momentum { rs_rating: number | null; stage: number | null; substage: string | null; return_1m: number | null; return_3m: number | null; fromHigh: number | null }
export interface Side { p: LensPayload; m?: Momentum | null }

// ── Scorecard ─────────────────────────────────────────────────────────────────

export type Dir = "up" | "down" | "none";
export type GroupKind = "business" | "price" | "momentum";
export interface RowDef { id: string; dir: Dir; en?: string; he?: string; unit?: Metric["unit"] }
export interface GroupDef { key: string; kind: GroupKind; en: string; he: string; qEn: string; qHe: string; rows: RowDef[] }

export const GROUPS: GroupDef[] = [
  { key: "growth", kind: "business", en: "Growth", he: "צמיחה", qEn: "Who is getting bigger faster?", qHe: "מי גדלה מהר יותר?", rows: [
    { id: "rev_growth_q", dir: "up" }, { id: "rev_growth_ttm", dir: "up" }, { id: "rev_cagr_3y", dir: "up" }, { id: "opinc_growth_ttm", dir: "up" }, { id: "ni_growth_ttm", dir: "up" }] },
  { key: "profit", kind: "business", en: "Profitability", he: "רווחיות", qEn: "Who keeps more of each sales dollar?", qHe: "מי משאירה יותר מכל דולר מכירות?", rows: [
    { id: "gross_margin", dir: "up" }, { id: "op_margin", dir: "up" }, { id: "net_margin", dir: "up" }, { id: "op_margin_change", dir: "up" },
    { id: "bank_efficiency", dir: "down", en: "Efficiency ratio (expenses ÷ revenue)", he: "יחס יעילות (הוצאות ÷ הכנסות)", unit: "pct" },
    { id: "bank_provisions", dir: "down", en: "Credit-loss provisions as % of revenue", he: "הפרשות להפסדי אשראי כאחוז מההכנסות", unit: "pct" }] },
  { key: "returns", kind: "business", en: "Returns on capital", he: "תשואה על ההון", qEn: "Who earns more on the money put in?", qHe: "מי מרוויחה יותר על הכסף שהושקע?", rows: [
    { id: "roic", dir: "up" }, { id: "excess_return", dir: "up" }, { id: "roe", dir: "up" }, { id: "equity_spread", dir: "up" }] },
  { key: "reinvest", kind: "business", en: "Reinvestment & cash", he: "השקעה חוזרת ומזומן", qEn: "Who turns growth into cash more cheaply?", qHe: "מי הופכת צמיחה למזומן בזול יותר?", rows: [
    { id: "sales_to_capital", dir: "up" }, { id: "fcf_margin", dir: "up" }, { id: "sbc_intensity", dir: "down" }] },
  { key: "risk", kind: "business", en: "Balance sheet & dilution", he: "מאזן ודילול", qEn: "Who is sturdier, and who protects its shareholders' slice?", qHe: "מי יציבה יותר, ומי שומרת על החלק של בעלי המניות?", rows: [
    { id: "debt_to_capital", dir: "down" }, { id: "debt_to_ebitda", dir: "down" }, { id: "interest_coverage", dir: "up" }, { id: "share_change", dir: "down" }] },
  { key: "price", kind: "price", en: "What the market pays", he: "כמה השוק משלם", qEn: "Whose growth is priced more cheaply?", qHe: "של מי הצמיחה מתומחרת בזול יותר?", rows: [
    { id: "pe", dir: "down" }, { id: "ps", dir: "down" }, { id: "ev_ebit", dir: "down" },
    { id: "pb", dir: "down", en: "Price to book", he: "מחיר להון עצמי", unit: "x" },
    { id: "implied_growth", dir: "down", en: "Growth the price needs (5 years, today's margins)", he: "הצמיחה שהמחיר דורש (5 שנים, במרווחים של היום)", unit: "pct" }] },
  { key: "momentum", kind: "momentum", en: "Price momentum", he: "מומנטום מחיר", qEn: "Which one is the market favouring now?", qHe: "את מי השוק מעדיף עכשיו?", rows: [
    { id: "rs_rating", dir: "up", en: "RS rating (1–99)", he: "דירוג RS ‏(1–99)", unit: "x" },
    { id: "return_3m", dir: "up", en: "Return, 3 months", he: "תשואה, 3 חודשים", unit: "pct" },
    { id: "return_1m", dir: "up", en: "Return, 1 month", he: "תשואה, חודש", unit: "pct" },
    { id: "from_high", dir: "up", en: "Distance from 52-week high", he: "מרחק משיא 52 שבועות", unit: "pct" }] },
];

const metricOf = (p: LensPayload, id: string): Metric | null => p.cards.flatMap((c) => c.metrics).find((m) => m.id === id) ?? null;
const meaningful = (m: Metric | null) => !!m && isNumber(m.value) && !/^n\/[am]$/i.test(m.display);

export interface Cell { value: number | null; display: string }
/** One side's value for a row id (payload metrics, bank measures, valuation facts, momentum). */
export function cell(s: Side, id: string): Cell {
  const p = s.p;
  const fmtPct = (v: number | null) => ({ value: v, display: v == null ? "—" : `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%` });
  switch (id) {
    case "bank_efficiency": case "bank_provisions": {
      if (!p.financial) return { value: null, display: "—" };
      const b = bankMeasures(p.statements ?? []);
      return fmtPct(b ? (id === "bank_efficiency" ? b.latest.efficiency : b.latest.provisions) : null);
    }
    case "pb": { if (!p.financial) return { value: null, display: "—" }; const v = valuationFacts(p).pb; return { value: v, display: times(v, 2) }; }
    case "implied_growth": {
      if (p.financial) return { value: null, display: "—" };
      const im = valuationFacts(p).scenarios.find((x) => x.id === "cautious")?.implied;
      if (!im) return { value: null, display: "—" };
      if (im.kind === "ok") return { value: im.growth, display: pct(im.growth) };
      if (im.kind === "beyond") return { value: 99, display: `>${im.maxGrowth}%` };
      return { value: -20, display: im.kind === "shrink" ? "< 0%" : "n/m" };
    }
    case "rs_rating": { const v = s.m?.rs_rating ?? null; return { value: v, display: v == null ? "—" : String(v) }; }
    case "return_3m": return fmtPct(s.m?.return_3m ?? null);
    case "return_1m": return fmtPct(s.m?.return_1m ?? null);
    case "from_high": return fmtPct(s.m?.fromHigh ?? null);
  }
  const m = metricOf(p, id);
  return meaningful(m) ? { value: m!.value as number, display: m!.display } : { value: null, display: m?.display && m.display !== "n/m" ? m.display : "—" };
}

export type Winner = "a" | "b" | "tie" | null;
export interface Row { id: string; label: string; dir: Dir; unit: Metric["unit"]; a: Cell; b: Cell; winner: Winner; median: string | null; formula: string | null }
export interface Group { def: GroupDef; rows: Row[]; aWins: number; bWins: number }

function judge(a: number | null, b: number | null, dir: Dir, unit: Metric["unit"], id: string): Winner {
  if (a == null || b == null || dir === "none") return null;
  if (id === "interest_coverage" && a >= 20 && b >= 20) return "tie";        // both carry almost no interest burden
  if (id === "debt_to_capital" && a <= 5 && b <= 5) return "tie";
  if (id === "sales_to_capital" || id === "pe" || id === "ps" || id === "ev_ebit" || id === "pb") {
    if (a <= 0 || b <= 0) return null;                                        // negative multiples don't rank
    if (ratio(a, b) < 1.05) return "tie";
  } else if (unit === "pct" || unit === "pp") {
    if (Math.abs(a - b) < 0.5) return "tie";
  } else if (Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 0.03) return "tie";
  return (dir === "up" ? a > b : a < b) ? "a" : "b";
}

export function scorecard(A: Side, B: Side, he = false): Group[] {
  return GROUPS.map((def) => {
    const rows = def.rows.map((r) => {
      const a = cell(A, r.id), b = cell(B, r.id), mA = metricOf(A.p, r.id), mB = metricOf(B.p, r.id);
      const label = r.en ? (he ? r.he! : r.en) : (mA?.label ?? mB?.label ?? r.id);
      const unit = r.unit ?? mA?.unit ?? mB?.unit ?? "pct";
      const median = mA?.peer?.median ?? mA?.bench?.display ?? null;
      return { id: r.id, label, dir: r.dir, unit, a, b, winner: judge(a.value, b.value, r.dir, unit, r.id), median, formula: mA?.formula ?? null };
    }).filter((r) => r.a.value != null || r.b.value != null);
    return { def, rows, aWins: rows.filter((r) => r.winner === "a").length, bWins: rows.filter((r) => r.winner === "b").length };
  }).filter((g) => g.rows.length);
}

export interface Tally { aWins: number; bWins: number; ties: number; compared: number; bestA: string | null; bestB: string | null }
export function tally(groups: Group[], kind: GroupKind = "business", he = false): Tally {
  const gs = groups.filter((g) => g.def.kind === kind);
  const rows = gs.flatMap((g) => g.rows).filter((r) => r.winner);
  const edge = (g: Group) => g.aWins - g.bWins;
  const sorted = [...gs].filter((g) => g.aWins + g.bWins > 0).sort((x, y) => edge(y) - edge(x));
  const name = (g?: Group) => g ? (he ? g.def.he : g.def.en) : null;
  return {
    aWins: rows.filter((r) => r.winner === "a").length, bWins: rows.filter((r) => r.winner === "b").length, ties: rows.filter((r) => r.winner === "tie").length,
    compared: rows.length, bestA: sorted[0] && edge(sorted[0]) > 0 ? name(sorted[0]) : null, bestB: sorted.at(-1) && edge(sorted.at(-1)!) < 0 ? name(sorted.at(-1)) : null,
  };
}

// ── Size ──────────────────────────────────────────────────────────────────────

const ttm = (p: LensPayload) => (p.statements ?? []).find((s) => s.kind === "ttm") ?? null;
export interface Size { revA: number | null; revB: number | null; capA: number | null; capB: number | null; revX: number | null; capX: number | null; bigger: "a" | "b" | null }
export function size(A: Side, B: Side): Size {
  const revA = ttm(A.p)?.revenue ?? null, revB = ttm(B.p)?.revenue ?? null;
  const capA = A.p.market.marketCap ?? A.p.valuation?.marketCap ?? null, capB = B.p.market.marketCap ?? B.p.valuation?.marketCap ?? null;
  const revX = isNumber(revA) && isNumber(revB) && revA > 0 && revB > 0 ? revB / revA : null;
  const capX = isNumber(capA) && isNumber(capB) && capA > 0 && capB > 0 ? capB / capA : null;
  return { revA, revB, capA, capB, revX, capX, bigger: revX == null ? null : revX >= 1 ? "b" : "a" };
}

// ── Story ─────────────────────────────────────────────────────────────────────

export interface CompareStory { title: string; paras: string[] }
export function compareStory(A: Side, B: Side, groups: Group[], he = false): CompareStory {
  const t = tr(he), a = A.p.symbol, b = B.p.symbol;
  const v = (s: Side, id: string) => cell(s, id).value;
  const g = (s: Side) => v(s, "rev_growth_q") ?? v(s, "rev_growth_ttm");
  const bank = A.p.financial || B.p.financial;
  const mid = bank ? "net_margin" : "op_margin";
  const parts: string[] = [];
  const gA = g(A), gB = g(B);
  if (gA != null && gB != null) {
    const x = gA > 0 && gB > 0 ? gA / gB : null;
    parts.push(x != null && x >= 1.5 ? t(`grows ${x.toFixed(1)}× faster than ${b} (${pct(gA, 0)} vs ${pct(gB, 0)})`, `גדלה פי ${x.toFixed(1)} מהר יותר מ־${b} (${pct(gA, 0)} מול ${pct(gB, 0)})`)
      : x != null && x <= 1 / 1.5 ? t(`grows at about a ${x >= 0.45 ? "half" : x >= 0.3 ? "third" : "fraction"} of ${b}'s pace (${pct(gA, 0)} vs ${pct(gB, 0)})`, `גדלה בקצב של ${x >= 0.45 ? "כמחצית" : x >= 0.3 ? "כשליש" : "חלק קטן"} מזה של ${b} (${pct(gA, 0)} מול ${pct(gB, 0)})`)
      : gA >= gB ? t(`grows faster than ${b} (${pct(gA, 0)} vs ${pct(gB, 0)})`, `גדלה מהר יותר מ־${b} (${pct(gA, 0)} מול ${pct(gB, 0)})`)
      : t(`grows slower than ${b} (${pct(gA, 0)} vs ${pct(gB, 0)})`, `גדלה לאט יותר מ־${b} (${pct(gA, 0)} מול ${pct(gB, 0)})`));
  }
  const mA = v(A, mid), mB = v(B, mid);
  if (mA != null && mB != null && Math.abs(mA - mB) >= 1) parts.push(mA > mB
    ? t(`keeps more of each sales dollar (${pct(mA, 0)} vs ${pct(mB, 0)} ${bank ? "net" : "operating"} margin)`, `משאירה יותר מכל דולר מכירות (${pct(mA, 0)} מול ${pct(mB, 0)} מרווח ${bank ? "נקי" : "תפעולי"})`)
    : t(`keeps less of each sales dollar (${pct(mA, 0)} vs ${pct(mB, 0)} ${bank ? "net" : "operating"} margin)`, `משאירה פחות מכל דולר מכירות (${pct(mA, 0)} מול ${pct(mB, 0)} מרווח ${bank ? "נקי" : "תפעולי"})`));
  const pid = bank ? "pb" : v(A, "ps") != null && v(B, "ps") != null ? "ps" : "pe";
  const pA = v(A, pid), pB = v(B, pid);
  let tail = "";
  if (pA != null && pB != null && pA > 0 && pB > 0 && ratio(pA, pB) >= 1.1) {
    const what = pid === "ps" ? t("each dollar of its sales", "כל דולר מכירות שלה") : pid === "pb" ? t("each dollar of its book value", "כל דולר הון עצמי שלה") : t("each dollar of its profit", "כל דולר רווח שלה");
    tail = pA > pB ? t(`; the market pays more for ${what} (${times(pA)} vs ${times(pB)})`, `; השוק משלם יותר על ${what} (${times(pA)} מול ${times(pB)})`)
      : t(`; the market pays less for ${what} (${times(pA)} vs ${times(pB)})`, `; השוק משלם פחות על ${what} (${times(pA)} מול ${times(pB)})`);
  }
  const join = he ? " ו" : " and ";
  const title = parts.length ? `${a} ${parts.join(join)}${tail}` : t(`${a} next to ${b}, measured the same way`, `${a} לצד ${b}, נמדדות באותה דרך`);

  const paras: string[] = [];
  const tl = tally(groups, "business", he);
  if (tl.compared) paras.push(t(
    `On the business measures that can be compared, ${a} is ahead on ${tl.aWins} and ${b} on ${tl.bWins}${tl.ties ? ` (${tl.ties} about even)` : ""}.${tl.bestA ? ` ${a}'s clearest edge: ${tl.bestA.toLowerCase()}.` : ""}${tl.bestB ? ` ${b}'s: ${tl.bestB.toLowerCase()}.` : ""}`,
    `במדדי העסק שאפשר להשוות, ${a} מקדימה ב־${tl.aWins} ו־${b} ב־${tl.bWins}${tl.ties ? ` (${tl.ties} בערך שווים)` : ""}.${tl.bestA ? ` היתרון הבולט של ${a}: ${tl.bestA}.` : ""}${tl.bestB ? ` של ${b}: ${tl.bestB}.` : ""}`));
  const sz = size(A, B);
  if (sz.revX != null) {
    const big = sz.bigger === "b" ? b : a, small = sz.bigger === "b" ? a : b, rx = ratio(sz.revA!, sz.revB!);
    paras.push(rx < 1.15 ? t(`The two are about the same size by revenue (${money(sz.revA)} vs ${money(sz.revB)} over the last twelve months).`, `השתיים בערך באותו גודל לפי הכנסות (${money(sz.revA)} מול ${money(sz.revB)} ב־12 החודשים האחרונים).`)
      : t(`${big} is ${rx.toFixed(rx >= 10 ? 0 : 1)}× ${small}'s size by revenue (${money(Math.max(sz.revA!, sz.revB!))} vs ${money(Math.min(sz.revA!, sz.revB!))})${sz.capX != null ? ` and ${ratio(sz.capA!, sz.capB!).toFixed(1)}× by market value` : ""} — size alone isn't quality, but it changes how fast each can still grow.`,
        `${big} גדולה פי ${rx.toFixed(rx >= 10 ? 0 : 1)} מ־${small} לפי הכנסות (${money(Math.max(sz.revA!, sz.revB!))} מול ${money(Math.min(sz.revA!, sz.revB!))})${sz.capX != null ? ` ופי ${ratio(sz.capA!, sz.capB!).toFixed(1)} לפי שווי שוק` : ""} — גודל לבדו אינו איכות, אבל הוא משנה כמה מהר כל אחת עוד יכולה לגדול.`));
  }
  const r3A = A.m?.return_3m, r3B = B.m?.return_3m;
  if (isNumber(r3A) && isNumber(r3B)) paras.push(t(`Over three months the stocks returned ${pct(r3A, 0)} and ${pct(r3B, 0)}${A.m?.rs_rating != null && B.m?.rs_rating != null ? `; RS ratings ${A.m.rs_rating} and ${B.m.rs_rating}` : ""}.`,
    `בשלושה חודשים המניות הניבו ${pct(r3A, 0)} ו־${pct(r3B, 0)}${A.m?.rs_rating != null && B.m?.rs_rating != null ? `; דירוגי RS ‏${A.m.rs_rating} ו־${B.m.rs_rating}` : ""}.`));
  return { title, paras };
}

// ── What it would take ────────────────────────────────────────────────────────

export interface Take { title: string; text: string }
export function whatItTakes(A: Side, B: Side, he = false): Take[] {
  const t = tr(he), a = A.p.symbol, b = B.p.symbol, out: Take[] = [];
  const rA = ttm(A.p), revA = rA?.revenue ?? null, opA = rA?.operating ?? null;
  const mA = cell(A, "op_margin").value, mB = cell(B, "op_margin").value;
  if (!A.p.financial && isNumber(revA) && revA > 0 && mA != null && mB != null && mB - mA >= 2) {
    const extra = (revA * (mB - mA)) / 100;
    out.push({ title: t(`${b}'s margins on ${a}'s sales`, `המרווחים של ${b} על המכירות של ${a}`),
      text: t(`At ${b}'s ${pct(mB, 0)} operating margin, ${a}'s ${money(revA)} of sales would earn about ${money(extra)} more operating profit a year${isNumber(opA) && opA > 0 ? ` — ${((extra / opA) * 100).toFixed(0)}% more than today` : ""}. Whether ${a} can get there is the question: margins usually rise with scale, pricing power or a better mix.`,
        `במרווח התפעולי של ${b} ‏(${pct(mB, 0)}), המכירות של ${a} ‏(${money(revA)}) היו מרוויחות כ־${money(extra)} יותר רווח תפעולי בשנה${isNumber(opA) && opA > 0 ? ` — ${((extra / opA) * 100).toFixed(0)}% יותר מהיום` : ""}. השאלה היא אם ${a} יכולה להגיע לשם: מרווחים עולים בדרך כלל עם גודל, כוח תמחור או תמהיל טוב יותר.`) });
  }
  const gA = cell(A, "rev_growth_ttm").value, gB = cell(B, "rev_growth_ttm").value;
  if (gA != null && gB != null && gB - gA >= 3) out.push({ title: t(`Matching ${b}'s growth`, `להשתוות לצמיחה של ${b}`),
    text: t(`${a} would need about ${(gB - gA).toFixed(0)} more points of revenue growth a year (${pct(gA, 0)} → ${pct(gB, 0)}). Faster growth only adds value when the return on the new capital beats its cost.`,
      `‏${a} הייתה צריכה עוד כ־${(gB - gA).toFixed(0)} נקודות צמיחה בהכנסות בשנה (${pct(gA, 0)} ← ${pct(gB, 0)}). צמיחה מהירה יותר מוסיפה ערך רק כשהתשואה על ההון החדש עולה על עלותו.`) });
  const iA = cell(A, "implied_growth").value, iB = cell(B, "implied_growth").value;
  if (iA != null && iB != null) out.push({ title: t("What each price is betting on", "על מה כל מחיר מהמר"),
    text: t(`At today's margins, ${a}'s price needs about ${pct(iA, 0)} sales growth a year for five years; ${b}'s needs about ${pct(iB, 0)}. The better business is not automatically the better investment — it depends on how much of that edge the price already assumes.`,
      `במרווחים של היום, המחיר של ${a} דורש כ־${pct(iA, 0)} צמיחה במכירות בשנה לחמש שנים; של ${b} כ־${pct(iB, 0)}. העסק הטוב יותר אינו בהכרח ההשקעה הטובה יותר — זה תלוי בכמה מהיתרון המחיר כבר מניח.`) });
  else out.push({ title: t("Good company, good investment?", "חברה טובה, השקעה טובה?"),
    text: t(`Damodaran's point: a great business can be a poor investment if the price already assumes everything goes right. Compare the scorecard above with the "What the market pays" rows before deciding which edge matters.`,
      `הנקודה של דמודרן: עסק מצוין יכול להיות השקעה חלשה אם המחיר כבר מניח שהכול ילך טוב. כדאי להשוות את הטבלה למעלה לשורות "כמה השוק משלם" לפני שמחליטים איזה יתרון חשוב.`) });
  return out;
}

// ── Quarterly trends ──────────────────────────────────────────────────────────

export interface QPoint { end: string; growth: number | null; margin: number | null; fcf: number | null }
/** Last 8 quarters: revenue growth vs the same quarter a year earlier, operating (or net, for banks) margin, FCF margin. */
export function quarterSeries(p: LensPayload, n = 8): QPoint[] {
  const q = (p.statements ?? []).filter((s) => s.kind === "quarter" && isNumber(s.revenue)).sort((x, y) => x.end.localeCompare(y.end));
  const yearBefore = (i: number): StatementPeriod | null => {
    const target = Date.parse(q[i].end) - 365 * 86400_000;
    let best: StatementPeriod | null = null, gap = Infinity;
    for (let j = 0; j < i; j++) { const d = Math.abs(Date.parse(q[j].end) - target); if (d < gap) { gap = d; best = q[j]; } }
    return gap <= 25 * 86400_000 ? best : null;
  };
  const useNet = p.financial;
  return q.map((s, i) => {
    const prior = yearBefore(i), rev = s.revenue as number;
    const prof = useNet ? s.net : s.operating;
    const fcf = isNumber(s.ocf) && isNumber(s.capex) && rev > 0 ? ((s.ocf - Math.abs(s.capex)) / rev) * 100 : null;
    return { end: s.end, growth: prior && isNumber(prior.revenue) && prior.revenue > 0 ? (rev / prior.revenue - 1) * 100 : null, margin: isNumber(prof) && rev > 0 ? (prof / rev) * 100 : null, fcf };
  }).slice(-n);
}

// ── Leader candidates ─────────────────────────────────────────────────────────

export interface PeerRow { symbol: string; company: string | null; rank: number | null; ranked: number; score: number | null; rsRating: number | null; marketCap: number | null }
export type Role = "fundamental" | "largest" | "rs" | "runner_up";
export interface Candidate extends PeerRow { roles: Role[] }

/** The industry's fundamental #1 (or #2 when the stock is #1), its largest company, its strongest RS, then the next ranked names. */
export function candidates(symbol: string, peers: PeerRow[], extra = 4): Candidate[] {
  const me = symbol.toUpperCase();
  const others = peers.filter((p) => p.symbol !== me);
  const ranked = others.filter((p) => p.rank != null).sort((a, b) => (a.rank as number) - (b.rank as number));
  const meRow = peers.find((p) => p.symbol === me);
  const out = new Map<string, Candidate>();
  const add = (p: PeerRow | undefined, role: Role) => { if (!p) return; const c = out.get(p.symbol) ?? { ...p, roles: [] }; if (!c.roles.includes(role)) c.roles.push(role); out.set(p.symbol, c); };
  add(ranked[0], meRow?.rank === 1 ? "runner_up" : "fundamental");
  add([...others].filter((p) => isNumber(p.marketCap)).sort((a, b) => (b.marketCap as number) - (a.marketCap as number))[0], "largest");
  add([...others].filter((p) => isNumber(p.rsRating)).sort((a, b) => (b.rsRating as number) - (a.rsRating as number))[0], "rs");
  for (const p of ranked.slice(1, 1 + extra)) if (!out.has(p.symbol)) out.set(p.symbol, { ...p, roles: [] });
  return [...out.values()];
}
