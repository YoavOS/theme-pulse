// Hebrew for the Proven-Strong track record (mirror of provenEngine.ts and lib/proven/types.ts).
import { ltr } from "../i18n";
import type { ProvenCheck, ProvenLabel, ProvenRow, ProvenTrack } from "@/lib/proven/types";
import { heMonthYear } from "./metrics";

export const HE_LABEL_TEXT: Record<ProvenLabel, string> = {
  elite: "מוכחת · עילית", proven: "מוכחת", proven_caveat: "מוכחת, עם הסתייגות", fading: "מוכחת אך דועכת",
  provisional: "ראשונית", emerging: "מתהווה", emerging_early: "מוקדם", was_strong: "הייתה חזקה", not_proven: "לא מוכחת", insufficient: "מידע חסר",
};
export const HE_LABEL_SHORT: Record<ProvenLabel, string> = {
  elite: "עילית", proven: "מוכחת", proven_caveat: "מוכחת*", fading: "דועכת", provisional: "ראשונית",
  emerging: "מתהווה", emerging_early: "מוקדם", was_strong: "הייתה חזקה", not_proven: "לא מוכחת", insufficient: "מידע חסר",
};
export const HE_TRACK_TEXT: Record<ProvenTrack, string> = {
  standard: "תשואה על ההון מול עלות ההון", cyclical: "לאורך המחזור", financial: "תשואה על ההון העצמי מול עלות ההון העצמי",
  capital_light: "דלת הון (רווחים ומזומנים)", young: "חברה צעירה — נשפטת לפי הכיוון",
};
export const HE_ARCHETYPE: Record<string, string> = {
  capital_light_compounder: "צומחת בהון מועט", high_margin: "מסלול הרווחיות הגבוהה", high_turnover: "מסלול המחזור הגבוה",
  asset_heavy: "עתירת נכסים", rd_innovator: "מונעת מחקר ופיתוח", reinvesting_compounder: "משקיעה מחדש בתשואה גבוהה",
  cyclical: "מחזורית", capital_negative: "רצה על הכסף של אחרים", serial_acquirer: "צומחת ברכישות",
};
export const HE_FLAG: Record<string, string> = {
  rd_adjusted: "המו\"פ נחשב כהשקעה (ההתאמה של דמודרן) — התשואה המוצגת היא הכלכלית.",
  still_compounding: "עדיין צוברת ערך: הון חדש מרוויח הרבה מעל עלותו, והיא ממשיכה להשקיע מחדש.",
  ex_goodwill_better: "העסק עצמו מרוויח הרבה יותר מהתשואה הכוללת — על הרכישות שילמו ביוקר.",
  cyclical_by_volatility: "התשואות קופצות הרבה משנה לשנה, ולכן היא נשפטת לאורך המחזור.",
  stale_filings: "אין דוח שנתי כבר כשנתיים — הרקורד עשוי להיות לא מעודכן.",
  not_acting_age: "לא מתנהגת בהתאם לגילה — מה שהיא עושה עם ההון שלה לא מתאים לשלב החיים שלה (בבדיקת השלב למעלה).",
};
const WHY: Record<string, string> = {
  "Judged on Damodaran's test of a good business: return on capital above what that capital costs, year after year.":
    "נשפטת לפי המבחן של דמודרן לעסק טוב: תשואה על ההון שגבוהה ממה שההון הזה עולה, שנה אחרי שנה.",
  "A cyclical business: judged on returns across the whole cycle, not on any single year.":
    "עסק מחזורי: נשפט לפי התשואות לאורך המחזור כולו, לא לפי שנה בודדת.",
  "A bank or insurer: debt is its raw material, so the test is return on equity against the cost of equity.":
    "בנק או חברת ביטוח: החוב הוא חומר הגלם שלו, ולכן המבחן הוא התשואה על ההון העצמי מול עלות ההון העצמי.",
  "Runs on almost no invested capital (or negative), so return on capital isn't meaningful — judged on steady profits and how much of them turn into cash.":
    "פועלת כמעט בלי הון מושקע (או עם הון שלילי), ולכן התשואה על ההון חסרת משמעות — נשפטת לפי רווחים יציבים וכמה מהם הופכים למזומנים.",
  "A young or fast-changing business: too early to prove excess returns, so it's judged on direction — are the economics of the product good, are margins scaling, and does new capital earn more than it costs?":
    "עסק צעיר או משתנה במהירות: מוקדם מדי להוכיח תשואה עודפת, ולכן הוא נשפט לפי הכיוון — האם הכלכלה של המוצר טובה, האם הרווחיות עולה עם הגודל, והאם הון חדש מרוויח יותר ממה שהוא עולה?",
};
const CHECK_LABEL: Record<string, string> = {
  "ROE above the cost of equity in most years": "ROE מעל עלות ההון העצמי ברוב השנים",
  "By a real margin": "בפער של ממש",
  "Can carry its debt (interest covered ≥ 3×, or net cash)": "מסוגלת לשאת את החוב שלה (כיסוי ריבית ≥ 3×, או מזומן נטו)",
  "Net debt ≤ 3× EBITDA": "חוב נטו ≤ 3× EBITDA",
  "Profits turn into cash (free cash flow ≥ 60% of after-tax operating income)": "הרווחים הופכים למזומנים (תזרים חופשי ≥ 60% מהרווח התפעולי אחרי מס)",
  "Share count not inflating (≤ 3% a year)": "מספר המניות לא תופח (≤ 3% בשנה)",
  "Profitable in most years": "רווחית ברוב השנים",
  "Profits turn into cash (≥ 90%)": "הרווחים הופכים למזומנים (≥ 90%)",
  "Margins holding": "הרווחיות מחזיקה",
  "Earned more than its cost of capital in most years": "הרוויחה יותר מעלות ההון שלה ברוב השנים",
  "By a real margin (median ≥ 3 pp)": "בפער של ממש (חציון ≥ 3 נקודות אחוז)",
  "Across the whole cycle, returns beat the cost of capital": "לאורך המחזור כולו, התשואות עלו על עלות ההון",
  "Never three weak years in a row": "אף פעם לא שלוש שנים חלשות ברצף",
  "Created value in total over the period": "יצרה ערך בסך הכול לאורך התקופה",
  "Growing fast (revenue ≥ 15%/yr)": "צומחת מהר (הכנסות ≥ 15% בשנה)",
  "Operating margin rising as it grows": "הרווחיות התפעולית עולה ככל שהיא גדלה",
  "Capital-efficient growth (sales per $ of capital ≥ industry)": "צמיחה יעילה בהון (מכירות לכל דולר הון ≥ הענף)",
  "New capital earning more than it costs": "הון חדש מרוויח יותר ממה שהוא עולה",
  "Acting its age (young): funded by equity, not debt, and not paying dividends yet": "מתנהגת בהתאם לגילה (צעירה): ממומנת בהון עצמי ולא בחוב, ועוד לא משלמת דיבידנדים",
  "Acting its age (high growth): new capital earns more than it costs, so reinvesting adds value": "מתנהגת בהתאם לגילה (צמיחה מהירה): הון חדש מרוויח יותר ממה שהוא עולה, ולכן השקעה מחדש מוסיפה ערך",
  "Acting its age (mature growth): still reinvesting well, and not sitting on cash it can't use": "מתנהגת בהתאם לגילה (צמיחה בוגרת): עדיין משקיעה מחדש היטב, ולא יושבת על מזומנים שאין לה שימוש בהם",
  "Acting its age (mature): returns the cash it can't reinvest well, rather than buying growth with acquisitions": "מתנהגת בהתאם לגילה (בוגרת): מחזירה את המזומנים שאין לה איך להשקיע היטב, במקום לקנות צמיחה ברכישות",
  "Acting its age (decline): shrinking gracefully — not pouring capital into a comeback that earns less than it costs, and returning cash": "מתנהגת בהתאם לגילה (דעיכה): מתכווצת בחוכמה — לא שופכת הון על קאמבק שמרוויח פחות ממה שהוא עולה, ומחזירה מזומנים",
};
const MISS: Record<string, string> = {
  "thin interest coverage": "כיסוי ריבית דק", "heavy debt": "חוב כבד", "profits not turning into cash": "רווחים שלא הופכים למזומנים",
  "share count inflating": "מספר מניות תופח", "too few years above its cost of capital": "מעט מדי שנים מעל עלות ההון שלה", "spread too thin": "מרווח דק מדי",
  "below its cost of capital across the cycle": "מתחת לעלות ההון שלה לאורך המחזור", "a 3-year stretch below its cost of capital": "רצף של 3 שנים מתחת לעלות ההון",
  "destroyed value in total": "הרסה ערך בסך הכול", "paying dividends too early": "משלמת דיבידנדים מוקדם מדי", "borrowing heavily too young": "לווה בכבדות בגיל צעיר מדי",
  "reinvesting at returns below its cost": "משקיעה מחדש בתשואה שמתחת לעלות", "hoarding cash": "אוגרת מזומנים",
  "holding on to cash it can't reinvest well": "מחזיקה במזומנים שאין לה איך להשקיע היטב", "trying to buy growth through acquisitions": "מנסה לקנות צמיחה ברכישות",
  "investing to grow despite returns below its cost": "משקיעה כדי לצמוח למרות תשואות מתחת לעלות", "not returning cash": "לא מחזירה מזומנים",
  "fast growth": "צמיחה מהירה", "strong gross margins": "רווח גולמי חזק", "margins scaling up": "רווחיות שעולה עם הגודל",
  "capital-efficient growth": "צמיחה יעילה בהון", "high returns on new capital": "תשואה גבוהה על הון חדש",
};
const TREND: Record<string, string> = {
  "trend unclear": "המגמה לא ברורה", "returns falling": "התשואות יורדות", "returns easing": "התשואות נחלשות", "returns rising": "התשואות עולות", "trend flat": "המגמה יציבה",
};
const list = (s: string, sep = /; |, /) => s.split(sep).map((x) => MISS[x.trim()] ?? x.trim());

