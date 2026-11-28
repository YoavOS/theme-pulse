import type { LensPayload } from "@/lib/lens/types";
import { comparisonQuarter, isNumber, latestQuarterSummary } from "@/lib/lens/quarterly";
import { ltr } from "@/lib/lens/i18n";

/**
 * "For SYMBOL" lines for terms that have no ready-made Lens metric: built from the company's latest
 * reported quarter (revenue, QoQ/YoY, acceleration, costs, profit, EPS) or its market snapshot.
 * Returns null when the data needed for that term is missing — never a guess.
 */
const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n);
const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;
const per100 = (part: number, whole: number) => `$${((100 * part) / whole).toFixed(1)}`;

export function quarterNote(entryId: string, p: LensPayload, lang: "en" | "he"): string[] | null {
  const he = lang === "he";
  const L = (s: string) => (he ? ltr(s) : s);             // numbers stay left-to-right in Hebrew
  const S = he ? ltr(p.symbol) : p.symbol;
  const q = latestQuarterSummary(p.statements ?? []);
  const last = q.latest;
  const end = last ? L(last.end) : "";
  const rev = last && isNumber(last.revenue) && last.revenue > 0 ? last.revenue : null;

  switch (entryId) {
    case "revenue":
      if (rev === null) return null;
      return [he ? `ההכנסות של ${S} ברבעון שהסתיים ב-${end}: ${L(money(rev))}.` : `${S}'s revenue in the quarter ended ${end}: ${money(rev)}.`,
        ...(isNumber(q.yoy) ? [he ? `שינוי שנתי (מול אותו רבעון אשתקד): ${L(pct(q.yoy))}.` : `Versus the same quarter a year earlier: ${pct(q.yoy)}.`] : [])];
    case "qoq":
      if (!isNumber(q.qoq)) return null;
      return [he ? `ההכנסות של ${S} ברבעון שהסתיים ב-${end} השתנו ב-${L(pct(q.qoq))} מול הרבעון הקודם.` : `${S}'s revenue in the quarter ended ${end} changed ${pct(q.qoq)} from the previous quarter.`,
        ...(isNumber(q.yoy) ? [he ? `לשם השוואה, השינוי השנתי: ${L(pct(q.yoy))}. כשהשניים חלוקים, העונה יכולה להסביר את הפער.` : `For comparison, year over year: ${pct(q.yoy)}. When the two disagree, the season can explain the gap.`] : [])];
    case "yoy":
      if (!isNumber(q.yoy)) return null;
      return [he ? `ההכנסות של ${S} ברבעון שהסתיים ב-${end} השתנו ב-${L(pct(q.yoy))} מול אותו רבעון אשתקד.` : `${S}'s revenue in the quarter ended ${end} changed ${pct(q.yoy)} versus the same quarter a year earlier.`,
        ...(isNumber(q.priorYoy) ? [he ? `ברבעון שלפניו השינוי השנתי היה ${L(pct(q.priorYoy))}.` : `The quarter before, it was ${pct(q.priorYoy)}.`] : [])];
    case "acceleration": {
      if (!isNumber(q.acceleration) || !isNumber(q.yoy) || !isNumber(q.priorYoy)) return null;
      const a = q.acceleration, pts = L(`${Math.abs(a).toFixed(1)}`);
      return [he
        ? `הצמיחה השנתית בהכנסות של ${S} עברה מ-${L(pct(q.priorYoy))} ל-${L(pct(q.yoy))}: ${a >= 0 ? "האצה" : "האטה"} של ${pts} נקודות אחוז.`
        : `${S}'s year-over-year revenue growth went from ${pct(q.priorYoy)} to ${pct(q.yoy)}: ${Math.abs(a).toFixed(1)} percentage points ${a >= 0 ? "faster" : "slower"}.`,
        he ? "רבעון אחד הוא רמז; כדאי לבדוק אם זה חוזר ברבעונים הבאים." : "One quarter is a hint; check whether it repeats in the next ones."];
    }
    case "cost_of_revenue":
      if (rev === null || !isNumber(last?.cost)) return null;
      return [he ? `ברבעון שהסתיים ב-${end}, עלות ההכנסות של ${S} הייתה ${L(money(last!.cost!))} — ${L(per100(last!.cost!, rev))} מכל $100 הכנסות.`
        : `In the quarter ended ${end}, ${S}'s cost of revenue was ${money(last!.cost!)} — ${per100(last!.cost!, rev)} of every $100 of revenue.`];
    case "opex":
      if (rev === null || !isNumber(last?.gross) || !isNumber(last?.operating)) return null;
      return [he ? `ברבעון שהסתיים ב-${end}, הוצאות התפעול של ${S} היו בערך ${L(money(last!.gross! - last!.operating!))} — ${L(per100(last!.gross! - last!.operating!, rev))} מכל $100 הכנסות.`
        : `In the quarter ended ${end}, ${S}'s operating expenses were about ${money(last!.gross! - last!.operating!)} — ${per100(last!.gross! - last!.operating!, rev)} of every $100 of revenue.`];
    case "operating_income": {
      if (!isNumber(last?.operating)) return null;
      const v = last!.operating!, m = rev !== null ? `${(100 * v / rev).toFixed(1)}%` : null;
      return [he ? `${v < 0 ? "ההפסד" : "הרווח"} התפעולי של ${S} ברבעון שהסתיים ב-${end}: ${L(money(v))}${m ? `, ${L(m)} מההכנסות` : ""}.`
        : `${S}'s operating ${v < 0 ? "loss" : "profit"} in the quarter ended ${end}: ${money(v)}${m ? ` (${m} of revenue)` : ""}.`];
    }
    case "net_income": {
      if (!isNumber(last?.net)) return null;
      const v = last!.net!, op = last!.operating;
      const lines = [he ? `${v < 0 ? "ההפסד" : "הרווח"} הנקי של ${S} ברבעון שהסתיים ב-${end}: ${L(money(v))}.` : `${S}'s net ${v < 0 ? "loss" : "profit"} in the quarter ended ${end}: ${money(v)}.`];
      if (isNumber(op) && v > op) lines.push(he ? "הוא גבוה מהרווח התפעולי — כדאי לחפש הטבת מס או רווחים מחוץ לפעילות." : "It's above operating profit — look for a tax benefit or gains outside the business.");
      return lines;
    }
    case "eps": {
      const i = q.rows.length - 1, eps = last?.dilutedEPS;
      if (!isNumber(eps)) return null;
      const prior = comparisonQuarter(q.rows, i, 4)?.dilutedEPS;
      const change = isNumber(prior) && prior > 0 && eps >= 0 ? (eps / prior - 1) * 100 : null;
      return [he ? `הרווח המדולל המדווח למניה של ${S} ברבעון שהסתיים ב-${end}: ${L(`$${eps.toFixed(2)}`)}.` : `${S}'s reported diluted EPS for the quarter ended ${end}: $${eps.toFixed(2)}.`,
        ...(isNumber(prior) ? [he ? `לפני שנה: ${L(`$${prior.toFixed(2)}`)}${change !== null ? ` (${L(pct(change))})` : ""}.` : `A year earlier: $${prior.toFixed(2)}${change !== null ? ` (${pct(change)})` : ""}.`] : [])];
    }
    case "market_cap": {
      const cap = p.market.marketCap;
      if (!isNumber(cap) || cap <= 0) return null;
      const date = (p.marketPricing?.capDate ?? p.market.asOf)?.slice(0, 10);
      return [he ? `שווי השוק של ${S}: ${L(money(cap))}${date ? ` (נכון ל-${L(date)})` : ""}.` : `${S}'s market cap: ${money(cap)}${date ? ` (as of ${date})` : ""}.`];
    }
    case "share_price": {
      const price = p.market.price;
      if (!isNumber(price)) return null;
      return [he ? `המחיר האחרון בנתונים השמורים: ${L(`$${price.toFixed(2)}`)} למניה.` : `Latest price in the cached data: $${price.toFixed(2)} a share.`];
    }
    case "pb": {
      const pb = p.marketPricing?.pb;
      if (!isNumber(pb)) return null;
      return [he ? `מכפיל ההון של ${S}: ${L(`${pb.toFixed(1)}×`)}.` : `${S}'s price to book: ${pb.toFixed(1)}×.`,
        p.financial ? (he ? "בחברה פיננסית כדאי לקרוא אותו יחד עם התשואה על ההון העצמי." : "For a financial company, read it together with return on equity.") : (he ? "בחברה שאינה פיננסית הוא אומר פחות; מכפיל רווח ומכפיל הכנסות שימושיים יותר." : "For a non-financial company it says less; P/E and P/S are usually more useful.")];
    }
    default:
      return null;
  }
}
