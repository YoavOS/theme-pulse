import type { LensPayload } from "@/lib/lens/types";
import type { StatementPeriod } from "../../../supabase/functions/_shared/financialStatements";
import type { ProvenRow } from "@/lib/proven/types";
import { comparisonQuarter, isNumber, latestQuarterSummary } from "@/lib/lens/quarterly";
import { buildScenarios, demandVsHistory, type Scenario } from "@/lib/lens/valuation";

/**
 * The words behind each Lens tab's hero — headline, short story and key figures — written from the
 * company's own numbers, like the Company story's. Pure functions (tested in tabStories.test.ts).
 * Every sentence describes the data; none recommends buying or selling.
 */

export interface StoryKpi { label: string; value: string; caption?: string; tone?: "auto" | "neutral" | "warn" }
export interface TabStory { title: string; paras: string[]; kpis: StoryKpi[]; footer?: string; watch?: string }

type T = (en: string, he: string) => string;
const tr = (he: boolean): T => (en, h) => (he ? h : en);
const money = (n: number | null | undefined) => !isNumber(n) ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n).replace(/^-/, "−");
const money2 = (n: number | null | undefined) => !isNumber(n) ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(n);
const pct = (n: number | null | undefined, d = 1) => !isNumber(n) ? "—" : `${n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}%`;
const signed = (n: number | null | undefined, unit = "%", d = 1) => !isNumber(n) ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}${unit}`;
const times = (n: number | null | undefined) => !isNumber(n) ? "—" : `${n.toFixed(1)}×`;
const per100 = (part: number | null | undefined, whole: number | null | undefined) => isNumber(part) && isNumber(whole) && whole > 0 ? (100 * part) / whole : null;
export const parsePct = (s: string | null | undefined) => { const n = s ? parseFloat(s.replace(/[^\d.-]/g, "")) : NaN; return Number.isFinite(n) ? n : null; };

const metric = (p: LensPayload, id: string) => p.cards.flatMap((c) => c.metrics).find((m) => m.id === id) ?? null;
const mval = (p: LensPayload, id: string) => { const m = metric(p, id); return m && isNumber(m.value) ? m.value : null; };
const ttmRow = (p: LensPayload) => (p.statements ?? []).find((s) => s.kind === "ttm") ?? null;

// ── Market cap and price should describe the same company on the same day ────────────────

export interface CapPriceCheck { impliedShares: number; reportedShares: number; gapPct: number; flagged: boolean }
/** Market cap ÷ share price gives a share count; compare it with the latest reported diluted shares. */
export function capPriceCheck(p: LensPayload): CapPriceCheck | null {
  const cap = p.market.marketCap, price = p.market.price;
  const rows = (p.statements ?? []).filter((s) => isNumber(s.shares) && s.shares > 0);
  const latest = rows.sort((a, b) => b.end.localeCompare(a.end))[0];
  if (!isNumber(cap) || !isNumber(price) || cap <= 0 || price <= 0 || !latest) return null;
  const impliedShares = cap / price, reportedShares = latest.shares!;
  const gapPct = (impliedShares / reportedShares - 1) * 100;
  return { impliedShares, reportedShares, gapPct, flagged: Math.abs(gapPct) > 10 };
}
export function capPriceWarning(c: CapPriceCheck | null, he: boolean): string | null {
  if (!c?.flagged) return null;
  const t = tr(he), sh = (n: number) => `${(n / 1e9).toFixed(2)}B`;
  return t(`Market cap and share price don't match: market cap ÷ price implies ${sh(c.impliedShares)} shares, but the latest filing reports ${sh(c.reportedShares)} (${signed(c.gapPct, "%", 0)}). They probably come from different dates, so read the multiples as approximate.`,
    `שווי השוק והמחיר למניה לא מתאימים: שווי שוק ÷ מחיר נותן ${sh(c.impliedShares)} מניות, אבל הדוח האחרון מדווח ${sh(c.reportedShares)} (${signed(c.gapPct, "%", 0)}). כנראה שהם מתאריכים שונים, ולכן כדאי לקרוא את המכפילים כהערכה.`);
}

