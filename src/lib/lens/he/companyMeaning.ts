// Hebrew "For SYMBOL" lines — the same readings as ../companyMeaning.ts, written for Hebrew.
import type { Metric } from "../types";
import { ltr } from "../i18n";

const r0 = (v: number) => Math.round(Math.abs(v));
const r1 = (v: number) => Math.abs(v).toFixed(1);
const L = ltr;

/** The company's number in plain Hebrew (null when there's nothing useful to say). */
export function hePlainReading(sym: string, m: Metric): string | null {
  const S = L(sym), D = L(m.display);
  const v = m.value;
  if (v === null || !Number.isFinite(v)) return m.display && m.display !== "n/a" && m.display !== "אין נתון" ? `${S}: ${D}.` : null;
  switch (m.id) {
    case "rev_growth_ttm": case "rev_growth_q": case "rev_cagr_3y": {
      const when = m.id === "rev_cagr_3y" ? " בשנה, בממוצע על פני שלוש השנים האחרונות" : m.id === "rev_growth_q" ? " ברבעון האחרון לעומת אותו רבעון אשתקד" : " ב-12 החודשים האחרונים לעומת 12 החודשים שלפניהם";
      return v >= 0 ? `ההכנסות של ${S} צמחו ב-${L(r1(v) + "%")}${when}.` : `ההכנסות של ${S} התכווצו ב-${L(r1(v) + "%")}${m.id === "rev_cagr_3y" ? " בשנה, על פני שלוש שנים" : " לעומת שנה קודם"}.`;
    }
    case "opinc_growth_ttm": case "ni_growth_ttm":
      return `${m.id === "ni_growth_ttm" ? "הרווח הנקי" : "הרווח התפעולי"} של ${S} ${v >= 0 ? "עלה" : "ירד"} ב-${L(r1(v) + "%")} לעומת 12 החודשים הקודמים${Math.abs(v) > 200 ? " — קפיצה גדולה כל כך אומרת בדרך כלל שהרווח היה קרוב לאפס באחת משתי השנים, כך שהאחוז אומר מעט" : ""}.`;
    case "gross_margin":
      return `שיעור הרווח הגולמי של ${S} הוא ${D}: בערך ${L(r0(v))} סנט מכל דולר הכנסות נשארים אחרי העלות הישירה של מה שהיא מוכרת.`;
    case "op_margin":
      return v >= 0 ? `שיעור הרווח התפעולי של ${S} הוא ${D}: היא שומרת בערך ${L(r0(v))} סנט של רווח תפעולי מכל דולר הכנסות, לפני ריבית ומסים.`
        : `שיעור הרווח התפעולי של ${S} הוא ${D}: היא מפסידה בערך ${L(r0(v))} סנט על כל דולר הכנסות מניהול העסק, לפני ריבית ומסים.`;
    case "net_margin":
      return v >= 0 ? `שיעור הרווח הנקי של ${S} הוא ${D}: בערך ${L(r0(v))} סנט מכל דולר הכנסות הופכים לרווח לבעלי המניות.`
        : `שיעור הרווח הנקי של ${S} הוא ${D}: אחרי כל העלויות היא מפסידה בערך ${L(r0(v))} סנט על כל דולר הכנסות.`;
    case "rnd_intensity":
      return `${S} מוציאה בערך ${L(r0(v))} סנט מכל דולר הכנסות על מחקר ופיתוח.`;
    case "sbc_intensity":
      return `${S} משלמת לעובדים שלה במניות בשווי ${D} מההכנסות — עלות אמיתית לבעלים, גם אם לא יוצא מזומן.`;
    case "roic":
      return v >= 0 ? `${S} מרוויחה בערך ${L(r1(v))} סנט בשנה על כל דולר שקשור בעסק (תשואה על ההון המושקע ${D}).`
        : `${S} מפסידה בערך ${L(r1(v))} סנט בשנה על כל דולר שקשור בעסק (תשואה על ההון המושקע ${D}).`;
    case "roe":
      return v >= 0 ? `${S} מרוויחה ${D} בשנה על הכסף של בעלי המניות שלה.` : `${S} הפסידה ${D} על הכסף של בעלי המניות שלה בשנה האחרונה.`;
    case "excess_return": case "equity_spread":
      return v >= 0 ? `${S} מרוויחה ${L(r1(v))} נקודות אחוז יותר ממה שעולה לה ההון — היא יוצרת ערך ככל שהיא צומחת.`
        : `${S} מרוויחה ${L(r1(v))} נקודות אחוז פחות ממה שעולה לה ההון — בינתיים, הצמיחה הורסת ערך.`;
    case "fcf_margin":
      return v >= 0 ? `${S} הופכת בערך ${L(r0(v))} סנט מכל דולר הכנסות למזומנים פנויים, אחרי שהשקיעה בעצמה.`
        : `${S} שורפת בערך ${L(r0(v))} סנט של מזומנים על כל דולר הכנסות, אחרי שהשקיעה בעצמה.`;
    case "capex_intensity":
      return `${S} מוציאה בערך ${L(r0(v))} סנט מכל דולר הכנסות על נכסים ארוכי טווח (השקעות הוניות).`;
    case "reinvestment_rate":
      return `${S} מחזירה ${D} מהרווח התפעולי שלה אחרי מס לתוך העסק כדי לצמוח.`;
    case "sales_to_capital":
      return `כל דולר של הון ב-${S} מייצר בערך ${L("$" + v.toFixed(2))} של הכנסות בשנה${v >= 2 ? " — הצמיחה זולה" : v < 0.8 ? " — הצמיחה דורשת הרבה הון" : ""}.`;
    case "interest_coverage":
      return v >= 0 ? `הרווח התפעולי של ${S} מכסה את חשבון הריבית שלה בערך ${L(v.toFixed(1))} פעמים.` : `הרווח התפעולי של ${S} לא מכסה את חשבון הריבית שלה (הוא שלילי).`;
    case "debt_to_capital":
      return `${D} מהמימון של ${S} מגיע ממלווים${v < 5 ? " — כמעט בלי חוב" : ""}.`;
    case "debt_to_ebitda":
      return `החוב של ${S} שווה בערך ${L(v.toFixed(1))} שנים של הרווח שלה במזומן (EBITDA).`;
    case "current_ratio":
      return `ל-${S} יש בערך ${L("$" + v.toFixed(2))} של נכסים לטווח קצר על כל דולר שצריך לשלם בתוך שנה.`;
    case "share_change":
      return v > 0 ? `מספר המניות של ${S} עלה ב-${L(r1(v) + "%")} בשנה — כל מניה קיימת מחזיקה עכשיו חלק קטן יותר מהחברה, בשיעור הזה.`
        : v < 0 ? `מספר המניות של ${S} ירד ב-${L(r1(v) + "%")} בשנה (רכישות עצמיות) — כל מניה מחזיקה חלק קצת גדול יותר מהחברה.` : `מספר המניות של ${S} לא השתנה במהלך השנה.`;
    case "cash_return_vs_fcf":
      return `${S} החזירה לבעלי המניות ${D} מתזרים המזומנים החופשי שלה (רכישות עצמיות + דיבידנדים).`;
    case "pe":
      return v > 0 ? `משקיעים משלמים בערך ${L("$" + v.toFixed(0))} על כל דולר של רווח שנתי של ${S}.` : `ל-${S} אין רווח, כך שאי אפשר לקרוא מכפיל רווח.`;
    case "ps":
      return `משקיעים משלמים בערך ${L("$" + v.toFixed(1))} על כל דולר של הכנסות שנתיות של ${S}.`;
    case "ev_ebit":
      return v > 0 ? `לקנות את כל ${S} (כולל החוב) עולה בערך ${L(v.toFixed(0))} שנים של הרווח התפעולי שלה.` : `הרווח התפעולי של ${S} שלילי, כך שאי אפשר לקרוא את היחס הזה.`;
    default:
      return `${S}: ${D}.`;
  }
}

