import { useState } from "react";
import type { LensPayload } from "@/lib/lens/types";
import { useLensLang } from "@/lib/lens/i18n";
import { comparablePeriods, isNumber, percentageChange, latestQuarterSummary } from "@/lib/lens/quarterly";
import { CHART } from "./QuarterlyChart";
import { AutoTerms } from "./Term";
import { valuationFacts } from "@/lib/lens/tabStories";
import { extraComparison, type ExtraPair } from "@/lib/lens/extraComparisons";

type MetricPair = "cash" | "profit" | "margin" | ExtraPair;

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });
const money = (n: number | null | undefined) => isNumber(n) ? dollars.format(n) : "—";
const date = (value: string | null | undefined) => value?.slice(0, 10) ?? "—";
const percent = (n: number | null) => n === null ? "—" : (n > 0 ? "+" : "") + n.toFixed(1) + "%";
const ratio = (n: number | null) => n === null ? "—" : n.toFixed(1) + "×";
const cashDelta = (n: number | null) => n === null ? "—" : (n > 0 ? "+" : "") + money(n);

export function BusinessContextCard({ p }: { p: LensPayload }) {
  const he = useLensLang() === "he";
  const t = (en: string, h: string) => he ? h : en;
  const context = p.businessContext;
  if (!context?.description && !context?.annualUrl && !context?.industry) return null;
  return <section className="rounded-xl border border-border bg-card/40 px-4 py-3">
    <h2 className="font-semibold">{t("What the company does", "מה החברה עושה")}</h2>
    {context.industry && <p className="mt-1 text-xs text-muted-foreground">{t("SEC business classification", "סיווג עסקי של ה־SEC")} · <bdi>{context.industry}</bdi></p>}
    {context.description && <p dir="auto" className="mt-2 max-w-4xl text-sm text-muted-foreground">{context.description}</p>}
    {context.annualUrl && <a className="mt-2 inline-block text-sm text-primary underline" href={context.annualUrl} target="_blank" rel="noreferrer">
      {t("Annual filing: products, customers and risks", "הדוח השנתי: מוצרים, לקוחות וסיכונים")} <bdi>{context.annualFiled}</bdi>
    </a>}
  </section>;
}