// ── Banks: efficiency and provisions, quarter by quarter ─────────────────────────────

export interface BankPoint { end: string; efficiency: number | null; provisions: number | null; nii: number | null; revenue: number | null }
export interface BankMeasures { series: BankPoint[]; latest: BankPoint; yearAgo: BankPoint | null }
/** Efficiency ratio (non-interest expenses ÷ revenue) and provisions as a share of revenue, per quarter. */
export function bankMeasures(statements: StatementPeriod[]): BankMeasures | null {
  const q = latestQuarterSummary(statements);
  const point = (r: StatementPeriod): BankPoint => ({ end: r.end, revenue: r.revenue,
    efficiency: per100(r.nonIntExp, r.revenue), provisions: per100(r.provision, r.revenue), nii: r.nii ?? null });
  const series = q.rows.filter((r) => isNumber(r.nonIntExp) && isNumber(r.revenue) && r.revenue > 0).map(point);
  if (!series.length) return null;
  const i = q.rows.findIndex((r) => r.end === series[series.length - 1].end);
  const ya = i >= 0 ? comparisonQuarter(q.rows, i, 4) : null;
  return { series: series.slice(-8), latest: series[series.length - 1], yearAgo: ya && isNumber(ya.nonIntExp) ? point(ya) : null };
}

// ── Statements ───────────────────────────────────────────────────────────────────────

