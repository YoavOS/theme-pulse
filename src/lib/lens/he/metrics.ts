// Hebrew for the Lens metrics and the server's templated sentences (mirror of lensMetrics.ts,
// lensPayload.ts, damodaran.ts and fundamentals-lens/index.ts). Exact strings first, then patterns;
// anything not matched stays in English rather than being guessed.
import { ltr } from "../i18n";
import { HE_STAGE } from "./curriculum";
import type { Stage } from "../types";

export const HE_METRIC: Record<string, { label: string; formula: string; short?: string }> = {
  rev_growth_ttm: { label: "צמיחה בהכנסות (12 חודשים אחרונים מול השנה שלפניהם)", formula: "(הכנסות ב-12 החודשים האחרונים − הכנסות ב-12 החודשים שלפניהם) ÷ הכנסות ב-12 החודשים שלפניהם", short: "צמיחה בהכנסות, שנה" },
  rev_growth_q: { label: "צמיחה בהכנסות ברבעון האחרון (מול אותו רבעון אשתקד)", formula: "(הכנסות הרבעון − אותו רבעון אשתקד) ÷ אותו רבעון אשתקד", short: "צמיחה בהכנסות, רבעון אחרון" },
  rev_cagr_3y: { label: "צמיחה שנתית בהכנסות, 3 שנות הכספים האחרונות", formula: "(הכנסות שנת הכספים האחרונה ÷ ההכנסות 3 שנים קודם)^(1/3) − 1", short: "צמיחה בהכנסות, ממוצע 3 שנים" },
  opinc_growth_ttm: { label: "צמיחה ברווח התפעולי (12 חודשים אחרונים)", formula: "(רווח תפעולי ב-12 החודשים האחרונים − 12 החודשים שלפניהם) ÷ 12 החודשים שלפניהם" },
  ni_growth_ttm: { label: "צמיחה ברווח הנקי (12 חודשים אחרונים)", formula: "(רווח נקי ב-12 החודשים האחרונים − 12 החודשים שלפניהם) ÷ 12 החודשים שלפניהם" },
  gross_margin: { label: "שיעור רווח גולמי", formula: "רווח גולמי ÷ הכנסות", short: "שיעור רווח גולמי" },
  op_margin: { label: "שיעור רווח תפעולי", formula: "רווח תפעולי ÷ הכנסות", short: "שיעור רווח תפעולי" },
  op_margin_change: { label: "שינוי בשיעור הרווח התפעולי מול שנה קודם", formula: "שיעור הרווח התפעולי ב-12 החודשים האחרונים − השיעור ב-12 החודשים שלפניהם", short: "שינוי ברווחיות התפעולית, שנה" },
  gross_margin_change: { label: "שינוי בשיעור הרווח הגולמי מול שנה קודם", formula: "שיעור הרווח הגולמי ב-12 החודשים האחרונים − השיעור ב-12 החודשים שלפניהם" },
  net_margin: { label: "שיעור רווח נקי", formula: "רווח נקי ÷ הכנסות", short: "שיעור רווח נקי" },
  rnd_intensity: { label: "מחקר ופיתוח כאחוז מההכנסות", formula: "הוצאות מחקר ופיתוח ÷ הכנסות" },
  roe: { label: "תשואה על ההון העצמי (ROE)", formula: "רווח נקי ב-12 החודשים האחרונים ÷ ההון העצמי של בעלי המניות שנה קודם", short: "תשואה על ההון העצמי" },
  roic: { label: "תשואה על ההון המושקע (ROIC)", formula: "רווח תפעולי × (1 − שיעור המס) ÷ (חוב + הון עצמי − מזומנים) שנה קודם", short: "תשואה על ההון" },
  excess_return: { label: "תשואה על ההון פחות עלות ההון", formula: "ROIC − עלות ההון בענף", short: "תשואה − עלות ההון" },
  equity_spread: { label: "תשואה על ההון העצמי פחות עלות ההון העצמי", formula: "ROE − עלות ההון העצמי בענף", short: "ROE − עלות ההון העצמי" },
  fcf: { label: "תזרים מזומנים חופשי (12 חודשים אחרונים)", formula: "תזרים מזומנים מפעילות שוטפת − השקעות הוניות" },
  fcf_margin: { label: "שיעור תזרים המזומנים החופשי", formula: "תזרים מזומנים חופשי ÷ הכנסות", short: "שיעור תזרים חופשי" },
  capex_intensity: { label: "השקעות הוניות כאחוז מההכנסות", formula: "השקעות הוניות ÷ הכנסות" },
  reinvestment: { label: "השקעה מחדש (12 חודשים אחרונים)", formula: "(השקעות הוניות − פחת) + שינוי בהון החוזר שאינו מזומן + רכישות של חברות" },
  reinvestment_rate: { label: "שיעור ההשקעה מחדש", formula: "השקעה מחדש ÷ רווח תפעולי אחרי מס", short: "שיעור השקעה מחדש" },
  sales_to_capital: { label: "מכירות להון המושקע", formula: "הכנסות ב-12 החודשים האחרונים ÷ ההון המושקע שנה קודם (הקריאה של האפליקציה ליחס של דמודרן)", short: "מכירות להון" },
  fcff: { label: "תזרים מזומנים חופשי לפירמה (FCFF של דמודרן)", formula: "רווח תפעולי אחרי מס − השקעה מחדש" },
  sbc_intensity: { label: "תגמול מבוסס מניות כאחוז מההכנסות", formula: "תגמול מבוסס מניות ÷ הכנסות", short: "תגמול במניות % מההכנסות" },
  fcf_after_sbc: { label: "תזרים מזומנים חופשי אחרי תגמול במניות", formula: "תזרים מזומנים חופשי − תגמול מבוסס מניות (תגמול במניות הוא עלות אמיתית שמשולמת במניות)" },
  cash_runway: { label: "מסלול המזומנים בקצב השריפה הנוכחי", formula: "מזומנים והשקעות לטווח קצר ÷ שריפת המזומנים השנתית (תזרים חופשי שלילי)", short: "מסלול מזומנים" },
  interest_coverage: { label: "כיסוי ריבית", formula: "רווח תפעולי ÷ הוצאות ריבית", short: "כיסוי ריבית" },
  synthetic_rating: { label: "דירוג אשראי משתמע (מתוך הכיסוי)", formula: "טבלת כיסוי → דירוג של דמודרן (ינואר 2026, חברות גדולות לא פיננסיות)" },
  debt_to_capital: { label: "חוב להון (בשווי שוק)", formula: "חוב ÷ (חוב + שווי השוק של ההון העצמי)" },
  debt_to_ebitda: { label: "חוב ל-EBITDA", formula: "חוב ÷ (רווח תפעולי + פחת והפחתות)" },
  net_debt: { label: "חוב נטו (חוב − מזומנים)", formula: "חוב − מזומנים והשקעות לטווח קצר" },
  current_ratio: { label: "יחס שוטף", formula: "נכסים שוטפים ÷ התחייבויות שוטפות" },
  lease_debt: { label: "התחייבויות בגין חכירות תפעוליות", formula: "התחייבויות החכירה במאזן (דמודרן מתייחס אליהן כחוב)" },
  share_change: { label: "שינוי במספר המניות המדולל (שנה)", formula: "מספר המניות המדולל היום ÷ מספר המניות המדולל לפני שנה − 1", short: "מספר מניות, שנה" },
  cash_return: { label: "מזומנים שהוחזרו (רכישות עצמיות + דיבידנדים, 12 חודשים)", formula: "רכישות עצמיות + דיבידנדים ששולמו", short: "מזומנים שהוחזרו, שנה" },
  cash_return_vs_fcf: { label: "מזומנים שהוחזרו כאחוז מתזרים המזומנים החופשי", formula: "(רכישות עצמיות + דיבידנדים) ÷ תזרים מזומנים חופשי", short: "מזומנים שהוחזרו / תזרים חופשי" },
  ps: { label: "מכפיל מכירות", formula: "שווי שוק ÷ הכנסות ב-12 החודשים האחרונים" },
  pe: { label: "מכפיל רווח", formula: "שווי שוק ÷ רווח נקי ב-12 החודשים האחרונים" },
  ev_ebit: { label: "שווי פעילות לרווח תפעולי", formula: "(שווי שוק + חוב − מזומנים) ÷ רווח תפעולי ב-12 החודשים האחרונים" },
};