/** Industry and peer comparison in Hebrew, with a plain verdict when "better" has a direction. */
export function heComparison(sym: string, m: Metric, higherIsBetter: boolean | null): string[] {
  const S = L(sym);
  const out: string[] = [];
  const b = m.bench, p = m.peer;
  let tilt: "better" | "worse" | "even" | null = null;
  if (b) {
    out.push(b.position === "in line"
      ? `זה בקו אחד עם הממוצע בענף ${b.industry} (${L(b.display)}).`
      : `זה ${b.position === "above" ? "מעל " : "מתחת ל"}ממוצע הענף ${b.industry}, שעומד על ${L(b.display)}${b.market ? ` (השוק כולו: ${L(b.market)})` : ""}.`);
    if (b.position === "in line") tilt = "even";
    else if (higherIsBetter !== null) tilt = (b.position === "above") === higherIsBetter ? "better" : "worse";
  }
  if (p) {
    const words = { top: "בחמישון העליון", upper: "מעל החציון", middle: "סביב החציון", lower: "מתחת לחציון", bottom: "בחמישון התחתון" }[p.position];
    out.push(`מתוך ${L(p.n)} חברות ${p.group} באפליקציה, היא מדורגת ${words} (החציון ${L(p.median)}).`);
    if (tilt === null && higherIsBetter !== null && p.position !== "middle") tilt = (p.position === "top" || p.position === "upper") === higherIsBetter ? "better" : "worse";
    if (tilt === null && p.position === "middle") tilt = "even";
  }
  if (tilt === "better") out.push(`עבור ${S} זו נקודת חוזק בהשוואה לעסקים דומים.`);
  else if (tilt === "worse") out.push(`עבור ${S} זו נקודת חולשה בהשוואה לעסקים דומים.`);
  else if (tilt === "even") out.push(`כך שבמדד הזה ${S} נראית כמו עסק טיפוסי מהסוג שלה.`);
  else if (b || p) out.push("כאן גבוה יותר לא בהכרח טוב יותר — כדאי לקרוא את זה יחד עם השלב והסיפור של החברה.");
  if (b?.smallSample) out.push(`(רק ${L(b.n)} חברות בענף הזה, כך שהממוצע שלו רועש.)`);
  return out;
}
