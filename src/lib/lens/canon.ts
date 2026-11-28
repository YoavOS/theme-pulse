/**
 * One name per idea across the Fundamentals tab. Every text shown through AutoTerms passes through
 * these rules, so labels from the server, saved results, generated stories and the AI text all use the
 * same words. Real metric names that contain another word are protected (Price to sales, Sales to capital).
 *
 * Canonical (EN): revenue (never sale/sales) · operating profit (not operating income) · net profit (not net
 * income) · market cap (not market value / equity market value) · return on invested capital · excess
 * return · sales to capital · stock-based compensation · cost of revenue (not direct costs) · cash runway ·
 * last 12 months.
 * Canonical (HE): הכנסות (never מכירות/מכירה) · תזרים מזומנים חופשי · מכפיל הון.
 */

type Rule = [RegExp, string | ((m: string, ...g: string[]) => string)];
const keepCase = (src: string, out: string) => (src[0] === src[0].toUpperCase() ? out[0].toUpperCase() + out.slice(1) : out);

// "Sale" is never used: every sale/sales becomes revenue, including metric names (Price to revenue, Revenue to
// capital). Where "sales" names the selling function (sales and marketing, sales teams) it becomes "selling".
// Only the abbreviation P/S is kept, because that is how the ratio is quoted everywhere.
const PROTECT_EN = [/\bP\/S\b/g];
const PROTECT_HE: RegExp[] = [];
const VERB: Record<string, string> = { are: "is", were: "was", have: "has", keep: "keeps", grow: "grows", rise: "rises", fall: "falls", shrink: "shrinks", stay: "stays", remain: "remains", need: "needs", outgrow: "outgrows", outpace: "outpaces", accelerate: "accelerates", slow: "slows", drop: "drops", jump: "jumps", climb: "climbs", decline: "declines", increase: "increases", double: "doubles", come: "comes", look: "looks", show: "shows", move: "moves", lag: "lags", beat: "beats", exceed: "exceeds", tend: "tends", do: "does", "don't": "doesn't", "aren't": "isn't", "weren't": "wasn't" };

const EN: Rule[] = [
  [/\bsales,? and marketing\b/gi, (m) => keepCase(m, "selling and marketing")],
  [/\bsales, marketing\b/gi, (m) => keepCase(m, "selling, marketing")],
  [/\bmarketing,? (and )?sales\b/gi, (m, a) => keepCase(m, `marketing, ${a ?? ""}selling`)],
  [/\bsales (reps?|teams?|force|offices?|staff|people|commissions?|channels?|organi[sz]ations?|efforts?|cycles?)\b/gi, (m, w) => keepCase(m, `selling ${w}`)],
  [/\bsales,? general\b/gi, (m) => keepCase(m, "selling, general")],
  [/\bprice[- ]to[- ]sales\b/gi, (m) => keepCase(m, "price to revenue")],
  [/\bsales([- ])to([- ])(?:invested )?capital\b/gi, (m, a, b) => keepCase(m, `revenue${a}to${b}capital`)],
  [/\bsales per \$ capital\b/gi, (m) => keepCase(m, "revenue per $ of capital")],
  [/\b(each|every|per) sale\b/gi, (m, w) => `${w} dollar of revenue`],
  [new RegExp(`\\b(sales) (${Object.keys(VERB).join("|")})\\b`, "gi"), (m, s, v) => `${keepCase(s, "revenue")} ${VERB[v.toLowerCase()]}`],
  [/\bsales?\b/gi, (m) => keepCase(m, "revenue")],
  [/\bequity market value\b/gi, (m) => keepCase(m, "market cap")],
  [/\bmarket value\b/gi, (m) => keepCase(m, "market cap")],
  [/\(TTM(, |\))/g, (m, tail) => `(last 12 months${tail}`],
  [/\bTTM to\b/g, "last 12 months to"],
  [/\b(\w+) TTM\b/g, (m, w) => `${w}, last 12 months`],
  [/\bTTM\b/g, "last 12 months"],
  [/\boperating income\b/gi, (m) => keepCase(m, "operating profit")],
  [/\bnet income\b/gi, (m) => keepCase(m, "net profit")],
  [/\bdirect costs\b/gi, (m) => keepCase(m, "cost of revenue")],
  [/\bstock compensation\b/gi, (m) => keepCase(m, "stock-based compensation")],
  [/\b(?<!cash )runway\b/gi, (m) => keepCase(m, "cash runway")],
  [/\blast twelve months\b/gi, (m) => keepCase(m, "last 12 months")],
  [/\breturn on capital minus cost of capital\b/gi, (m) => keepCase(m, "excess return (return on invested capital minus cost of capital)")],
  [/\breturns? (?:−|-|minus|vs\.?|versus) (?:the )?cost of capital\b/gi, (m) => keepCase(m, "excess return")],
  [/\breturn on capital\b/gi, (m) => keepCase(m, "return on invested capital")],
  [/\bdebt load\b/gi, (m) => keepCase(m, "debt to capital")],
];
const HE: Rule[] = [
  [/\(TTM\)/g, "(12 החודשים האחרונים)"],
  [/\bTTM\b/g, "12 החודשים האחרונים"],
  [/(מכירות|מכירה),? ושיווק|(מכירות|מכירה), שיווק|שיווק,? (ו)?מכירות/g, "שיווק"],
  [/(צוותי|נציגי|משרדי|אנשי|הוצאות) מכיר(ות|ה)/g, "$1 שיווק"],
  [/מכירות ומטה/g, "שיווק ומטה"],
  [/(מ|ב)?כל מכירה/g, (m, p) => `${p ?? ""}כל דולר הכנסות`],
  [/מכירות/g, "הכנסות"],
  [/מכירה(?!ת)/g, "הכנסה"],
  [/תזרים חופשי/g, "תזרים מזומנים חופשי"],
  [/תזרים החופשי/g, "תזרים המזומנים החופשי"],
];

function apply(text: string, protect: RegExp[], rules: Rule[]): string {
  const saved: string[] = [];
  let s = text;
  for (const re of protect) s = s.replace(re, (m) => `\uE000${saved.push(m) - 1}\uE000`);
  for (const [re, to] of rules) s = s.replace(re, to as never);
  return s.replace(/\uE000(\d+)\uE000/g, (_, i) => saved[+i]);
}

export const canonEn = (text: string) => apply(text, PROTECT_EN, EN);
export const canonHe = (text: string) => apply(text, PROTECT_HE, HE);
export const canon = (text: string, lang: "en" | "he") => (lang === "he" ? canonHe(text) : canonEn(text));