/** Exact English → Hebrew for short server strings: input labels, notes, signal labels, displays, statuses. */
export const HE_EXACT: Record<string, string> = {
  // input labels
  "Revenue TTM": "הכנסות, 12 חודשים אחרונים", "Prior 12 months": "12 החודשים שלפני כן", "This quarter": "הרבעון הזה", "Year ago": "לפני שנה",
  "Operating income TTM": "רווח תפעולי, 12 חודשים אחרונים", "Net income TTM": "רווח נקי, 12 חודשים אחרונים", "Gross profit TTM": "רווח גולמי, 12 חודשים אחרונים",
  "Now": "עכשיו", "A year ago": "לפני שנה", "R&D TTM": "מו\"פ, 12 חודשים אחרונים", "Equity a year earlier": "הון עצמי שנה קודם",
  "Tax": "מס", "After-tax operating income": "רווח תפעולי אחרי מס", "Invested capital a year earlier": "הון מושקע שנה קודם", "ROIC": "ROIC", "ROE": "ROE",
  "Operating cash flow": "תזרים מזומנים מפעילות שוטפת", "Capex": "השקעות הוניות", "Capex TTM": "השקעות הוניות, 12 חודשים אחרונים",
  "Depreciation & amortization": "פחת והפחתות", "Net capex": "השקעות הוניות נטו", "Change in non-cash working capital": "שינוי בהון החוזר שאינו מזומן", "Acquisitions": "רכישות של חברות",
  "Reinvestment": "השקעה מחדש", "Free cash flow": "תזרים מזומנים חופשי", "Free cash flow TTM": "תזרים מזומנים חופשי, 12 חודשים אחרונים", "SBC TTM": "תגמול במניות, 12 חודשים אחרונים", "SBC": "תגמול במניות",
  "Cash + short-term investments": "מזומנים + השקעות לטווח קצר", "Interest expense TTM": "הוצאות ריבית, 12 חודשים אחרונים", "Coverage": "כיסוי", "Rating": "דירוג",
  "Default spread over risk-free": "פער האשראי מעל הריבית חסרת הסיכון", "Debt": "חוב", "Market cap": "שווי שוק", "EBITDA TTM": "EBITDA, 12 חודשים אחרונים",
  "Current assets": "נכסים שוטפים", "Current liabilities": "התחייבויות שוטפות", "Lease liabilities": "התחייבויות חכירה", "Reported debt": "חוב מדווח",
  "Diluted shares now": "מניות מדוללות היום", "Buybacks": "רכישות עצמיות", "Dividends": "דיבידנדים", "Stock issued for cash": "מניות שהונפקו תמורת מזומן",
  "Cash returned": "מזומנים שהוחזרו", "Enterprise value": "שווי פעילות",
  // notes
  "Needs four fiscal years of 10-K revenue.": "נדרשות ארבע שנות כספים של הכנסות מדוחות 10-K.",
  "Not meaningful: the prior year's operating income was zero or negative.": "חסר משמעות: הרווח התפעולי בשנה הקודמת היה אפס או שלילי.",
  "Small base: last year's operating income was tiny, so the % change exaggerates.": "בסיס קטן: הרווח התפעולי אשתקד היה זעיר, ולכן השינוי באחוזים מוגזם.",
  "Not meaningful: last year was a loss.": "חסר משמעות: בשנה שעברה היה הפסד.",
  "This company doesn't report a gross profit line (common for banks, insurers and some service firms).": "החברה לא מדווחת על שורת רווח גולמי (נפוץ בבנקים, בחברות ביטוח ובחלק מחברות השירותים).",
  "No R&D line reported.": "לא דווחה שורת מחקר ופיתוח.",
  "Not meaningful: book equity is negative (often from large buybacks or accumulated losses).": "חסר משמעות: ההון העצמי בספרים שלילי (לעיתים קרובות בגלל רכישות עצמיות גדולות או הפסדים מצטברים).",
  "Not used for banks, insurers and brokers: debt is their raw material, not financing, so ROE replaces ROIC.": "לא בשימוש בבנקים, בחברות ביטוח ובברוקרים: החוב הוא חומר הגלם שלהם ולא מימון, ולכן ROE מחליף את ROIC.",
  "Not meaningful: invested capital is zero or negative (cash exceeds debt + equity, or equity is negative).": "חסר משמעות: ההון המושקע אפס או שלילי (המזומנים גדולים מהחוב + ההון העצמי, או שההון העצמי שלילי).",
  "Depreciation isn't reported separately, so net capex can't be computed.": "הפחת לא מדווח בנפרד, ולכן אי אפשר לחשב השקעות הוניות נטו.",
  "Working-capital change unavailable — counted as zero.": "השינוי בהון החוזר לא זמין — נספר כאפס.",
  "Not meaningful while operating income is negative — the company is reinvesting money it doesn't earn yet.": "חסר משמעות כל עוד הרווח התפעולי שלילי — החברה משקיעה מחדש כסף שהיא עוד לא מרוויחה.",
  "No stock-based compensation line found.": "לא נמצאה שורת תגמול מבוסס מניות.",
  "Interest expense is zero or negligible — little or no debt to service.": "הוצאות הריבית אפס או זניחות — מעט חוב לשרת, או בכלל לא.",
  "For banks and insurers, debt is part of the business itself, so this ratio reads differently.": "בבנקים ובחברות ביטוח החוב הוא חלק מהעסק עצמו, ולכן היחס הזה נקרא אחרת.",
  "Not meaningful: EBITDA is negative.": "חסר משמעות: ה-EBITDA שלילי.",
  "No operating lease liability reported.": "לא דווחה התחייבות בגין חכירה תפעולית.",
  "Not meaningful: free cash flow is negative.": "חסר משמעות: תזרים המזומנים החופשי שלילי.",
  "Not meaningful: no profits.": "חסר משמעות: אין רווחים.",
  "Not meaningful: operating income is negative.": "חסר משמעות: הרווח התפעולי שלילי.",
  "Uses the industry's average cost of capital as the hurdle; a riskier or more indebted company has a different one.": "משתמש בעלות ההון הממוצעת בענף כרף; לחברה מסוכנת יותר או ממונפת יותר יש רף אחר.",
  "Uses the industry's average cost of equity as the hurdle.": "משתמש בעלות ההון העצמי הממוצעת בענף כרף.",
  "His industry figure counts net capital spending (incl. acquisitions and R&D) but not working capital, so it's a close, not exact, match.": "הנתון הענפי שלו סופר השקעות הוניות נטו (כולל רכישות של חברות ומו\"פ) אבל לא הון חוזר, כך שההתאמה קרובה ולא מדויקת.",
  "The industry figure is the 5-year growth rate; the company's is 3 years.": "הנתון הענפי הוא קצב הצמיחה ל-5 שנים; הנתון של החברה הוא ל-3 שנים.",
  "Industry figure: total market cap ÷ total net income of the profitable firms.": "הנתון הענפי: סך שווי השוק ÷ סך הרווח הנקי של החברות הרווחיות.",
  // stage signals
  "Revenue growth (avg of TTM and 3-year)": "צמיחה בהכנסות (ממוצע של 12 החודשים האחרונים ו-3 שנים)", "Operating margin": "שיעור רווח תפעולי",
  "Operating margin trend (1 year)": "מגמת הרווחיות התפעולית (שנה)", "Free cash flow margin": "שיעור תזרים המזומנים החופשי",
  "Cash returned to shareholders": "מזומנים שהוחזרו לבעלי המניות", "Filing financials since": "מגישה דוחות כספיים מאז",
  // displays
  "n/a": "אין נתון", "n/m": "חסר משמעות", "none": "אין", "none reported": "לא דווח", "self-funding": "מממנת את עצמה", "no real interest": "אין ריבית ממשית",
  "AAA-like (no debt burden)": "כמו AAA (אין נטל חוב)", "25% assumed tax rate (no meaningful pre-tax income)": "הונח שיעור מס של 25% (אין רווח משמעותי לפני מס)",
  // sec status
  "Not an SEC filer (foreign listing, ETF or unknown ticker) — no company filings to read.": "לא מגישה דוחות ל-SEC (רישום זר, תעודת סל או סימול לא מוכר) — אין דוחות חברה לקרוא.",
  "Files under international (IFRS) accounting, usually annual only — quarterly metrics aren't available.": "מדווחת לפי התקינה הבינלאומית (IFRS), בדרך כלל רק שנתית — מדדים רבעוניים אינם זמינים.",
  "No quarterly filings found (20-F/40-F filer?).": "לא נמצאו דוחות רבעוניים (מגישה 20-F/40-F?).",
  "pre-tax cost of debt, app assumption": "עלות החוב לפני מס, הנחה של האפליקציה",
};