/** A check value ("10 of 10 years", "new capital earns 222% vs 10.6%"…) → Hebrew. */
function heValue(v: string): string {
  return v.split(" · ").map((part) => {
    const exact: Record<string, string> = {
      "n/a": "אין נתון", "net cash": "מזומן נטו", "not profitable yet": "עוד לא רווחית", "no dividends": "אין דיבידנדים", "debt n/a": "חוב: אין נתון",
      "returns on new capital n/a": "תשואה על הון חדש: אין נתון", "cash n/a": "מזומנים: אין נתון", "no free cash flow": "אין תזרים חופשי",
      "payout n/a": "חלוקה: אין נתון", "acquisitions n/a": "רכישות: אין נתון", "capital n/a": "הון: אין נתון",
    };
    if (exact[part]) return exact[part];
    let m: RegExpMatchArray | null;
    if ((m = part.match(/^(\d+) of (\d+) years$/))) return `${ltr(m[1])} מתוך ${ltr(m[2])} שנים`;
    if ((m = part.match(/^worst 3-yr (.+)$/))) return `3 השנים החלשות ביותר: ${ltr(m[1])}`;
    if ((m = part.match(/^(.+)× coverage$/))) return `כיסוי ${ltr(m[1] + "×")}`;
    if ((m = part.match(/^pays dividends \((.+) of revenue\)$/))) return `משלמת דיבידנדים (${ltr(m[1])} מההכנסות)`;
    if ((m = part.match(/^debt (\d+)% of capital$/))) return `חוב ${ltr(m[1] + "%")} מההון`;
    if ((m = part.match(/^new capital earns (\S+) vs (\S+)$/))) return `הון חדש מרוויח ${ltr(m[1])} מול ${ltr(m[2])}`;
    if ((m = part.match(/^cash (\d+)% of assets$/))) return `מזומנים ${ltr(m[1] + "%")} מהנכסים`;
    if ((m = part.match(/^(\d+)% of FCF returned$/))) return `${ltr(m[1] + "%")} מהתזרים החופשי הוחזרו`;
    if ((m = part.match(/^acquisitions (\d+)% of FCF$/))) return `רכישות ${ltr(m[1] + "%")} מהתזרים החופשי`;
    if ((m = part.match(/^capital (.+) in 3 yrs$/))) return `הון ${ltr(m[1])} ב-3 שנים`;
    if ((m = part.match(/^(.+) pp\/yr$/))) return `${ltr(m[1])} נקודות אחוז בשנה`;
    if ((m = part.match(/^(.+)\/yr$/))) return `${ltr(m[1])} בשנה`;
    return ltr(part);
  }).join(" · ");
}

