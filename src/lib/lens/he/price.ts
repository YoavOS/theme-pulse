// Hebrew for the price card's scenarios and the R&D / lease adjustment notes.
import { ltr } from "../i18n";
import type { Scenario, StoryInputs } from "../valuation";

export const HE_SCENARIO_NAME: Record<Scenario["id"], string> = { cautious: "זהיר", typical: "טיפוסי", optimistic: "אופטימי" };

/** The scenario in one Hebrew clause (finishes "אם SYMBOL …"). */
export function heScenarioPlain(id: Scenario["id"], v: Pick<StoryInputs, "opMargin" | "industryOpMargin">): string {
  const ind = v.industryOpMargin;
  const typicalMargin = ind !== null ? Math.max(ind, v.opMargin) : Math.max(v.opMargin, 10);
  if (id === "cautious") return `נשארת רווחית כמו היום (שיעור רווח תפעולי של ${ltr(v.opMargin.toFixed(0) + "%")}) וצריכה הון לצמיחה באותה מידה כמו עכשיו`;
  if (id === "typical") return ind !== null && typicalMargin > v.opMargin + 0.5
    ? `הופכת לרווחית כמו החברה הממוצעת בענף שלה (שיעור רווח תפעולי של ${ltr(ind.toFixed(0) + "%")})`
    : `שומרת על שיעור רווח תפעולי של ${ltr(typicalMargin.toFixed(0) + "%")}${ind !== null ? ` (הממוצע בענף שלה הוא ${ltr(ind.toFixed(0) + "%")})` : ""}`;
  return "מסיימת טובה בבירור מהענף שלה: רווחית בערך ברבע יותר, וצריכה בערך רבע פחות הון";
}

const NOTE: Record<string, string> = {
  "R&D is under 1% of revenue, so capitalising it changes little.": `המו"פ הוא פחות מ-${ltr("1%")} מההכנסות, כך שהיוון שלו משנה מעט.`,
  "Only one year of R&D in the filings — not enough to capitalise.": "יש בדוחות רק שנה אחת של מו\"פ — לא מספיק כדי להוון.",
  "No R&D reported — nothing to capitalise.": "לא דווח מו\"פ — אין מה להוון.",
  "No operating lease liability reported — nothing to add.": "לא דווחה התחייבות בגין חכירה תפעולית — אין מה להוסיף.",
  "The adjustments barely move the return on capital — the reported numbers tell the story fairly.": "ההתאמות כמעט לא מזיזות את התשואה על ההון — המספרים המדווחים מספרים את הסיפור בהגינות.",
  "Return on capital falls once R&D and leases are counted as capital: some of the reported return came from investment that accounting kept off the balance sheet.": "התשואה על ההון יורדת ברגע שהמו\"פ והחכירות נספרים כהון: חלק מהתשואה המדווחת הגיע מהשקעה שהחשבונאות השאירה מחוץ למאזן.",
  "Return on capital rises once R&D is treated as investment: expensing it had been understating what the business earns on the capital it really uses.": "התשואה על ההון עולה ברגע שהמו\"פ נחשב כהשקעה: רישומו כהוצאה המעיט במה שהעסק מרוויח על ההון שהוא באמת משתמש בו.",
};
export function heAdjustText(s: string): string {
  if (NOTE[s]) return NOTE[s];
  const m = s.match(/^Only (\d+) years of R&D are in the filings; the (\d+) older years? repeats? the oldest known figure\.$/)
    ?? s.match(/^Only (\d+) years of R&D are in the filings; the (\d+) older years? repeat the oldest known figure\.$/);
  if (m) return `בדוחות יש רק ${ltr(m[1])} שנים של מו"פ; ${m[2] === "1" ? "בשנה הישנה יותר חוזר" : `ב-${ltr(m[2])} השנים הישנות יותר חוזר`} הנתון הישן ביותר הידוע.`;
  return s;
}