const stageHe = (enLabel: string) => {
  const k = (Object.keys(HE_STAGE) as Stage[]).find((s) => STAGE_EN[s] === enLabel);
  return k ? HE_STAGE[k].label : enLabel;
};
export const STAGE_EN: Record<Stage, string> = {
  startup: "Start-up", young_growth: "Young Growth", high_growth: "High Growth", mature_growth: "Mature Growth", mature_stable: "Mature Stable", decline: "Decline",
};
/** "+7.1 pp" / "−73.0 pp" → "7.1" / "73.0" (the sentence carries the direction). */
const pts = (v: string) => v.replace(/\s*pp$/, "").replace(/^[+−-]/, "");
const CONF: Record<string, string> = { high: "ביטחון גבוה", medium: "ביטחון בינוני", low: "ביטחון נמוך" };
const MONTH: Record<string, string> = { January: "ינואר", February: "פברואר", March: "מרץ", April: "אפריל", May: "מאי", June: "יוני", July: "יולי", August: "אוגוסט", September: "ספטמבר", October: "אוקטובר", November: "נובמבר", December: "דצמבר" };
/** "January 2026" → "ינואר 2026" */
export const heMonthYear = (s: string) => s.replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/g, (m) => MONTH[m]);

/** Templated server sentences → Hebrew. Each returns null when it doesn't apply. */
const PATTERNS: [RegExp, (...m: string[]) => string][] = [
  // periods
  [/^TTM to (\d{4}-\d{2}-\d{2})$/, (_, d) => `12 החודשים שעד ${ltr(d)}`],
  [/^quarter ending (\S+)$/, (_, d) => `הרבעון שהסתיים ב-${ltr(d)}`],
  [/^FY (\d{4}) → FY (\d{4})$/, (_, a, b) => `שנת כספים ${ltr(a)} ← שנת כספים ${ltr(b)}`],
  [/^FY (\d{4})$/, (_, a) => `שנת כספים ${ltr(a)}`],
  [/^cash at (\S+)$/, (_, d) => `מזומנים ליום ${ltr(d)}`],
  [/^debt at (\S+), market cap now$/, (_, d) => `חוב ליום ${ltr(d)}, שווי שוק נוכחי`],
  [/^at (\d{4}-\d{2}-\d{2})$/, (_, d) => `ליום ${ltr(d)}`],
  [/^(\d{4}-\d{2}-\d{2}) → (\d{4}-\d{2}-\d{2})$/, (_, a, b) => `${ltr(a)} ← ${ltr(b)}`],
  // inputs and displays with numbers
  [/^Cost of capital \(Damodaran, (.+), ([A-Z][a-z]+ \d{4})\)$/, (_, ind, d) => `עלות ההון (דמודרן, ${ind}, ${heMonthYear(d)})`],
  [/^Cost of equity \(Damodaran, (.+), ([A-Z][a-z]+ \d{4})\)$/, (_, ind, d) => `עלות ההון העצמי (דמודרן, ${ind}, ${heMonthYear(d)})`],
  [/^effective tax rate (.+)$/, (_, r) => `שיעור מס אפקטיבי ${ltr(r)}`],
  [/^([\d.]+) yrs$/, (_, n) => `${ltr(n)} שנים`],
  [/^(\d{4}) \(XBRL era start — likely older\)$/, (_, y) => `${ltr(y)} (תחילת עידן ה-XBRL — כנראה ותיקה יותר)`],
  [/^Damodaran cost of capital, (.+) \(([A-Z][a-z]+ \d{4})\)$/, (_, ind, d) => `עלות ההון של דמודרן, ${ind} (${heMonthYear(d)})`],
  [/^app assumption \(8%\) — industry data not loaded$/, () => `הנחה של האפליקציה (${ltr("8%")}) — נתוני הענף לא נטענו`],
  [/^pre-tax cost of debt, Damodaran ([A-Z][a-z]+ \d{4})$/, (_, d) => `עלות החוב לפני מס, דמודרן ${heMonthYear(d)}`],
  // sec status
  [/^SEC data unavailable \(HTTP (\d+)\)\.$/, (_, c) => `נתוני ה-SEC לא זמינים (HTTP ${ltr(c)}).`],
  [/^Only (\d+) quarters of filings — some year-over-year numbers are missing\.$/, (_, n) => `יש רק ${ltr(n)} רבעונים של דוחות — חלק מההשוואות לשנה קודמת חסרות.`],
  // story lines
  [/^(\S+) looks like a (.+?) company(?:, leaning toward (.+?))? \(the app's rule of thumb, (high|medium|low) confidence\)\.$/,
    (_, s, st, lean, c) => `${ltr(s)} נראית כמו חברה בשלב ${stageHe(st)}${lean ? `, עם נטייה לעבר ${stageHe(lean)}` : ""} (כלל האצבע של האפליקציה, ${CONF[c] ?? c}).`],
  [/^Revenue grew (\S+) over the last twelve months(?: at an operating margin of (\S+))?(?: \((up|down) (.+?) from a year earlier\))?\.$/,
    (_, g, om, dir, d) => `ההכנסות ${g.startsWith("−") || g.startsWith("-") ? `ירדו ב-${ltr(g.replace(/^[−-]/, ""))}` : `צמחו ב-${ltr(g.replace(/^\+/, ""))}`} ב-12 החודשים האחרונים${om ? `, בשיעור רווח תפעולי של ${ltr(om)}` : ""}${dir ? ` (${dir === "up" ? "עלייה" : "ירידה"} של ${ltr(pts(d))} נקודות אחוז לעומת שנה קודם)` : ""}.`],
  [/^It turns (\S+) of revenue into free cash flow\.$/, (_, v) => `היא הופכת ${ltr(v)} מההכנסות לתזרים מזומנים חופשי.`],
  [/^It is burning cash: free cash flow is (\S+) of revenue\.$/, (_, v) => `היא שורפת מזומנים: תזרים המזומנים החופשי הוא ${ltr(v)} מההכנסות.`],
  [/^Each dollar invested in the business earned (\S+) after tax last year \(ROIC\)\.$/, (_, v) => `כל דולר שהושקע בעסק הרוויח ${ltr(v)} אחרי מס בשנה האחרונה (ROIC).`],
  [/^That is (.+?) above what capital costs in its industry, so growth at these returns adds value\.$/, (_, v) => `זה ${ltr(pts(v))} נקודות אחוז מעל מה שעולה ההון בענף שלה, ולכן צמיחה בתשואות כאלה מוסיפה ערך.`],
  [/^That is (.+?) versus what capital costs in its industry, so growth at these returns doesn't add value yet\.$/, (_, v) => `זה ${ltr(pts(v))} נקודות אחוז מתחת למה שעולה ההון בענף שלה, ולכן צמיחה בתשואות כאלה עדיין לא מוסיפה ערך.`],
];

/** One server string → Hebrew (unchanged when it isn't known). */
export function heServer(s: string | null | undefined): string {
  if (!s) return s ?? "";
  const hit = HE_EXACT[s];
  if (hit !== undefined) return hit;
  for (const [re, f] of PATTERNS) { const m = s.match(re); if (m) return f(...m); }
  return s;
}
