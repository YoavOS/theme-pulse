/**
 * One name per idea across the Fundamentals tab. Every text shown through AutoTerms passes through
 * these rules, so labels from the server, saved results, generated stories and the AI text all use the
 * same words. Real metric names that contain another word are protected (Price to sales, Sales to capital).
 *
 * Canonical (EN): revenue (not sales) · operating profit (not operating income) · net profit (not net
 * income) · market cap (not market value / equity market value) · return on invested capital · excess
 * return · sales to capital · stock-based compensation · cost of revenue (not direct costs) · cash runway ·
 * last 12 months.
 * Canonical (HE): הכנסות (not מכירות) · תזרים מזומנים חופשי · מכפיל הון.
 */

type Rule = [RegExp, string | ((m: string, ...g: string[]) => string)];
const keepCase = (src: string, out: string) => (src[0] === src[0].toUpperCase() ? out[0].toUpperCase() + out.slice(1) : out);

// Protected names are swapped out first and restored at the end.
const PROTECT_EN = [/\bprice[- ]to[- ]sales\b/gi, /\bsales[- ]to[- ](invested )?capital\b/gi, /\bsales per \$ capital\b/gi, /\bP\/S\b/g, /\bsales and marketing\b/gi, /\bsales, marketing\b/gi, /\bsales (?:teams?|force|people|staff|reps?|commissions?|channels?)\b/gi, /\bsales,? general\b/gi, /\bsame-store sales\b/gi];
const PROTECT_HE = [/מכפיל (ה)?מכירות/g, /מכירות להון( המושקע)?/g, /מכירות לכל דולר הון/g, /מכירות ושיווק/g, /מכירות, שיווק/g, /מכירות ומטה/g, /(אנשי|צוותי|עמלות) מכירות/g];

const EN: Rule[] = [
  // grammar first: "sales are/were/have/…" → singular "revenue is/was/has/…"
  [/\b(sales)( are| were| have| keep| grow| rise| fall| shrink| stay| remain| need| outgrow| outpace)\b/gi, (m, s, v) => keepCase(s, "revenue") + ({ " are": " is", " were": " was", " have": " has", " keep": " keeps", " grow": " grows", " rise": " rises", " fall": " falls", " shrink": " shrinks", " stay": " stays", " remain": " remains", " need": " needs", " outgrow": " outgrows", " outpace": " outpaces" } as Record<string, string>)[v.toLowerCase()]],
  [/\b(sales)(?= growth| figure| line| base| mix| dollar| per share)/gi, (m) => keepCase(m, "revenue")],
  [/\bof (its |their |each |every |the )?sales\b/gi, (m, d) => `of ${d ?? ""}revenue`],
  [/\b(in|on|from|to|with|than|and|vs|per|times|×|÷) sales\b/gi, (m, p) => `${p} revenue`],
  [/\bsales\b/gi, (m) => keepCase(m, "revenue")],
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
  [/מכירות/g, "הכנסות"],
  [/תזרים חופשי/g, "תזרים מזומנים חופשי"],
  [/תזרים החופשי/g, "תזרים המזומנים החופשי"],
];

function apply(text: string, protect: RegExp[], rules: Rule[]): string {
  const saved: string[] = [];
  let s = text;
  if (protect === PROTECT_EN) s = s.replace(/\bsales to invested capital\b/gi, (m) => keepCase(m, "sales to capital"));
  for (const re of protect) s = s.replace(re, (m) => `\uE000${saved.push(m) - 1}\uE000`);
  for (const [re, to] of rules) s = s.replace(re, to as never);
  return s.replace(/\uE000(\d+)\uE000/g, (_, i) => saved[+i]);
}

export const canonEn = (text: string) => apply(text, PROTECT_EN, EN);
export const canonHe = (text: string) => apply(text, PROTECT_HE, HE);
export const canon = (text: string, lang: "en" | "he") => (lang === "he" ? canonHe(text) : canonEn(text));
