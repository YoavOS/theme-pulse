// Metrics that only make sense together. Each "read" combines a few of the Lens metrics the way
// Damodaran links them, and says in plain words what they mean as a set for this company.
//   1. The return engine:  after-tax margin × revenue to capital = return on capital, against what capital costs
//   2. The growth engine:  reinvestment × return on that reinvestment ≈ the growth the business can fund itself
//   3. Profit into cash:   net margin vs free-cash-flow margin, capital spending, stock-based pay
//   4. The owners' share:  cash returned vs free cash flow, and what happened to the share count
//   5. Safety:             debt against earnings and interest coverage, given how steady the business is
//   6. Price vs engine:    what the price pays for, against the engine above
import type { LensPayload, Metric } from "./types";
import { ltr } from "./i18n";

export type ReadTone = "good" | "mixed" | "weak" | "neutral";
export interface LinkedRead { id: string; title: string; tone: ReadTone; headline: string; body: string[]; uses: { label: string; display: string }[] }

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function metricMap(p: LensPayload): Map<string, Metric> {
  const m = new Map<string, Metric>();
  for (const c of [...p.foundations, ...p.cards]) for (const x of c.metrics) if (!m.has(x.id)) m.set(x.id, x);
  return m;
}

export function linkedReads(p: LensPayload, he: boolean): LinkedRead[] {
  const M = metricMap(p);
  const v = (id: string) => { const x = M.get(id)?.value; return fin(x) ? x : null; };
  const metricsOf = (...ids: string[]) => ids.map((id) => M.get(id)).filter((x): x is Metric => !!x && x.display !== "n/a").map((x) => ({ label: x.label, display: x.display }));
  const S = he ? ltr(p.symbol) : p.symbol;
  const P = (x: number, d = 0) => { const s = `${x < 0 ? "−" : ""}${Math.abs(x).toFixed(d)}%`; return he ? ltr(s) : s; };
  const X = (x: number, d = 1) => (he ? ltr(`${x.toFixed(d)}×`) : `${x.toFixed(d)}×`);
  const N = (x: number | string) => (he ? ltr(x) : String(x));
  const t = (en: string, h: string) => (he ? h : en);
  const out: LinkedRead[] = [];
  const val = p.valuation;
  const coc = val?.costOfCapital ?? null;
  const tax = val ? (val.taxRate > 1 ? val.taxRate / 100 : val.taxRate) : 0.21;

  // 1. the return engine
  const om = v("op_margin"), s2c = v("sales_to_capital") ?? val?.salesToCapital ?? null, roic = v("roic");
  if (!p.financial && fin(om) && fin(s2c) && fin(roic)) {
    const atm = om * (1 - tax);
    const indM = val?.industryOpMargin ?? null, indT = val?.industrySalesToCapital ?? null;
    const viaMargin = fin(indM) ? om / Math.max(1, indM) : null, viaTurn = fin(indT) && indT > 0 ? s2c / indT : null;
    const route = viaMargin && viaTurn ? (viaMargin >= 1.3 && viaTurn >= 1.3 ? "both" : viaMargin >= viaTurn ? "margin" : "turnover") : null;
    const spread = fin(coc) ? roic - coc : null;
    const tone: ReadTone = spread === null ? "neutral" : spread > 5 ? "good" : spread > 0 ? "mixed" : "weak";
    const body: string[] = [];
    body.push(t(
      `${p.symbol} keeps about ${P(atm)} of each revenue dollar after tax, and each dollar of capital brings in ${X(s2c)} in revenue. Multiply the two and you get its return on capital: about ${P(roic)}.`,
      `${S} שומרת כ-${P(atm)} מכל דולר הכנסות אחרי מס, וכל דולר הון מכניס ${X(s2c)} בהכנסות. מכפלה של השניים נותנת את התשואה שלה על ההון: כ-${P(roic)}.`));
    if (route) body.push(route === "both"
      ? t(`It wins on both routes: its margin and its use of capital are both well above its industry (${P(indM!)} and ${X(indT!)}).`, `היא מנצחת בשתי הדרכים: גם שיעור הרווח וגם השימוש בהון גבוהים בהרבה מהענף (${P(indM!)} ו-${X(indT!)}).`)
      : route === "margin"
      ? t(`Its edge comes mostly from margin — it keeps more of each dollar of revenue than its industry (${P(indM!)}) — so the question is what lets it charge more or spend less, and whether that lasts.`, `היתרון שלה בא בעיקר משיעור הרווח — היא שומרת יותר מכל דולר הכנסות מהענף (${P(indM!)}) — אז השאלה היא מה מאפשר לה לגבות יותר או להוציא פחות, והאם זה יחזיק.`)
      : t(`Its edge comes mostly from how hard it works its capital (${X(s2c)} vs ${X(indT!)} for its industry) rather than from margin — a capital-light model; the question is whether growth will need much more capital.`, `היתרון שלה בא בעיקר מכמה ביעילות היא מנצלת את ההון (${X(s2c)} לעומת ${X(indT!)} בענף), ולא משיעור הרווח — מודל דל הון; השאלה היא אם הצמיחה תדרוש הרבה יותר הון.`));
    if (spread !== null) body.push(spread > 0
      ? t(`Against a cost of capital of about ${P(coc!, 1)}, that's ${P(spread)} points of value created on every dollar invested${roic > 100 ? " — a return this high usually means the business needs very little capital, so growth is cheap for it" : ""}.`,
        `מול עלות הון של כ-${P(coc!, 1)}, זה ${P(spread)} נקודות של ערך שנוצר על כל דולר שהושקע${roic > 100 ? " — תשואה כזו גבוהה בדרך כלל אומרת שהעסק צריך מעט מאוד הון, ולכן צמיחה זולה לו" : ""}.`)
      : t(`That is below the ${P(coc!, 1)} its capital costs: today, each dollar invested earns less than investors could expect elsewhere, so growing makes things worse until returns improve.`,
        `זה פחות מ-${P(coc!, 1)} שההון שלה עולה: היום כל דולר שמושקע מרוויח פחות ממה שמשקיעים יכולים לצפות במקום אחר, ולכן צמיחה רק מחמירה את המצב עד שהתשואות ישתפרו.`));
    out.push({ id: "engine", title: t("The return engine: margin × capital use = return on capital", "מנוע התשואה: שיעור רווח × שימוש בהון = תשואה על ההון"), tone,
      headline: spread === null ? t("How it earns its return", "איך היא מרוויחה את התשואה שלה") : spread > 0 ? t(`Creates value: ${P(roic)} on capital that costs ${P(coc!, 1)}`, `יוצרת ערך: ${P(roic)} על הון שעולה ${P(coc!, 1)}`) : t(`Destroys value: ${P(roic)} on capital that costs ${P(coc!, 1)}`, `הורסת ערך: ${P(roic)} על הון שעולה ${P(coc!, 1)}`),
      body, uses: metricsOf("op_margin", "sales_to_capital", "roic", "excess_return") });
  }

  // 2. the growth engine
  const rr = v("reinvestment_rate"), g3 = v("rev_cagr_3y") ?? val?.pastGrowth3y ?? null;
  if (!p.financial && fin(rr) && fin(roic)) {
    const fundamental = (rr / 100) * roic;               // growth the business could fund itself (%)
    const body: string[] = [];
    let tone: ReadTone = "neutral";
    const huge = fundamental > 50;
    body.push(huge
      ? t(`It puts back about ${P(rr)} of its after-tax operating profit into the business, and earns ${P(roic)} on its capital — so even a small share of its profit could fund very fast growth. For a business like this the limit on growth is the size of its market, not money.`,
        `היא מחזירה לעסק כ-${P(rr)} מהרווח התפעולי שלה אחרי מס, ומרוויחה ${P(roic)} על ההון — כך שאפילו חלק קטן מהרווח יכול לממן צמיחה מהירה מאוד. לעסק כזה, מה שמגביל את הצמיחה הוא גודל השוק, לא כסף.`)
      : t(`It puts back about ${P(rr)} of its after-tax operating profit into the business. If new money earns what the business earns today (${P(roic)}), that supports growth in operating profit of roughly ${P(fundamental)} a year — Damodaran's "fundamental growth".`,
        `היא מחזירה לעסק כ-${P(rr)} מהרווח התפעולי שלה אחרי מס. אם הכסף החדש ירוויח כמו העסק היום (${P(roic)}), זה מאפשר צמיחה ברווח התפעולי של בערך ${P(fundamental)} בשנה — "הצמיחה הבסיסית" של דמודרן.`));
    if (fin(g3)) {
      if (rr <= 5 && g3 > 10) { tone = "mixed"; body.push(t(`Yet revenue grew ${P(g3)} a year with almost no reinvestment. Growth like that doesn't last without investment — it may come from acquisitions, price increases or a temporary boom.`, `ובכל זאת ההכנסות צמחו ב-${P(g3)} בשנה כמעט בלי השקעה. צמיחה כזו לא מחזיקה לאורך זמן בלי השקעה — היא יכולה לבוא מרכישות, מהעלאות מחירים או מגאות זמנית.`)); }
      else if (rr > 30 && g3 < 3) { tone = "weak"; body.push(t(`But revenue grew only ${P(g3)} a year: it is reinvesting without the growth to show for it. Either the investments haven't paid off yet, or they earn less than hoped.`, `אבל ההכנסות צמחו רק ב-${P(g3)} בשנה: היא משקיעה בלי שהצמיחה מגיעה. או שההשקעות עוד לא הניבו, או שהן מרוויחות פחות ממה שקיוו.`)); }
      else if (fin(coc) && roic > coc) { tone = "good"; body.push(t(`Revenue grew ${P(g3)} a year. Because its returns are above its cost of capital, this growth adds value — growth is good here.`, `ההכנסות צמחו ב-${P(g3)} בשנה. מכיוון שהתשואות שלה מעל עלות ההון, הצמיחה הזו מוסיפה ערך — כאן צמיחה היא דבר טוב.`)); }
      else if (fin(coc)) { tone = "weak"; body.push(t(`Revenue grew ${P(g3)} a year — but at returns below its cost of capital, faster growth would subtract value, not add it.`, `ההכנסות צמחו ב-${P(g3)} בשנה — אבל בתשואות שמתחת לעלות ההון, צמיחה מהירה יותר תוריד ערך, לא תוסיף.`)); }
    }
    const stage = p.lifeCycle?.stage;
    if (stage === "mature_stable" && rr > 50) body.push(t("For a mature company that's a lot of reinvestment — Damodaran's \"act your age\" question: are these investments earning their keep, or would owners be better off with the cash?", "לחברה בוגרת זו השקעה מחדש גדולה — שאלת \"להתנהג בהתאם לגיל\" של דמודרן: האם ההשקעות האלה מצדיקות את עצמן, או שעדיף היה להחזיר את הכסף לבעלים?"));
    out.push({ id: "growth", title: t("The growth engine: reinvestment × return = growth", "מנוע הצמיחה: השקעה מחדש × תשואה = צמיחה"), tone,
      headline: fundamental <= 0 ? t("Not funding growth today", "לא מממנת צמיחה כרגע") : huge ? t("Can fund very fast growth from its own profits", "יכולה לממן צמיחה מהירה מאוד מהרווחים שלה") : t(`Can fund about ${P(fundamental)} growth a year itself`, `יכולה לממן בעצמה צמיחה של כ-${P(fundamental)} בשנה`), body, uses: metricsOf("reinvestment_rate", "roic", "rev_cagr_3y", "rev_growth_ttm") });
  }

  // 3. profit into cash
  const nm = v("net_margin"), fm = v("fcf_margin"), capex = v("capex_intensity"), sbc = v("sbc_intensity");
  if (fin(nm) && fin(fm)) {
    const body: string[] = [];
    const conv = nm > 0 ? fm / nm : null;
    body.push(t(`Of each revenue dollar, ${P(nm)} shows up as profit and ${P(fm)} as free cash flow.`, `מכל דולר הכנסות, ${P(nm)} נרשמים כרווח נקי ו-${P(fm)} כתזרים מזומנים חופשי.`));
    if (conv !== null) body.push(conv >= 0.9
      ? t("Profits are turning into cash — a sign the earnings are real.", "הרווחים הופכים למזומנים — סימן שהרווח אמיתי.")
      : conv >= 0.5
      ? t(`About ${P(conv * 100)} of profit turns into cash; the rest goes back into the business (capital spending is ${fin(capex) ? P(capex) : "n/a"} of revenue) or is tied up in working capital.`, `בערך ${P(conv * 100)} מהרווח הופכים למזומנים; השאר חוזר לעסק (השקעות ההון הן ${fin(capex) ? P(capex) : "—"} מההכנסות) או נתקע בהון החוזר.`)
      : t("Little of the profit is turning into cash. That's normal for a company investing heavily to grow, but worth checking: profits that never become cash are a warning sign.", "מעט מהרווח הופך למזומנים. זה רגיל לחברה שמשקיעה הרבה כדי לצמוח, אבל כדאי לבדוק: רווחים שאף פעם לא הופכים למזומנים הם סימן אזהרה."));
    if (fin(sbc) && sbc >= 3) body.push(t(`Stock-based pay is ${P(sbc)} of revenue. It doesn't use cash, but it is a real cost — owners pay it through dilution — so the cash figure flatters by about that much.`, `התגמול במניות הוא ${P(sbc)} מההכנסות. הוא לא יוצא מהקופה, אבל זו עלות אמיתית — הבעלים משלמים אותה בדילול — ולכן נתון המזומנים נראה טוב יותר בערך בשיעור הזה.`));
    const tone: ReadTone = conv === null ? "weak" : conv >= 0.9 && !(fin(sbc) && sbc >= 8) ? "good" : conv >= 0.5 ? "mixed" : "weak";
    out.push({ id: "cash", title: t("Profit into cash: net margin, free cash flow, stock pay", "מהרווח למזומנים: רווח נקי, תזרים חופשי, תגמול במניות"), tone,
      headline: conv === null ? t("Not profitable yet", "עוד לא רווחית") : t(`${P(Math.min(conv * 100, 300))} of profit becomes cash`, `${P(Math.min(conv * 100, 300))} מהרווח הופכים למזומנים`), body, uses: metricsOf("net_margin", "fcf_margin", "capex_intensity", "sbc_intensity", "fcf_after_sbc") });
  }

  // 4. the owners' share
  const crf = v("cash_return_vs_fcf"), sh = v("share_change");
  if (fin(sh)) {
    const body: string[] = [];
    body.push(sh > 1
      ? t(`The share count rose ${P(sh, 1)} in a year: each share owns a smaller slice of the company.`, `מספר המניות עלה ב-${P(sh, 1)} בשנה: כל מניה מחזיקה פרוסה קטנה יותר מהחברה.`)
      : sh < -1 ? t(`The share count fell ${P(-sh, 1)} in a year: buybacks gave each share a bigger slice.`, `מספר המניות ירד ב-${P(-sh, 1)} בשנה: רכישות חוזרות הגדילו את הפרוסה של כל מניה.`)
      : t("The share count barely changed: buybacks roughly offset the shares issued to employees.", "מספר המניות כמעט לא השתנה: הרכישות החוזרות קיזזו בערך את המניות שהונפקו לעובדים."));
    if (fin(crf)) body.push(crf > 120
      ? t(`It returned ${P(crf)} of its free cash flow to owners — more than it generated, so the difference came from cash on hand or borrowing.`, `היא החזירה לבעלים ${P(crf)} מהתזרים החופשי — יותר ממה שייצרה, כך שההפרש בא מהקופה או מהלוואות.`)
      : crf > 20 ? t(`It returned ${P(crf)} of its free cash flow through buybacks and dividends.`, `היא החזירה ${P(crf)} מהתזרים החופשי שלה ברכישות חוזרות ובדיבידנדים.`)
      : t("It keeps most of its free cash flow — fine for a company with good uses for it, a question for one without.", "היא שומרת את רוב התזרים החופשי — בסדר לחברה שיש לה שימושים טובים בכסף, שאלה לחברה שאין לה."));
    out.push({ id: "owners", title: t("The owners' share: buybacks, dividends, dilution", "החלק של הבעלים: רכישות חוזרות, דיבידנדים, דילול"), tone: sh > 3 ? "weak" : sh < -1 ? "good" : "neutral",
      headline: sh > 1 ? t("Owners are being diluted", "הבעלים מדוללים") : sh < -1 ? t("Owners' slice is growing", "הפרוסה של הבעלים גדלה") : t("Owners' slice is steady", "הפרוסה של הבעלים יציבה"), body, uses: metricsOf("share_change", "cash_return", "cash_return_vs_fcf", "sbc_intensity") });
  }

  // 5. safety
  const de = v("debt_to_ebitda"), cov = v("interest_coverage");
  if (!p.financial && (fin(de) || fin(cov))) {
    const body: string[] = [];
    const rating = M.get("synthetic_rating")?.display;
    if (fin(de)) body.push(t(`Its debt equals about ${X(de)} a year of operating cash earnings (EBITDA)${fin(cov) ? `, and operating profit covers its interest ${X(cov, 0)}` : ""}${rating && rating !== "n/a" ? ` — like a ${rating} credit rating` : ""}.`, `החוב שלה שווה בערך ${X(de)} שנים של רווח תפעולי במזומן (EBITDA)${fin(cov) ? `, והרווח התפעולי מכסה את הריבית ${X(cov, 0)}` : ""}${rating && rating !== "n/a" ? ` — כמו דירוג אשראי ${ltr(rating)}` : ""}.`));
    const risky = (fin(de) && de > 3) || (fin(cov) && cov < 3);
    body.push(risky
      ? t("That is a heavy load: a bad year could squeeze it. Debt is safest in steady businesses; the more its profits swing, the more this matters.", "זה עומס כבד: שנה רעה יכולה ללחוץ עליה. חוב בטוח יותר בעסקים יציבים; ככל שהרווחים שלה תנודתיים יותר, זה חשוב יותר.")
      : t("Comfortable: the debt is small next to what it earns.", "נוח: החוב קטן ביחס למה שהיא מרוויחה."));
    out.push({ id: "safety", title: t("Safety: debt against earnings", "ביטחון: חוב מול רווחים"), tone: risky ? "weak" : "good", headline: risky ? t("Debt is heavy", "החוב כבד") : t("Debt is light", "החוב קל"), body, uses: metricsOf("debt_to_ebitda", "interest_coverage", "synthetic_rating", "lease_debt") });
  }

  // 6. the price vs the engine
  const pe = v("pe"), evE = v("ev_ebit");
  if (fin(evE) && evE > 0 && fin(roic) && fin(coc)) {
    const yieldPct = 100 / evE;
    const body = [t(
      `At ${X(evE, 0)} its operating profit, the price gives an operating earnings yield of about ${P(yieldPct, 1)} before growth, against a cost of capital of ${P(coc, 1)}${fin(pe) ? ` (P/E ${X(pe, 0)})` : ""}. ${yieldPct >= coc ? "The price would be covered even with little growth — the market expects little." : "The gap has to be filled by growth — and growth only adds value at returns above the cost of capital, which " + (roic > coc ? "it has." : "it doesn't have today.")}`,
      `במחיר של ${X(evE, 0)} מהרווח התפעולי, המחיר נותן תשואת רווח תפעולי של כ-${P(yieldPct, 1)} לפני צמיחה, מול עלות הון של ${P(coc, 1)}${fin(pe) ? ` (מכפיל רווח ${X(pe, 0)})` : ""}. ${yieldPct >= coc ? "המחיר מוצדק גם בלי הרבה צמיחה — השוק מצפה למעט." : "את הפער צריכה למלא צמיחה — וצמיחה מוסיפה ערך רק בתשואות מעל עלות ההון, " + (roic > coc ? "ויש לה כאלה." : "ואין לה כאלה היום.")}`)];
    out.push({ id: "price", title: t("The price against the engine", "המחיר מול המנוע"), tone: "neutral", headline: yieldPct >= coc ? t("Priced for little growth", "מתומחרת לצמיחה מועטה") : t("Priced for growth", "מתומחרת לצמיחה"), body, uses: metricsOf("ev_ebit", "pe", "ps") });
  }
  return out;
}