export function statementsStory(p: LensPayload, he: boolean): TabStory {
  const t = tr(he);
  const r = ttmRow(p), bank = !!(p.financial && r && isNumber(r.nonIntExp));
  const rev = r?.revenue ?? null, net = r?.net ?? null;
  const netPer = per100(net, rev);
  const title = netPer === null ? t("Follow each dollar of revenue down to profit", "עוקבים אחרי כל דולר הכנסות עד לרווח")
    : netPer >= 0 ? t(`Of every $100 of ${bank ? "revenue" : "revenue"}, about $${netPer.toFixed(0)} ends up as net profit`, `מכל $100 ${bank ? "הכנסות" : "הכנסות"}, בערך $${netPer.toFixed(0)} נשארים כרווח נקי`)
    : t(`For every $100 of revenue, the company loses about $${Math.abs(netPer).toFixed(0)}`, `על כל $100 הכנסות, החברה מפסידה בערך $${Math.abs(netPer).toFixed(0)}`);
  const paras: string[] = [];
  if (bank && r) {
    const e = per100(r.nonIntExp, rev), pv = per100(r.provision, rev), pre = per100(r.pretax, rev);
    paras.push(t(`Over the last twelve months, non-interest expenses took about $${e?.toFixed(0) ?? "—"} of every $100 of revenue and credit-loss provisions about $${pv?.toFixed(0) ?? "—"}, leaving about $${pre?.toFixed(0) ?? "—"} as profit before tax.`,
      `ב־12 החודשים האחרונים, הוצאות שאינן ריבית לקחו כ־$${e?.toFixed(0) ?? "—"} מכל $100 הכנסות, והפרשות להפסדי אשראי כ־$${pv?.toFixed(0) ?? "—"}, כך שנשארו כ־$${pre?.toFixed(0) ?? "—"} כרווח לפני מס.`));
    if (isNumber(r.nii) && isNumber(r.nonii)) paras.push(t(`Revenue comes from two sources: net interest income (${money(r.nii)}) and fees and other income (${money(r.nonii)}). The interest part moves with rates and lending.`,
      `ההכנסות מגיעות משני מקורות: הכנסות ריבית נטו (${money(r.nii)}) ועמלות והכנסות אחרות (${money(r.nonii)}). חלק הריבית זז עם הריבית ועם היקף ההלוואות.`));
    paras.push(t("For a bank, cash flow mostly reflects lending and deposits, so profit and return on equity are the better guides.", "בבנק, תזרים המזומנים משקף בעיקר הלוואות ופיקדונות, ולכן הרווח והתשואה על ההון העצמי הם המדריכים הטובים יותר."));
  } else if (r) {
    const c = per100(r.cost, rev), opx = per100(isNumber(r.gross) && isNumber(r.operating) ? r.gross - r.operating : null, rev), op = per100(r.operating, rev);
    if (c !== null || opx !== null) paras.push(t(`Over the last twelve months, direct costs took about $${c?.toFixed(0) ?? "—"} of every $100 of revenue and running the business another $${opx?.toFixed(0) ?? "—"}, leaving about $${op?.toFixed(0) ?? "—"} as operating profit.`,
      `ב־12 החודשים האחרונים, עלויות ישירות לקחו כ־$${c?.toFixed(0) ?? "—"} מכל $100 הכנסות והפעלת העסק עוד כ־$${opx?.toFixed(0) ?? "—"}, כך שנשארו כ־$${op?.toFixed(0) ?? "—"} כרווח תפעולי.`));
    if (isNumber(r.ocf) && isNumber(net) && net > 0) {
      const conv = r.ocf / net;
      paras.push(t(`Operations brought in $${conv.toFixed(2)} of cash for every $1 of net profit. ${conv < 0.8 ? "Cash trailing profit is worth a look: receivables, inventory or prepaid costs can explain it." : "Profit is turning into cash."}`,
        `הפעילות הכניסה $${conv.toFixed(2)} מזומן על כל $1 של רווח נקי. ${conv < 0.8 ? "כשהמזומן מפגר אחרי הרווח כדאי לבדוק: יתרות לקוחות, מלאי או הוצאות מראש יכולים להסביר זאת." : "הרווח הופך למזומן."}`));
    }
    const q = latestQuarterSummary(p.statements ?? []), i = q.rows.length - 1;
    const ya = i >= 0 ? comparisonQuarter(q.rows, i, 4) : null;
    const m1 = per100(q.latest?.operating, q.latest?.revenue), m0 = per100(ya?.operating, ya?.revenue);
    if (m1 !== null && m0 !== null) paras.push(t(`The latest quarter's operating margin was ${pct(m1)}, ${signed(m1 - m0, " points")} against the same quarter a year earlier.`,
      `שיעור הרווח התפעולי ברבעון האחרון היה ${pct(m1)}, ${signed(m1 - m0, " נקודות")} מול אותו רבעון אשתקד.`));
  }
  const kpis: StoryKpi[] = bank && r ? [
    { label: t("Revenue", "הכנסות"), value: money(rev), caption: t("last 12 months", "12 החודשים האחרונים") },
    { label: t("Efficiency ratio", "יחס יעילות"), value: pct(per100(r.nonIntExp, rev), 0), caption: t("expenses ÷ revenue · lower is leaner", "הוצאות ÷ הכנסות · נמוך = רזה"), tone: "neutral" },
    { label: t("Credit-loss provisions", "הפרשות להפסדי אשראי"), value: pct(per100(r.provision, rev), 1), caption: t("share of revenue", "חלק מההכנסות"), tone: "neutral" },
    { label: t("Net margin", "שיעור רווח נקי"), value: pct(netPer), caption: t("profit after everything", "רווח אחרי הכול") },
  ] : [
    { label: t("Revenue", "הכנסות"), value: money(rev), caption: t("last 12 months", "12 החודשים האחרונים") },
    { label: t("Gross margin", "שיעור רווח גולמי"), value: pct(per100(r?.gross, rev)), caption: t("after direct costs", "אחרי עלויות ישירות") },
    { label: t("Operating margin", "שיעור רווח תפעולי"), value: pct(per100(r?.operating, rev)), caption: t("after running the business", "אחרי הפעלת העסק") },
    { label: t("Net margin", "שיעור רווח נקי"), value: pct(netPer), caption: t("after interest and tax", "אחרי ריבית ומס") },
  ];
  const fcf = r && isNumber(r.ocf) && isNumber(r.capex) ? r.ocf - r.capex : null;
  return { title, paras, kpis, footer: !bank && fcf !== null ? t(`Free cash flow over the same 12 months: ${money(fcf)} (${pct(per100(fcf, rev))} of revenue).`, `תזרים חופשי באותם 12 חודשים: ${money(fcf)} (${pct(per100(fcf, rev))} מההכנסות).`) : undefined };
}