const RECORD = /^Earned more than its cost of capital in (\d+) of the last (\d+) years; median spread (\S+ pp)(?:; (.+?))?\.(.*)$/;
function recordHe(m: RegExpMatchArray): string {
  const [, a, n, med, trend] = m;
  return `הרוויחה יותר מעלות ההון שלה ב-${ltr(a)} מתוך ${ltr(n)} השנים האחרונות; מרווח חציוני ${ltr(med.replace(" pp", ""))} נקודות אחוז${trend ? `; ${TREND[trend] ?? trend}` : ""}.`;
}

/** The record sentence → Hebrew. */
export function heSentence(s: string | null | undefined): string {
  if (!s) return s ?? "";
  const exact: Record<string, string> = {
    "No annual filings to judge yet.": "עוד אין דוחות שנתיים לשפוט לפיהם.",
    "Not enough years of equity returns to judge.": "אין מספיק שנים של תשואה על ההון העצמי כדי לשפוט.",
    "Insufficient comparable data — fewer than two annual reports.": "אין מספיק מידע להשוואה — פחות משני דוחות שנתיים.",
  };
  if (exact[s]) return exact[s];
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^Return on equity beat its cost of equity in (\d+) of the last (\d+) years; median gap (\S+) pp; (.+)\.$/)))
    return `התשואה על ההון העצמי עלתה על עלות ההון העצמי ב-${ltr(m[1])} מתוך ${ltr(m[2])} השנים האחרונות; פער חציוני ${ltr(m[3])} נקודות אחוז; ${TREND[m[4]] ?? m[4]}.`;
  if ((m = s.match(/^Earned more than its cost of capital in (\d+) of the last (\d+) years; median spread (\S+) pp; but the spread is shrinking\.$/)))
    return `הרוויחה יותר מעלות ההון שלה ב-${ltr(m[1])} מתוך ${ltr(m[2])} השנים האחרונות; מרווח חציוני ${ltr(m[3])} נקודות אחוז; אבל המרווח מצטמק.`;
  if ((m = s.match(/^(Earned more than .+?\.) Caveat: (.+)\.$/))) { const r = m[1].match(RECORD); return `${r ? recordHe(r) : m[1]} הסתייגות: ${list(m[2], /; /).join("; ")}.`; }
  if ((m = s.match(/^(Earned more than .+?\.) Misses: (.+)\.$/))) { const r = m[1].match(RECORD); return `${r ? recordHe(r) : m[1]} חסר: ${list(m[2], /; /).join("; ")}.`; }
  if ((m = s.match(RECORD)) && !m[5]) return recordHe(m);
  if ((m = s.match(/^Runs on little or negative invested capital; profitable in (\d+) of (\d+) years, turning (.+) of profit into cash\.$/)))
    return `פועלת עם מעט הון מושקע או עם הון שלילי; רווחית ב-${ltr(m[1])} מתוך ${ltr(m[2])} שנים, והופכת ${m[3] === "an unknown share" ? "חלק לא ידוע" : ltr(m[3])} מהרווח למזומנים.`;
  if ((m = s.match(/^Short record but a clean one: earned more than its cost of capital in (\d+) of (\d+) years \(median (\S+) pp\)\. Needs more years to count as proven\.$/)))
    return `רקורד קצר אבל נקי: הרוויחה יותר מעלות ההון שלה ב-${ltr(m[1])} מתוך ${ltr(m[2])} שנים (חציון ${ltr(m[3])} נקודות אחוז). צריך עוד שנים כדי שתיחשב מוכחת.`;
  if ((m = s.match(/^Only (\d+) years? of comparable annual reports — too short to judge\.$/)))
    return `יש רק ${ltr(m[1])} ${m[1] === "1" ? "שנה" : "שנים"} של דוחות שנתיים שניתן להשוות — קצר מדי לשיפוט.`;
  if ((m = s.match(/^Short record: (.+)$/))) { const r = (m[1].charAt(0).toUpperCase() + m[1].slice(1)).match(RECORD); return `רקורד קצר: ${r ? recordHe(r) : m[1]}`; }
  if ((m = s.match(/^Not proven yet, but showing the signature: (.+)\.$/))) return `עוד לא מוכחת, אבל מראה את החתימה: ${list(m[1], /, /).join(", ")}.`;
  if ((m = s.match(/^Too early to see the signature(?: — so far: (.+?))?; (.*) not there yet\.$/)))
    return `מוקדם מדי לראות את החתימה${m[1] ? ` — עד עכשיו: ${list(m[1], /, /).join(", ")}` : ""}${m[2].trim() ? `; ${list(m[2], /, /).join(", ")} — עוד לא שם` : ""}.`;
  if ((m = s.match(/^Was strong \(to (\d{4}): (\d+) of (\d+) years above its cost of capital\) but no longer passes: (.+)$/))) {
    const r = (m[4].charAt(0).toUpperCase() + m[4].slice(1)).match(RECORD);
    return `הייתה חזקה (עד ${ltr(m[1])}: ${ltr(m[2])} מתוך ${ltr(m[3])} שנים מעל עלות ההון) אבל כבר לא עוברת: ${r ? recordHe(r) : m[4]}`;
  }
  return s;
}

