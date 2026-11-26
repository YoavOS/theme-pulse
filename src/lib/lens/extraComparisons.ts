import type { LensPayload } from "@/lib/lens/types";
import { comparablePeriods, isNumber, latestQuarterSummary, percentageChange } from "@/lib/lens/quarterly";

export type ExtraPair = "investment" | "perShare" | "debt" | "netProfit";
type Translate = (english: string, hebrew: string) => string;

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });
const count = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const cash = (n: number | null | undefined) => isNumber(n) ? usd.format(n) : "—";
const pct = (n: number | null) => n === null ? "—" : (n > 0 ? "+" : "") + n.toFixed(1) + "%";
const perShare = (n: number | null | undefined) => isNumber(n) ? (n < 0 ? "−" : "") + "$" + Math.abs(n).toFixed(2) : "—";
const diff = (a: number | null | undefined, b: number | null | undefined) => isNumber(a) && isNumber(b) ? a - b : null;

export function extraComparison(pair: ExtraPair, p: LensPayload, t: Translate) {
  const facts = p.connection;
  const { rows, latest: q } = latestQuarterSummary(p.statements ?? []);
  const yearAgo = q && rows.find(row => comparablePeriods(q.end, row.end, 4));
  const f = facts?.end === q?.end ? facts : null;
  const end = q?.end ?? facts?.end ?? null;
  if (pair === "investment") {
    const capex = q?.capex ?? f?.capex ?? null;
    const opCash = q?.ocf ?? f?.operatingCash ?? null;
    const remaining = diff(opCash, capex);
    const priorRemaining = diff(f?.priorOperatingCash, f?.priorCapex);
    const capexChange = diff(capex, f?.priorCapex);
    const operatingChange = diff(opCash, f?.priorOperatingCash);
    const delta = diff(remaining, priorRemaining);
    let summary = t("Operating cash and reported equipment or property spending are both needed to calculate cash left after investment.", "לחישוב מזומן שנשאר אחרי השקעה דרושים גם תזרים מפעילות וגם הוצאות על ציוד ונכסים.");
    if (remaining !== null) {
      summary = remaining < 0
        ? t("Operations did not cover equipment and property spending this quarter. Cash reserves or financing can bridge the gap.", "התזרים מפעילות לא כיסה את ההשקעה בציוד ובנכסים ברבעון. יתרות מזומן או מימון יכולים לכסות את הפער.")
        : t("Operating cash covered reported equipment and property spending this quarter. The remainder is a basic measure of free cash flow.", "התזרים מפעילות כיסה את ההשקעה המדווחת בציוד ובנכסים. היתרה היא מדד בסיסי לתזרים חופשי.");
      if (delta !== null && operatingChange !== null && capexChange !== null && delta < 0 && operatingChange >= 0 && capexChange > 0) {
        summary += " " + t("Operating cash held up, but spending rose by more, leaving less free cash than last quarter.", "התזרים מפעילות נשמר, אבל ההשקעה גדלה יותר ולכן נותר פחות מזומן חופשי מאשר ברבעון הקודם.");
      }
    }
    return { end, summary, rows: [
      [t("Operating cash flow", "תזרים מפעילות"), cash(opCash)],
      [t("Equipment and property spending", "השקעה בציוד ובנכסים"), cash(capex)],
      [t("Cash left after that spending", "מזומן שנשאר אחרי ההשקעה"), cash(remaining)],
      [t("Change in cash left vs previous quarter", "שינוי במזומן שנותר מול הרבעון הקודם"), cash(delta)],
      [t("Cash spent on acquisitions, separate", "מזומן ששימש לרכישות, בנפרד"), cash(f?.acquisitions)],
    ], check: t("A factory build can pull cash forward before it generates sales. These totals cannot distinguish expansion from maintenance. Acquisitions and financing sit outside this free-cash calculation.", "הקמת מפעל יכולה לצרוך מזומן לפני תחילת המכירות. הנתונים אינם מפרידים בין הרחבה לתחזוקה. רכישות ומימון אינם כלולים בחישוב הזה.") };
  }
  if (pair === "perShare") {
    const earningsGrowth = percentageChange(q?.net ?? null, yearAgo?.net ?? null);
    const epsGrowth = percentageChange(q?.dilutedEPS ?? null, yearAgo?.dilutedEPS ?? null);
    const shareGrowth = percentageChange(f?.dilutedShares ?? null, f?.yearAgoDilutedShares ?? null);
    const effect = earningsGrowth !== null && epsGrowth !== null ? epsGrowth - earningsGrowth : null;
    const summary = effect === null
      ? t("Profit belongs to the whole company. Diluted EPS measures earnings per share, allowing for potentially dilutive securities. Comparable positive starting figures are needed to compare growth rates.", "הרווח שייך לכל החברה. רווח מדולל למניה מביא בחשבון גם ניירות ערך שעשויים לדלל. להשוואת שיעורי צמיחה דרושים נתוני בסיס חיוביים ובני השוואה.")
      : effect < -0.5 && shareGrowth !== null && shareGrowth > 0
        ? t("EPS lagged company profit while the diluted share count rose. A larger share count can spread the profit over more shares.", "הרווח למניה פיגר אחרי הרווח הכולל ומספר המניות המדולל עלה. יותר מניות יכולות לחלק את הרווח על פני יותר מניות.")
        : effect > 0.5 && shareGrowth !== null && shareGrowth < 0
          ? t("EPS outpaced company profit while the diluted share count fell. Fewer shares can lift earnings per share.", "הרווח למניה צמח מהר מהרווח הכולל ומספר המניות המדולל ירד. פחות מניות יכולות להעלות את הרווח למניה.")
          : Math.abs(effect) <= 0.5
            ? t("Profit and EPS grew at roughly the same rate. Check the share count and the reported buybacks to see what changed beneath that result.", "הרווח והרווח למניה השתנו בקצב דומה. בדקו את מספר המניות ואת הרכישות העצמיות כדי לראות מה השתנה.")
            : t("Profit and EPS moved at different rates. Share count, preferred dividends and the profit attributable to common shareholders can affect that gap.", "הרווח והרווח למניה השתנו בקצבים שונים. מספר המניות, דיבידנד בכורה והרווח המיוחס לבעלי מניות רגילות עשויים להשפיע.");
    return { end, summary, rows: [
      [t("Net profit · YoY", "רווח נקי · שינוי שנתי"), cash(q?.net) + " · " + pct(earningsGrowth)],
      [t("Reported diluted EPS · YoY", "רווח מדולל למניה · שינוי שנתי"), perShare(q?.dilutedEPS) + " · " + pct(epsGrowth)],
      [t("Average diluted shares · YoY", "ממוצע מניות מדולל · שינוי שנתי"), (isNumber(f?.dilutedShares) ? count.format(f.dilutedShares) : "—") + " · " + pct(shareGrowth)],
      [t("Cash spent on buybacks", "מזומן ששימש לרכישה עצמית"), cash(f?.buybacks)],
      [t("Stock compensation expense", "הוצאה על תגמול במניות"), cash(f?.stockCompensation)],
      [t("Cash from common stock issuance", "תקבולים מהנפקת מניות רגילות"), cash(f?.stockIssued)],
    ], check: t("Buybacks can coexist with rising share count. Employee equity, new shares, acquisitions and the timing of repurchases can affect the weighted average. Stock compensation expense measures a cost in dollars and cannot tell us how many shares were issued.", "רכישות עצמיות יכולות לקרות לצד עלייה במספר המניות. תגמול לעובדים, הנפקות, רכישות ועיתוי משפיעים על הממוצע. הוצאת תגמול במניות היא עלות כספית ואינה אומרת כמה מניות הונפקו.") };
  }
  if (pair === "debt") {
    const interest = f?.interest ?? null;
    const operating = q?.operating ?? null;
    const coverage = isNumber(operating) && isNumber(interest) && interest > 0 ? operating / interest : null;
    const summary = coverage === null ? t("A same-quarter operating profit and positive reported interest expense are needed for this test.", "לבדיקה נדרשים רווח תפעולי והוצאת ריבית חיובית מאותו רבעון.")
      : coverage < 1 ? t("Operating profit fell short of reported interest expense this quarter. That can happen even with stable debt if profits weaken or borrowing costs rise.", "הרווח התפעולי היה נמוך מהוצאת הריבית המדווחת. זה יכול לקרות גם כשהחוב יציב, אם הרווח נחלש או עלות ההלוואות עלתה.")
      : t("Operating profit covered reported interest expense this quarter. This compares accounting figures. Debt repayment also depends on cash and repayment dates.", "הרווח התפעולי כיסה את הוצאות הריבית המדווחות ברבעון. זו השוואה חשבונאית. פירעון החוב תלוי גם במזומן ובמועדי הפירעון.");
    return { end, summary, rows: [
      [t("Reported non-current long-term debt", "חוב מדווח לטווח ארוך, לא שוטף"), cash(f?.longTermDebt)],
      [t("Reported current debt", "חוב שוטף מדווח"), cash(f?.shortTermDebt)],
      [t("Operating profit", "רווח תפעולי"), cash(operating)],
      [t("Reported interest expense", "הוצאת ריבית מדווחת"), cash(interest)],
      [t("Operating profit per $1 of interest", "רווח תפעולי לכל דולר ריבית"), coverage === null ? "—" : coverage.toFixed(1) + "×"],
      [t("Interest expense change vs previous quarter", "שינוי בהוצאת הריבית מול הרבעון הקודם"), cash(diff(interest, f?.priorInterest))],
    ], check: t("New debt can take time to affect interest. Fixed-rate debt, refinancing, interest capitalized into an asset and the timing of a loan can all weaken the link between the debt balance and quarterly interest.", "ההשפעה של חוב חדש על הריבית יכולה להתעכב. ריבית קבועה, מימון מחדש, היוון ריבית ועיתוי ההלוואה עשויים לשנות את הקשר בין יתרת החוב לריבית הרבעונית.") };
  }
  const opToNet = diff(q?.net, q?.operating);
  const tax = q?.tax ?? f?.tax ?? null;
  const nonOperatingBeforeTax = diff(f?.pretax, q?.operating);
  const summary = opToNet === null ? t("Both operating and net profit are needed to see what happened after the core business result.", "דרושים רווח תפעולי ורווח נקי כדי להבין מה קרה אחרי תוצאת הפעילות.")
    : opToNet > 0 ? t("Net profit exceeded operating profit this quarter. Look for a tax benefit or gains and income outside operations before interpreting this as better performance in the core business.", "הרווח הנקי עלה על הרווח התפעולי. בדקו הטבת מס או הכנסה ורווחים מחוץ לפעילות לפני שמסיקים שהפעילות עצמה השתפרה.")
    : t("Net profit reflects items beyond operating profit. The reported tax line and pre-tax gap show how much of the difference can be separated here.", "הרווח הנקי כולל סעיפים שמעבר לרווח התפעולי. שורת המס והפער לפני מס מראים כמה מההפרש ניתן לפרק כאן.");
  return { end, summary, rows: [
    [t("Operating profit", "רווח תפעולי"), cash(q?.operating)],
    [t("Reported profit before tax", "רווח מדווח לפני מס"), cash(f?.pretax)],
    [t("Pre-tax profit less operating profit", "רווח לפני מס פחות רווח תפעולי"), cash(nonOperatingBeforeTax)],
    [t("Reported tax expense (negative = benefit)", "הוצאת מס מדווחת (שלילי = הטבה)"), cash(tax)],
    [t("Net profit", "רווח נקי"), cash(q?.net)],
    [t("Net profit less operating profit", "רווח נקי פחות רווח תפעולי"), cash(opToNet)],
  ], check: tax !== null && tax < 0
    ? t("The filing reports a tax benefit. This can lift net income even without a change in sales. Use the filing notes to see whether it arose from a one-time event.", "הדוח מציג הטבת מס. היא יכולה להעלות את הרווח הנקי גם בלי שינוי במכירות. ביאורי הדוח מסבירים אם מדובר באירוע חד־פעמי.")
    : t("Interest, investment gains, asset sales, taxes and other items can move net profit. These totals show the size and direction of the gap. The filing notes identify individual one-off items.", "ריבית, רווחי השקעה, מכירת נכסים, מסים וסעיפים אחרים יכולים להזיז את הרווח הנקי. הסכומים מראים את הפער, והביאורים מפרטים אירועים חד־פעמיים.") };
}