// ── Valuation ────────────────────────────────────────────────────────────────────────

export interface ValuationFacts { pe: number | null; ps: number | null; pb: number | null; roe: number | null; costOfEquity: number | null; justifiedPb: number | null; scenarios: Scenario[] }
const STABLE_G = 3;   // % — long-run growth used for the illustrative justified price-to-book
export function valuationFacts(p: LensPayload): ValuationFacts {
  const cap = p.market.marketCap, r = ttmRow(p);
  // same order as the multiples card: provider multiple first, else market cap ÷ the last 12 months
  const profitable = !isNumber(r?.net) || r!.net! > 0;
  const pe = !profitable ? null : p.marketPricing?.pe ?? (isNumber(cap) && isNumber(r?.net) && r!.net! > 0 ? cap / r!.net! : mval(p, "pe"));
  const ps = p.marketPricing?.ps ?? (isNumber(cap) && isNumber(r?.revenue) && r!.revenue! > 0 ? cap / r!.revenue! : mval(p, "ps"));
  const roe = mval(p, "roe");
  const equity = isNumber(roe) && roe > 0 && isNumber(r?.net) && r!.net! > 0 ? r!.net! / (roe / 100) : null;
  const pb = p.marketPricing?.pb ?? (isNumber(cap) && isNumber(equity) ? cap / equity : null);
  const coe = parsePct(p.damodaran?.costOfEquity);
  const justifiedPb = isNumber(roe) && isNumber(coe) && coe > STABLE_G ? (roe - STABLE_G) / (coe - STABLE_G) : null;
  const v = p.valuation;
  const scenarios = v && isNumber(v.marketCap) && v.marketCap > 0 ? (() => { try { return buildScenarios(v, v.marketCap + v.debt - v.cash, 4.2); } catch { return []; } })() : [];
  return { pe, ps, pb, roe, costOfEquity: coe, justifiedPb, scenarios };
}