const heCheck = (c: ProvenCheck): ProvenCheck => {
  let label = CHECK_LABEL[c.label];
  if (!label) {
    const m = c.label.match(/^Good product economics \(gross margin ≥ (.+) average\)$/);
    label = m ? `כלכלת מוצר טובה (רווח גולמי ≥ הממוצע ב-${m[1] === "industry" ? "ענף" : m[1]})` : c.label;
  }
  return { ...c, label, value: heValue(c.value), miss: c.miss ? list(c.miss, /; /).join("; ") : c.miss };
};

export function heHurdleSource(s: string | null | undefined): string | null {
  if (!s) return s ?? null;
  const m = s.match(/^Damodaran cost of capital, (.+) \(([A-Z][a-z]+ \d{4})\)$/);
  if (m) return `עלות ההון של דמודרן, ${m[1]} (${heMonthYear(m[2])})`;
  if (s === "industry cost of capital") return "עלות ההון בענף";
  return s;
}

/** A whole track-record row in Hebrew (names of industries and companies stay as they are). */
export function heProvenRow<T extends Partial<ProvenRow>>(r: T): T {
  return {
    ...r,
    sentence: r.sentence ? heSentence(r.sentence) : r.sentence,
    why: r.why ? WHY[r.why] ?? r.why : r.why,
    checks: r.checks ? r.checks.map(heCheck) : r.checks,
    gates: r.gates ? r.gates.map(heCheck) : r.gates,
    hurdle_source: heHurdleSource(r.hurdle_source),
  };
}