export function MetricConnections({ p }: { p: LensPayload }) {
  const he = useLensLang() === "he";
  const t = (en: string, h: string) => he ? h : en;
  // Banks report no cost of revenue, operating profit or meaningful operating cash flow: give them bank pairs instead.
  const bank = p.financial && (p.statements ?? []).some((r) => isNumber(r.nonIntExp));
  const [pair, setPair] = useState<MetricPair>(bank ? "bankEfficiency" : "cash");
  const extra = pair === "cash" || pair === "profit" || pair === "margin" ? null : extraComparison(pair, p, t);
  const options: { key: MetricPair; label: string }[] = bank ? [
    { key: "bankEfficiency", label: t("Revenue & expenses", "הכנסות והוצאות") },
    { key: "bankCredit", label: t("Interest income & provisions", "הכנסות ריבית והפרשות") },
    { key: "perShare", label: t("Profit & earnings per share", "רווח ורווח למניה") },
  ] : [
    { key: "cash", label: t("Revenue & cash", "הכנסות ומזומנים") },
    { key: "profit", label: t("Profit & cash flow", "רווח ותזרים") },
    { key: "margin", label: t("Sales & margin", "מכירות ושיעור רווח") },
    { key: "netProfit", label: t("Operating profit & net profit", "רווח תפעולי ורווח נקי") },
    { key: "perShare", label: t("Profit & earnings per share", "רווח ורווח למניה") },
  ];
  if (!p.financial && !bank) {
    options.push({ key: "investment", label: t("Investment & cash left", "השקעה ומזומן שנותר") });
    options.push({ key: "debt", label: t("Debt & interest", "חוב וריבית") });
  }
  const facts = p.connection;
  const q = latestQuarterSummary(p.statements ?? []);
  const currentMargin = isNumber(q.latest?.operating) && isNumber(q.latest?.revenue) && q.latest.revenue > 0
    ? 100 * q.latest.operating / q.latest.revenue : null;
  const comparable = q.latest && q.previous && comparablePeriods(q.latest.end, q.previous.end, 1);
  const priorMargin = comparable && isNumber(q.previous?.operating) && isNumber(q.previous?.revenue) && q.previous.revenue > 0
    ? 100 * q.previous.operating / q.previous.revenue : null;
  const x = facts?.cashChange ?? null;
  const op = facts?.operatingCash ?? null;
  const fin = facts?.financingCash ?? null;
  const inv = facts?.investingCash ?? null;
  const borrowing = facts?.borrowing ?? null;
  const advances = facts?.customerAdvancesChange ?? null;
  const revenueGrowth = facts ? percentageChange(facts.revenue, facts.priorRevenue) : q.qoq;
  const marginDelta = currentMargin !== null && priorMargin !== null ? currentMargin - priorMargin : null;
  const changeInMargin = marginDelta === null ? "—" : (marginDelta > 0 ? "+" : "") + marginDelta.toFixed(1) + " pp";
  const oldGross = comparable && isNumber(q.previous?.gross) && isNumber(q.previous.revenue) && q.previous.revenue > 0
    ? 100 * q.previous.gross / q.previous.revenue : null;
  const gross = isNumber(q.latest?.gross) && isNumber(q.latest.revenue) && q.latest.revenue > 0
    ? 100 * q.latest.gross / q.latest.revenue : null;
  const grossChange = gross !== null && oldGross !== null ? gross - oldGross : null;
  const pp = (n: number | null) => n === null ? "—" : (n > 0 ? "+" : "") + n.toFixed(1) + " pp";
  let summary: string;
  if (extra) {
    summary = extra.summary;
  } else if (pair === "cash") {
    summary = x === null ? t("A comparable cash balance is missing. Revenue alone can’t tell us how cash changed.", "חסרה יתרת מזומנים להשוואה. מההכנסות לבדן אי אפשר לדעת כיצד המזומנים השתנו.")
      : x > 0 && isNumber(fin) && fin > 0 && (!isNumber(op) || fin >= op) ? t("Financing supplied cash this quarter. Check the borrowing line before attributing that increase to customer sales.", "פעילות המימון הוסיפה מזומנים ברבעון. בדקו את סעיף ההלוואות לפני שמייחסים את העלייה למכירות.")
      : x > 0 && isNumber(op) && op > 0 && isNumber(fin) && fin <= 0 && isNumber(inv) && inv <= 0 ? t("Operations were the positive source among the three reported cash-flow categories. Investing and financing used cash or were flat.", "הפעילות השוטפת הייתה המקור החיובי מבין שלוש קטגוריות התזרים. ההשקעה והמימון צרכו מזומנים או נותרו ללא שינוי.")
      : x > 0 && isNumber(op) && op > 0 ? t("Operations generated cash. The other cash-flow lines help determine how much of the increase came from elsewhere.", "הפעילות השוטפת ייצרה מזומנים. סעיפי התזרים האחרים עוזרים להבין מה הגיע ממקורות נוספים.")
      : t("Read the cash-flow sources below. Sales are recognized when earned, while the cash balance also reflects spending, financing and collection timing.", "בדקו את מקורות התזרים למטה. הכנסות מוכרות כשהן נצברות, ואילו יתרת המזומנים מושפעת גם מהוצאות, מימון ועיתוי הגבייה.");
  } else if (pair === "profit") {
    summary = !isNumber(facts?.net) || op === null ? t("Reported profit and operating cash are both needed for a same-quarter comparison.", "להשוואה באותו רבעון דרושים רווח מדווח ותזרים מפעילות.")
      : op < facts.net ? t("Operating cash was below reported profit. Receivables, inventory and other timing effects can help explain the gap.", "תזרים מפעילות היה נמוך מהרווח המדווח. לקוחות חייבים, מלאי והבדלי עיתוי עשויים להסביר את הפער.")
      : t("Operating cash kept pace with or exceeded reported profit. Collection timing and non-cash expenses can still affect the comparison.", "התזרים מפעילות היה גבוה מהרווח המדווח או שווה לו. עיתוי גבייה והוצאות שאינן במזומן עדיין משפיעים על ההשוואה.");
  } else {
    summary = marginDelta === null ? t("Two comparable quarters with revenue and operating profit are needed to judge the margin change.", "דרושים שני רבעונים בני השוואה עם הכנסות ורווח תפעולי.")
      : marginDelta > 0 ? t("More of each sales dollar stayed as operating profit. Compare the gross margin and operating expense branches to see where the difference arose.", "חלק גדול יותר מכל דולר מכירות נשאר כרווח תפעולי. השוו את הרווח הגולמי והוצאות התפעול להבנת המקור.")
      : marginDelta < 0 ? t("Less of each sales dollar stayed as operating profit. Higher sales can coincide with higher costs or a less profitable mix.", "חלק קטן יותר מכל דולר מכירות נשאר כרווח תפעולי. הכנסות גבוהות יותר יכולות לבוא עם עלויות גבוהות או תמהיל פחות רווחי.")
      : t("The share of sales kept as operating profit was steady.", "חלק ההכנסות שנשאר כרווח תפעולי נותר יציב.");
  }
  const rows = extra?.rows ?? (pair === "cash" ? [
    [t("Operating cash flow", "תזרים מפעילות"), money(op)],
    [t("Investing cash flow", "תזרים מהשקעה"), money(inv)],
    [t("Financing cash flow", "תזרים ממימון"), money(fin)],
    [t("New long-term borrowing", "הלוואות חדשות לטווח ארוך"), money(borrowing)],
    [t("Long-term debt repayments", "החזרי חוב לטווח ארוך"), money(facts?.repaid)],
    [t("Current deferred revenue change", "שינוי בהכנסות נדחות שוטפות"), cashDelta(advances)],
  ] : pair === "profit" ? [
    [t("Reported net profit", "רווח נקי מדווח"), money(facts?.net)],
    [t("Operating cash flow", "תזרים מפעילות"), money(op)],
    [t("Trade receivables change", "שינוי ביתרות לקוחות"), cashDelta(facts?.receivablesChange ?? null)],
  ] : [
    [t("Revenue growth vs previous quarter", "צמיחת הכנסות מול הרבעון הקודם"), percent(q.qoq)],
    [t("Operating margin", "שיעור רווח תפעולי"), percent(currentMargin)],
    [t("Operating margin change", "שינוי בשיעור הרווח התפעולי"), changeInMargin],
    [t("Gross margin change", "שינוי בשיעור הרווח הגולמי"), pp(grossChange)],
    [t("Operating expenses as share of sales · change", "שינוי בחלקן של הוצאות התפעול מתוך המכירות"), pp(grossChange !== null && marginDelta !== null ? grossChange - marginDelta : null)],
  ]);
  // The two cash indicators compare the same end dates, but revenue is a
  // period total and cash is a balance at the period end.
  return <section className="rounded-2xl border border-border bg-card/40 p-4 sm:p-5">
    <div className="space-y-2">
      <div><h2 className="text-lg font-semibold">{t("How the numbers connect", "איך המספרים קשורים")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("Quarter ended", "רבעון שהסתיים ב־")} <bdi>{(extra?.end ?? (pair === "margin" ? q.latest?.end : facts?.end ?? q.latest?.end)) ?? "—"}</bdi></p></div>
      <div role="group" aria-label={t("Metric pair", "זוג מדדים")} className="flex flex-wrap gap-1">
        {options.map(({ key, label }) => <button key={key} type="button" aria-pressed={pair === key} onClick={() => setPair(key)}
            className={"rounded-lg border border-border px-2.5 py-1.5 text-xs " + (pair === key ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/40")}>{label}</button>)}
      </div>
    </div>
    {pair === "cash" && <div className="mt-4 grid grid-cols-2 gap-3">
      {[[t("Quarterly revenue", "הכנסות רבעוניות"), money(facts ? facts.revenue : q.latest?.revenue), percent(revenueGrowth)], [t("Ending cash balance", "יתרת מזומנים בסוף הרבעון"), money(facts?.cash), cashDelta(x)]].map(([label, value, change]) =>
        <div key={label} className="rounded-xl bg-muted/35 px-3 py-2"><p className="text-xs text-muted-foreground"><AutoTerms text={label}/></p>
          <bdi className="font-mono text-lg" style={{ color: CHART.positive }}>{value}</bdi>
          <p className="text-xs text-muted-foreground"><bdi>{change}</bdi> {t("vs previous quarter", "מול הרבעון הקודם")}</p></div>)}
    </div>}
    <p className="mt-3 max-w-4xl text-sm"><AutoTerms text={summary}/></p>
    <dl className="mt-3 grid gap-2 sm:grid-cols-3">
      {rows.map(([label, value]) => <div key={label} className="flex items-baseline justify-between gap-2 rounded-lg border border-border/60 px-2.5 py-2 text-xs">
        <dt className="text-muted-foreground"><AutoTerms text={label}/></dt><dd className="font-mono"><bdi>{value}</bdi></dd>
      </div>)}
    </dl>
    {pair === "cash" && <details className="mt-3 text-xs text-muted-foreground" open={advances !== null && advances > 0 || borrowing !== null && borrowing > 0 ? true : undefined}>
      <summary className="cursor-pointer font-medium text-foreground">{t("Could timing or borrowing explain it?", "האם עיתוי או הלוואות מסבירים את השינוי?")}</summary>
      <ul className="mt-2 space-y-2">
        <li><AutoTerms text={t("Customer prepayments.", "מקדמות מלקוחות.")}/> {<AutoTerms text={advances === null
          ? t("The filing data has no comparable deferred revenue balances, so upfront payments can’t be checked here.", "אין יתרות הכנסות נדחות בנות השוואה, ולכן אי אפשר לבדוק כאן מקדמות.")
          : advances > 0 ? t("The deferred revenue balance rose. That is consistent with more advance billing or receipts, but it does not measure cash collected.", "יתרת ההכנסות הנדחות עלתה. זה מתאים ליותר חיובים או מקדמות, אבל אינו מודד את הסכום שנגבה.")
          : t("Deferred revenue did not rise. There’s no net build in that line, although it can hide receipts and revenue recognized during the quarter.", "ההכנסות הנדחות לא עלו. אין עלייה נטו בסעיף, אך התקבלו אולי מקדמות והוכרו הכנסות במהלך הרבעון.")}/>}</li>
        <li><AutoTerms text={t("Loans.", "הלוואות.")}/> {<AutoTerms text={borrowing === null
          ? t("New long-term borrowing is unavailable as a separate figure. Net financing may include borrowing, repayments and shareholder payments.", "הלוואות חדשות לטווח ארוך אינן זמינות בנפרד. תזרים המימון נטו עשוי לכלול הלוואות, החזרים ותשלומים לבעלי מניות.")
          : borrowing > 0 ? t("The filing shows proceeds from new long-term debt. Loans bring in cash without creating sales. Compare repayments and net financing to see what remained.", "הדוח מציג תקבולים מחוב חדש לטווח ארוך. הלוואות מגדילות מזומנים בלי ליצור מכירות. השוו החזרי חוב ותזרים מימון נטו.")
          : t("This long-term borrowing line reports zero proceeds. Short-term borrowing and other financing may still affect cash.", "בסעיף הלוואות לטווח ארוך לא דווחו תקבולים. הלוואות קצרות ומימון אחר עדיין עשויים להשפיע.")}/>}</li>
      </ul>
    </details>}
    {extra && <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
      <strong className="me-1 text-foreground">{t("What can change the picture?", "מה יכול לשנות את התמונה?")}</strong> <AutoTerms text={extra.check}/>
    </div>}
    <p className="mt-3 text-xs text-muted-foreground">{t("Sources: reported statements. — means unavailable.", "מקור: דוחות מדווחים. — מציין מידע חסר.")}{" "}
      {pair === "cash" && <AutoTerms text={t("The cash-flow categories can differ from the cash-balance change because of currency effects or restricted cash.", "סעיפי התזרים עשויים להיות שונים מהשינוי ביתרת המזומנים בגלל מטבע או מזומנים מוגבלים.")}/>}</p>
  </section>;
}

export function MarketValuation({ p, bare = false }: { p: LensPayload; bare?: boolean }) {
  const he = useLensLang() === "he";
  const t = (en: string, h: string) => he ? h : en;
  const market = p.marketPricing;
  const cap = p.market.marketCap;
  const ttm = p.statements?.find(row => row.kind === "ttm");
  const quarters = latestQuarterSummary(p.statements ?? []).rows.slice(-4);
  const consecutive = quarters.length === 4 && quarters.slice(1).every((row, i) => comparablePeriods(row.end, quarters[i].end, 1));
  const total = (field: "net" | "revenue") => {
    if (ttm) return ttm[field];
    const values = quarters.map(row => row[field]);
    return consecutive && values.every(isNumber) ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  const net = total("net");
  const revenue = total("revenue");
  const fromCap = (value: number | null) => isNumber(cap) && cap > 0 && isNumber(value) && value > 0 ? cap / value : null;
  const profitable = !isNumber(net) || net > 0;
  const computedPe = profitable && market?.pe == null ? fromCap(net) : null;
  const computedPs = market?.ps == null ? fromCap(revenue) : null;
  const pe = profitable ? market?.pe ?? computedPe : null;
  const ps = market?.ps ?? computedPs;
  const derivedPb = market?.pb == null ? valuationFacts(p).pb : null;   // banks: market cap ÷ (net profit ÷ return on equity)
  const pb = market?.pb ?? derivedPb;
  const rows = [
    [t("P/E", "מכפיל רווח"), pe, !profitable
      ? t("The latest twelve-month reported result is a loss or zero, so a positive P/E would be misleading.", "הרווח המדווח ל־12 חודשים שלילי או אפס, ולכן מכפיל רווח חיובי מטעה.")
      : t("What investors pay for one dollar of annual profit. Higher values can reflect growth expectations or unusually low current earnings.", "כמה משקיעים משלמים על דולר רווח שנתי. מכפיל גבוה עשוי לשקף ציפיות צמיחה או רווח שוטף נמוך במיוחד.")],
    [t("P/S", "מכפיל מכירות"), ps, t("What investors pay for one dollar of annual sales. Compare margins before comparing this ratio across companies.", "כמה משקיעים משלמים על דולר מכירות שנתי. השוו שיעורי רווח לפני השוואת המכפיל בין חברות.")],
    [t("P/B", "מכפיל הון"), pb, t("What investors pay for one dollar of book equity. Often more useful for banks when read alongside return on equity.", "כמה משקיעים משלמים על דולר הון בספרים. בבנקים שימושי במיוחד לצד תשואה על ההון.")],
  ] as const;
  const peer = market?.peerPe;
  const hasMultiple = rows.some(([, value]) => value !== null);
  return <section className="space-y-4 rounded-2xl border border-border bg-card/45 p-4 sm:p-6">
    {!bare && <div><h2 className="text-xl font-semibold">{t("How the market values the company", "איך השוק מתמחר את החברה")}</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{<AutoTerms text={t("The latest market snapshot available to Theme Pulse. These figures describe the market price and what investors are paying per dollar of business results.", "תמונת השוק האחרונה הזמינה באפליקציה. הנתונים מתארים את מחיר השוק ומה המשקיעים משלמים לכל דולר של תוצאות עסקיות.")}/>}</p></div>}
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-border p-3"><p className="text-sm text-muted-foreground"><AutoTerms text={t("Market cap", "שווי שוק")}/></p><bdi className="font-mono text-2xl">{money(cap)}</bdi>
        <p className="text-xs text-muted-foreground">{t("Market value of all shares", "שווי השוק של כל המניות")} · <bdi>{date(market?.capDate ?? p.market.asOf)}</bdi></p></div>
      <div className="rounded-xl border border-border p-3"><p className="text-sm text-muted-foreground"><AutoTerms text={t("Share price", "מחיר למניה")}/></p><bdi className="font-mono text-2xl">{isNumber(p.market.price) ? "$" + p.market.price.toFixed(2) : "—"}</bdi>
        <p className="text-xs text-muted-foreground">{t("Cached market data", "נתוני שוק שמורים")} · <bdi>{date(market?.priceDate)}</bdi></p></div>
    </div>
    <div className="grid gap-3 md:grid-cols-3">{rows.map(([key, value, explanation]) =>
      <div key={key} className="rounded-xl border border-border p-3"><h3 className="font-semibold"><AutoTerms text={key}/></h3>
        <bdi className="font-mono text-xl text-primary">{ratio(value)}</bdi><p className="mt-1 text-sm text-muted-foreground"><AutoTerms text={explanation}/></p></div>)}</div>
    {derivedPb !== null && <p className="text-xs text-muted-foreground"><AutoTerms text={t("P/B — calculated from market cap, twelve months of net profit and return on equity (book equity = net profit ÷ return on equity).", "מכפיל הון — חושב משווי השוק, הרווח הנקי ל־12 חודשים והתשואה על ההון העצמי (הון בספרים = רווח נקי ÷ תשואה על ההון העצמי).")}/></p>}
    {computedPe !== null || computedPs !== null ? <p className="text-xs text-muted-foreground">
      {computedPe !== null && "P/E"}{computedPe !== null && computedPs !== null && " · "}{computedPs !== null && "P/S"} — {t("Calculated using cached market cap and twelve months of reported results through", "חושב לפי שווי שוק שמור ותוצאות מדווחות ל־12 חודשים עד")} <bdi>{ttm?.end ?? quarters[quarters.length - 1]?.end}</bdi>.
    </p> : null}
    {pe !== null && computedPe === null && peer && <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm"><AutoTerms text={t("Profitable peer median P/E", "חציון מכפיל הרווח של חברות רווחיות להשוואה")}/> <bdi>{peer.median}</bdi> · <bdi>{peer.group}</bdi> · {peer.n} {t("companies", "חברות")}. {t("A difference can reflect growth, risk or earnings quality.", "פער יכול לשקף צמיחה, סיכון או איכות רווחים.")}</p>}
    <p className="text-xs text-muted-foreground">{hasMultiple
      ? <>{(profitable && market?.pe != null || market?.ps != null || pb !== null) && <>{t("Provider multiples cached on", "מכפילי הספק נשמרו ב־")} <bdi>{date(market?.multiplesDate)}</bdi>. </>}{t("Snapshot dates can differ and quotes may lag.", "מועדי הנתונים עשויים להיות שונים והמחירים עשויים להתעדכן באיחור.")}</>
      : t("No usable multiples in the current market snapshot. A blank figure means the data is unavailable or the ratio is unsuitable.", "אין מכפילים שמישים בתמונת השוק. נתון ריק מציין מידע חסר או מכפיל שאינו מתאים.")}</p>
  </section>;
}