export function valuationStory(p: LensPayload, he: boolean): TabStory {
  const t = tr(he), f = valuationFacts(p), v = p.valuation;
  const cur = f.scenarios.find((s) => s.id === "cautious"), ind = f.scenarios.find((s) => s.id === "typical");
  const paras: string[] = [];
  let title: string;
  if (p.financial) {
    title = isNumber(f.pb) && isNumber(f.roe) ? t(`Investors pay ${times(f.pb)} book value for a ${pct(f.roe)} return on equity`, `המשקיעים משלמים פי ${f.pb.toFixed(1)} מההון בספרים על תשואה של ${pct(f.roe)} על ההון העצמי`)
      : t("For a bank, read the price against its return on equity", "בבנק, קוראים את המחיר מול התשואה על ההון העצמי");
    if (isNumber(f.roe) && isNumber(f.costOfEquity)) paras.push(t(`A bank creates value when its return on equity beats what shareholders require — about ${pct(f.costOfEquity)} for its industry. ${p.symbol} earns ${pct(f.roe)}, ${f.roe > f.costOfEquity ? "above" : "below"} that bar.`,
      `בנק יוצר ערך כשהתשואה על ההון העצמי שלו עולה על מה שבעלי המניות דורשים — כ־${pct(f.costOfEquity)} בענף שלו. ${p.symbol} מרוויחה ${pct(f.roe)}, ${f.roe > f.costOfEquity ? "מעל" : "מתחת ל"}רף הזה.`));
    if (isNumber(f.justifiedPb) && isNumber(f.pb)) paras.push(t(`If that return lasted and the bank grew ${STABLE_G}% a year forever, a fair price to book would be about ${times(f.justifiedPb)}. The market pays ${times(f.pb)}: ${f.pb > f.justifiedPb * 1.15 ? "it expects returns or growth above that" : f.pb < f.justifiedPb * 0.85 ? "it expects that return to fade, or sees more risk" : "close to that simple yardstick"}.`,
      `אם התשואה הזו הייתה נמשכת והבנק היה צומח ב־${STABLE_G}% בשנה לנצח, מכפיל הון הוגן היה כ־פי ${f.justifiedPb.toFixed(1)}. השוק משלם פי ${f.pb.toFixed(1)}: ${f.pb > f.justifiedPb * 1.15 ? "הוא מצפה לתשואה או לצמיחה גבוהות מזה" : f.pb < f.justifiedPb * 0.85 ? "הוא מצפה שהתשואה תשחק, או רואה יותר סיכון" : "קרוב למדד הפשוט הזה"}.`));
  } else if (cur && v) {
    const im = cur.implied, past = v.pastGrowth3y;
    title = im.kind === "ok" ? t(`If ${p.symbol} keeps today's margins, the price needs about ${pct(im.growth, 0)} revenue growth a year for five years`, `אם ${p.symbol} תשמור על שיעורי הרווח של היום, המחיר צריך צמיחת הכנסות של כ־${pct(im.growth, 0)} בשנה במשך חמש שנים`)
      : im.kind === "shrink" ? t(`Today's profits already cover the price, even if revenue shrinks`, `הרווחים של היום כבר מכסים את המחיר, גם אם ההכנסות יתכווצו`)
      : im.kind === "beyond" ? t(`Even very fast growth doesn't reach this price at today's margins`, `גם צמיחה מהירה מאוד לא מגיעה למחיר הזה בשיעורי הרווח של היום`)
      : t(`At today's returns, growth doesn't add value — the price needs better economics`, `בתשואות של היום צמיחה לא מוסיפה ערך — המחיר צריך כלכלה טובה יותר`);
    paras.push(t(`Damodaran's way to read a price: turn it into the story it implies. A simple 10-year cash-flow model, at ${p.symbol}'s cost of capital (${pct(v.costOfCapital)}), asks what revenue growth makes the business worth today's market value.`,
      `הדרך של דמודרן לקרוא מחיר: להפוך אותו לסיפור שהוא מניח. מודל תזרים פשוט ל־10 שנים, בעלות ההון של ${p.symbol} (${pct(v.costOfCapital)}), שואל איזו צמיחה בהכנסות הופכת את העסק לשווה את שווי השוק של היום.`));
    if (im.kind === "ok") {
      const d = demandVsHistory(im.growth, past);
      const word = d === "less" ? t("less than", "פחות מ") : d === "same" ? t("about the same as", "בערך כמו") : d === "more" ? t("more than", "יותר מ") : d === "much_more" ? t("far more than", "הרבה יותר מ") : null;
      if (word && isNumber(past)) paras.push(t(`That is ${word} the ${pct(past, 0)} a year it delivered over the last three years${isNumber(v.industryGrowth5y) ? `, and its industry's ${pct(v.industryGrowth5y, 0)}` : ""}.`,
        `זה ${word}־${pct(past, 0)} בשנה שהיא השיגה בשלוש השנים האחרונות${isNumber(v.industryGrowth5y) ? `, ומ־${pct(v.industryGrowth5y, 0)} של הענף` : ""}.`));
    }
    if (ind && ind.implied.kind === "ok" && isNumber(v.industryOpMargin)) paras.push(t(`If its margins drift to the industry's ${pct(v.industryOpMargin, 0)}, the price would need about ${pct(ind.implied.growth, 0)} a year instead. A good company can still be a demanding price — the question is which story you believe.`,
      `אם שיעורי הרווח שלה יתקרבו ל־${pct(v.industryOpMargin, 0)} של הענף, המחיר יצטרך כ־${pct(ind.implied.growth, 0)} בשנה. חברה טובה עדיין יכולה להיות מתומחרת בתובענות — השאלה היא באיזה סיפור מאמינים.`));
  } else {
    title = isNumber(f.pe) ? t(`Investors pay about $${f.pe.toFixed(0)} for each $1 of yearly profit`, `המשקיעים משלמים כ־$${f.pe.toFixed(0)} על כל $1 של רווח שנתי`) : t("What investors pay for each dollar of results", "כמה משקיעים משלמים על כל דולר של תוצאות");
    paras.push(t("A full cash-flow reading needs structured SEC data on capital and debt, which isn't available for this company. The multiples below are the quick view.", "קריאה מלאה של תזרים דורשת נתוני SEC מובנים על הון וחוב, שאינם זמינים לחברה הזו. המכפילים למטה הם המבט המהיר."));
  }
  const kpis: StoryKpi[] = [
    { label: t("Market cap", "שווי שוק"), value: money2(p.market.marketCap), caption: t("all shares", "כל המניות") },
    { label: "P/E", value: times(f.pe), caption: t("price ÷ yearly profit", "מחיר ÷ רווח שנתי"), tone: "neutral" },
    p.financial ? { label: "P/B", value: times(f.pb), caption: t("price ÷ book equity", "מחיר ÷ הון בספרים"), tone: "neutral" }
      : { label: "P/S", value: times(f.ps), caption: t("price ÷ yearly revenue", "מחיר ÷ הכנסות שנתיות"), tone: "neutral" },
    p.financial ? { label: t("Return on equity", "תשואה על ההון העצמי"), value: pct(f.roe), caption: t("what the price buys", "מה שהמחיר קונה") }
      : { label: t("Growth the price needs", "הצמיחה שהמחיר צריך"), value: cur?.implied.kind === "ok" ? `${pct(cur.implied.growth, 0)}/yr` : "—", caption: t("at today's margins", "בשיעורי הרווח של היום"), tone: "warn" },
  ];
  return { title, paras, kpis, watch: capPriceWarning(capPriceCheck(p), he) ?? undefined,
    footer: t(`Market snapshot${p.market.asOf ? ` from ${p.market.asOf.slice(0, 10)}` : " date unavailable"}. A conditional model, not a forecast.`, `נתוני שוק${p.market.asOf ? ` מ־${p.market.asOf.slice(0, 10)}` : " ללא תאריך"}. מודל מותנה, לא תחזית.`) };
}

// ── Evidence ─────────────────────────────────────────────────────────────────────────

export function evidenceStory(p: LensPayload, proven: ProvenRow | null, he: boolean): TabStory {
  const t = tr(he);
  const fin = p.financial;
  const ret = mval(p, fin ? "roe" : "roic"), hurdle = parsePct(fin ? p.damodaran?.costOfEquity : p.damodaran?.costOfCapital);
  const spread = mval(p, fin ? "equity_spread" : "excess_return") ?? (isNumber(ret) && isNumber(hurdle) ? ret - hurdle : null);
  const what = fin ? t("equity", "הון עצמי") : t("capital", "הון");
  const title = isNumber(ret) && isNumber(hurdle) ? (ret >= hurdle
      ? t(`Earns ${pct(ret, 0)} on ${what} that costs ${pct(hurdle)}`, `מרוויחה ${pct(ret, 0)} על ${what} שעולה ${pct(hurdle)}`)
      : t(`Earns ${pct(ret, 0)} on ${what} that costs ${pct(hurdle)} — below the bar`, `מרוויחה ${pct(ret, 0)} על ${what} שעולה ${pct(hurdle)} — מתחת לרף`))
    : t("Does the business earn more than its capital costs?", "האם העסק מרוויח יותר ממה שההון שלו עולה?");
  const paras: string[] = [];
  if (isNumber(spread)) paras.push(spread > 0
    ? t(`That gap — ${signed(spread, " points")} — is what Damodaran calls an excess return: growth adds value only while it lasts.`, `הפער הזה — ${signed(spread, " נקודות")} — הוא מה שדמודרן מכנה תשואה עודפת: צמיחה מוסיפה ערך רק כל עוד הוא נשמר.`)
    : t(`A negative gap (${signed(spread, " points")}) means growth currently costs more than it earns; the question is whether returns can improve.`, `פער שלילי (${signed(spread, " נקודות")}) אומר שהצמיחה כרגע עולה יותר ממה שהיא מכניסה; השאלה היא אם התשואות יכולות להשתפר.`));
  paras.push(proven?.sentence ? proven.sentence : t("The ten-year track record isn't available for this company, so the evidence rests on recent years.", "הרקורד לעשר שנים אינו זמין לחברה הזו, ולכן הראיות נשענות על השנים האחרונות."));
  const bench = metric(p, fin ? "roe" : "roic")?.bench?.display;
  paras.push(t(`High returns tend to fade as competitors arrive${bench ? ` — its industry averages ${bench}` : ""}. The cards below show how the returns are earned, how they compare, and what the numbers can't tell you.`,
    `תשואות גבוהות נוטות להישחק כשמתחרים מגיעים${bench ? ` — הממוצע בענף שלה הוא ${bench}` : ""}. הכרטיסים למטה מראים איך התשואות מושגות, איך הן נראות בהשוואה, ומה המספרים לא יכולים לספר.`));
  const years = proven && isNumber(proven.years_valid) && proven.years_valid > 0 ? `${proven.years_above ?? 0}/${proven.years_valid}` : "—";
  return { title, paras, kpis: [
    { label: fin ? t("Return on equity", "תשואה על ההון העצמי") : t("Return on invested capital", "תשואה על ההון המושקע"), value: pct(ret) },
    { label: fin ? t("Cost of equity", "עלות ההון העצמי") : t("Cost of capital", "עלות ההון"), value: pct(hurdle), caption: t("industry hurdle", "רף הענף"), tone: "neutral" },
    { label: t("Excess return", "תשואה עודפת"), value: signed(spread, " pp"), caption: t("return − cost", "תשואה − עלות") },
    { label: t("Track record", "רקורד"), value: years, caption: t("years above the hurdle", "שנים מעל הרף"), tone: "neutral" },
  ] };
}

// ── Learn ────────────────────────────────────────────────────────────────────────────

export function learnStory(p: LensPayload, seen: number, total: number, terms: number, he: boolean): TabStory {
  const t = tr(he);
  return {
    title: t(`Learn the ideas with ${p.symbol}'s own numbers`, `לומדים את הרעיונות עם המספרים של ${p.symbol}`),
    paras: [
      t("Each idea opens with what it means, why Damodaran cares about it, and what it says about this company. Start with the three foundations, then follow the questions: growth, profit, reinvestment, risk, cash and price.",
        "כל רעיון נפתח במה שהוא אומר, למה דמודרן מתייחס אליו, ומה הוא מספר על החברה הזו. מתחילים בשלושת היסודות, ואז ממשיכים לפי השאלות: צמיחה, רווח, השקעה מחדש, סיכון, מזומן ומחיר."),
      t("Underlined words open a short explanation anywhere in the Lens, and the Terms button lists all of them.", "מילים עם קו תחתון פותחות הסבר קצר בכל מקום בעדשה, וכפתור המושגים מציג את כולן."),
    ],
    kpis: [
      { label: t("Ideas explored", "רעיונות שנחקרו"), value: `${seen}/${total}`, caption: t("open one to mark it", "פותחים כדי לסמן"), tone: "neutral" },
      { label: t("Foundations", "יסודות"), value: String(p.foundations.length), caption: t("start here", "מתחילים כאן"), tone: "neutral" },
      { label: t("Questions", "שאלות"), value: "6", caption: t("growth to price", "מצמיחה ועד מחיר"), tone: "neutral" },
      { label: t("Terms", "מושגים"), value: String(terms), caption: t("in the glossary", "במילון"), tone: "neutral" },
    ],
  };
}
