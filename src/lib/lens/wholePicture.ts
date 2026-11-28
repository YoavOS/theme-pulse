import type { LensPayload, Metric } from "@/lib/lens/types";
import { isNumber } from "@/lib/lens/quarterly";
import { businessWords } from "@/lib/lens/businessWords";
import { valuationFacts } from "@/lib/lens/tabStories";

/**
 * "The whole picture": one chain that follows the money through the business, in the company's own
 * words and dollars — what it sells, what making it costs, what running it costs, what reaches the
 * owners and the bank account, the capital behind it, how fast that can grow it, and what the price
 * assumes. Pure; tested in wholePicture.test.ts. Describes; never says buy or sell.
 */

export type Tab = "statements" | "evidence" | "valuation" | "learn";
export interface PictureStep { key: string; title: string; figure: string; caption?: string; text: string; tab: Tab; tone?: "good" | "bad" | "neutral" }
export interface Slice { key: string; label: string; amount: number; per100: number; kind: "cost" | "profit" | "loss" }
export interface Picture { steps: PictureStep[]; per100: Slice[]; summary: string; bank: boolean; lossMaking: boolean }

const money = (n: number | null | undefined) => {
  if (!isNumber(n)) return "—";
  const a = Math.abs(n), [d, u] = a >= 1e12 ? [1e12, "T"] : a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : a >= 1e3 ? [1e3, "K"] : [1, ""];
  const v = a / d, txt = (v >= 100 ? v.toFixed(0) : v.toFixed(1)).replace(/\.0$/, "");
  return `${n < 0 ? "−" : ""}$${txt}${u}`;
};
const pct = (n: number | null | undefined, d = 0) => !isNumber(n) ? "—" : `${n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}%`;
const usd100 = (part: number, whole: number) => `$${Math.round((part / whole) * 100)}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const metric = (p: LensPayload, id: string): Metric | null => [...p.cards, ...p.foundations].flatMap((c) => c.metrics).find((m) => m.id === id) ?? null;
const val = (p: LensPayload, id: string) => { const m = metric(p, id); return m && isNumber(m.value) && !/^n\/[am]$/i.test(m.display) ? (m.value as number) : null; };
const costOfCapital = (p: LensPayload) => {
  const v = p.valuation?.costOfCapital ?? (p.damodaran?.costOfCapital ? parseFloat(p.damodaran.costOfCapital) : NaN);
  return Number.isFinite(v) ? (v as number) : null;
};

export function wholePicture(p: LensPayload, he = false): Picture | null {
  const t = (en: string, h: string) => (he ? h : en);
  const s = (p.statements ?? []).find((x) => x.kind === "ttm");
  if (!s || !isNumber(s.revenue) || s.revenue <= 0) return null;
  const w = businessWords(p, he);
  const name = p.company ?? p.symbol;
  const rev = s.revenue;
  const g = val(p, "rev_growth_ttm");
  const growthClause = g == null ? "" : g >= 0 ? t(` — ${pct(g)} more than the year before`, ` — ${pct(g)} יותר מבשנה שלפניה`) : t(` — ${pct(Math.abs(g))} less than the year before`, ` — ${pct(Math.abs(g))} פחות מבשנה שלפניה`);
  const bank = p.financial && isNumber(s.nonIntExp);
  const steps: PictureStep[] = [];
  const per100: Slice[] = [];
  const net = isNumber(s.net) ? s.net : null;
  const lossMaking = net != null && net < 0;

  if (bank) {
    const nii = s.nii ?? null, nonii = s.nonii ?? null, exp = s.nonIntExp as number, prov = s.provision ?? null, pretax = s.pretax ?? null;
    steps.push({ key: "sells", tab: "statements", title: t("What it earns from", "ממה היא מרוויחה"), figure: money(rev), caption: t("revenue, last 12 months", "הכנסות, 12 חודשים"),
      text: t(`In the last 12 months ${name} earned ${money(rev)} from ${w.sells}${growthClause}${isNumber(nii) && isNumber(nonii) ? `: ${money(nii)} as net interest income — what loans and securities earn minus what it pays on deposits — and ${money(nonii)} from fees and other income` : ""}.`,
        `ב־12 החודשים האחרונים ${name} הרוויחה ${money(rev)} מ${w.sells}${growthClause}${isNumber(nii) && isNumber(nonii) ? `: ${money(nii)} כהכנסות ריבית נטו — מה שההלוואות וניירות הערך מרוויחים פחות מה שהיא משלמת על פיקדונות — ו־${money(nonii)} מעמלות והכנסות אחרות` : ""}.`) });
    steps.push({ key: "running", tab: "statements", title: t("What running the bank costs", "כמה עולה להפעיל את הבנק"), figure: money(exp), caption: t(`${pct((exp / rev) * 100)} of revenue (efficiency ratio)`, `${pct((exp / rev) * 100)} מההכנסות (יחס יעילות)`),
      text: t(`It spent ${money(exp)} on ${w.sga} — ${usd100(exp, rev)} of every $100 it earned. Banks call this the efficiency ratio; lower is leaner.`,
        `היא הוציאה ${money(exp)} על ${w.sga} — ${usd100(exp, rev)} מכל $100 שהרוויחה. בבנקים זה נקרא יחס יעילות; נמוך יותר = רזה יותר.`) });
    per100.push({ key: "exp", label: t("Running costs", "עלויות הפעלה"), amount: exp, per100: (exp / rev) * 100, kind: "cost" });
    if (isNumber(prov)) {
      steps.push({ key: "credit", tab: "statements", title: t("What bad loans cost", "כמה עולות הלוואות רעות"), figure: money(prov), caption: t("credit-loss provisions", "הפרשות להפסדי אשראי"),
        text: t(`It set aside ${money(prov)} for loans that may not be repaid — ${usd100(prov, rev)} of every $100. This rises when the bank expects more customers to default, so it moves with the economy.`,
          `היא הפרישה ${money(prov)} להלוואות שאולי לא יוחזרו — ${usd100(prov, rev)} מכל $100. הסכום עולה כשהבנק צופה שיותר לקוחות לא יעמדו בתשלומים, ולכן הוא זז עם הכלכלה.`) });
      per100.push({ key: "prov", label: t("Bad-loan provisions", "הפרשות להלוואות רעות"), amount: prov, per100: (prov / rev) * 100, kind: "cost" });
    }
    if (isNumber(pretax) && isNumber(net)) per100.push({ key: "tax", label: t("Tax & other", "מס ואחרות"), amount: pretax - net, per100: ((pretax - net) / rev) * 100, kind: "cost" });
  } else {
    const cost = isNumber(s.cost) ? s.cost : isNumber(s.gross) ? rev - s.gross : null;
    const gross = isNumber(s.gross) ? s.gross : cost != null ? rev - cost : null;
    steps.push({ key: "sells", tab: "statements", title: t("What it sells", "מה היא מוכרת"), figure: money(rev), caption: t("revenue, last 12 months", "הכנסות, 12 חודשים"),
      text: t(`In the last 12 months ${name} sold ${money(rev)} of ${w.sells}${growthClause}.`, `ב־12 החודשים האחרונים ${name} מכרה ${w.sells} ב־${money(rev)}${growthClause}.`) });
    if (cost != null && gross != null) {
      steps.push({ key: "making", tab: "statements", title: t("What making it costs", "כמה עולה לייצר"), figure: money(cost), caption: t(`cost of revenue · ${usd100(cost, rev)} of every $100`, `עלות ההכנסות · ${usd100(cost, rev)} מכל $100`),
        text: t(`${cap(w.cost)} cost ${money(cost)} — ${usd100(cost, rev)} of every $100 of revenue. That leaves ${money(gross)} of gross profit (${usd100(gross, rev)} of every $100): the room it has to pay for everything else.`,
          `${cap(w.cost)} עלו ${money(cost)} — ${usd100(cost, rev)} מכל $100 הכנסות. נשאר רווח גולמי של ${money(gross)} (${usd100(gross, rev)} מכל $100): המרווח שממנו היא משלמת על כל השאר.`) });
      per100.push({ key: "cost", label: t("Making it", "ייצור"), amount: cost, per100: (cost / rev) * 100, kind: "cost" });
    }
    const op = isNumber(s.operating) ? s.operating : null;
    if (gross != null && op != null) {
      const rnd = isNumber(s.rnd) ? s.rnd : null, sga = isNumber(s.sga) ? s.sga : null;
      const other = gross - op - (rnd ?? 0) - (sga ?? 0);
      const parts = [rnd ? t(`${money(rnd)} on ${w.rnd}`, `${money(rnd)} על ${w.rnd}`) : null, sga ? t(`${money(sga)} on ${w.sga}`, `${money(sga)} על ${w.sga}`) : null,
        Math.abs(other) > rev * 0.01 ? t(`${money(other)} on other operating costs`, `${money(other)} על עלויות תפעול אחרות`) : null].filter(Boolean) as string[];
      const listed = parts.length > 1 ? `${parts.slice(0, -1).join(", ")}${he ? " ו" : " and "}${parts.at(-1)}` : parts[0] ?? t(`${money(gross - op)} on running the company`, `${money(gross - op)} על הפעלת החברה`);
      steps.push({ key: "running", tab: "statements", title: t("What running the company costs", "כמה עולה להפעיל את החברה"), figure: money(gross - op), caption: t(`operating expenses · ${usd100(gross - op, rev)} of every $100`, `הוצאות תפעול · ${usd100(gross - op, rev)} מכל $100`),
        text: op >= 0
          ? t(`It spent ${listed}. What's left is ${money(op)} of operating profit — ${usd100(op, rev)} of every $100.`, `היא הוציאה ${listed}. נשאר רווח תפעולי של ${money(op)} — ${usd100(op, rev)} מכל $100.`)
          : t(`It spent ${listed} — more than its gross profit, so the business ran at an operating loss of ${money(Math.abs(op))} (${usd100(Math.abs(op), rev)} for every $100 of revenue).`, `היא הוציאה ${listed} — יותר מהרווח הגולמי, ולכן העסק פעל בהפסד תפעולי של ${money(Math.abs(op))} (${usd100(Math.abs(op), rev)} על כל $100 הכנסות).`),
        tone: op >= 0 ? "neutral" : "bad" });
      if (rnd) per100.push({ key: "rnd", label: t("R&D", "מו\"פ"), amount: rnd, per100: (rnd / rev) * 100, kind: "cost" });
      if (sga) per100.push({ key: "sga", label: t("Selling & admin", "שיווק ומטה"), amount: sga, per100: (sga / rev) * 100, kind: "cost" });
      if (other > rev * 0.01) per100.push({ key: "other", label: t("Other operating", "תפעול אחר"), amount: other, per100: (other / rev) * 100, kind: "cost" });
      if (net != null && op - net > 0) per100.push({ key: "tax", label: t("Tax & other", "מס ואחרות"), amount: op - net, per100: ((op - net) / rev) * 100, kind: "cost" });
    }
  }
  if (net != null) per100.push({ key: "net", label: net >= 0 ? t("Net profit", "רווח נקי") : t("Net loss", "הפסד נקי"), amount: Math.abs(net), per100: (Math.abs(net) / rev) * 100, kind: net >= 0 ? "profit" : "loss" });

  // owners & cash
  const ocf = isNumber(s.ocf) ? s.ocf : null, capex = isNumber(s.capex) ? Math.abs(s.capex) : null;
  const fcf = ocf != null && capex != null ? ocf - capex : null;
  if (net != null) {
    const cash = bank ? "" : fcf != null
      ? t(` In cash, the business brought in ${money(ocf)} and spent ${money(capex)} on ${w.capex}, leaving ${money(fcf)} of free cash flow${fcf < 0 ? " — it needed outside money or savings to cover the gap" : ""}.`,
        ` במזומן העסק הכניס ${money(ocf)} והוציא ${money(capex)} על ${w.capex}, ונשאר תזרים מזומנים חופשי של ${money(fcf)}${fcf < 0 ? " — היא נזקקה לכסף מבחוץ או לחסכונות כדי לכסות את הפער" : ""}.`)
      : "";
    const sbc = !bank && isNumber(s.sbc) && s.sbc > rev * 0.02 ? t(` Part of its pay was in shares, worth ${money(s.sbc)} — a real cost to owners even though no cash left.`, ` חלק מהשכר שולם במניות, בשווי ${money(s.sbc)} — עלות אמיתית לבעלים גם אם לא יצא מזומן.`) : "";
    steps.push({ key: "owners", tab: "statements", title: t("What reaches the owners", "מה מגיע לבעלים"), figure: money(net), caption: net >= 0 ? t(`net profit · ${usd100(net, rev)} of every $100`, `רווח נקי · ${usd100(net, rev)} מכל $100`) : t("net loss", "הפסד נקי"),
      text: (net >= 0 ? t(`After interest, tax and other items, ${money(net)} is net profit — ${usd100(net, rev)} of every $100.`, `אחרי ריבית, מס וסעיפים אחרים, ${money(net)} הם רווח נקי — ${usd100(net, rev)} מכל $100.`)
        : t(`After everything, it lost ${money(Math.abs(net))}.`, `אחרי הכול, היא הפסידה ${money(Math.abs(net))}.`)) + cash + sbc,
      tone: net >= 0 ? "good" : "bad" });
  }

  // the capital behind it
  const coc = bank ? (p.damodaran?.costOfEquity ? parseFloat(p.damodaran.costOfEquity) : null) : costOfCapital(p);
  const roic = bank ? val(p, "roe") : val(p, "roic");
  const s2c = val(p, "sales_to_capital");
  const ic = !bank && s2c && s2c > 0 ? rev / s2c : null;
  if (roic != null) {
    const beats = coc != null ? roic - coc : null;
    const verdict = beats == null ? "" : beats > 2
      ? t(` That is more than the roughly ${pct(coc)} its money costs, so each dollar it invests creates value.`, ` זה יותר מכ־${pct(coc)} שהכסף שלה עולה, ולכן כל דולר שהיא משקיעה יוצר ערך.`)
      : beats < -2 ? t(` That is less than the roughly ${pct(coc)} its money costs, so growing on these terms destroys value.`, ` זה פחות מכ־${pct(coc)} שהכסף שלה עולה, ולכן צמיחה בתנאים האלה הורסת ערך.`)
      : t(` That is about what its money costs (~${pct(coc)}), so growth adds little value.`, ` זה בערך מה שהכסף שלה עולה (כ־${pct(coc)}), ולכן צמיחה מוסיפה מעט ערך.`);
    steps.push({ key: "capital", tab: "evidence", title: t("The capital behind it", "ההון שמאחורי זה"), figure: pct(roic), caption: bank ? t("return on equity", "תשואה על ההון העצמי") : t("return on invested capital", "תשואה על ההון המושקע"),
      text: (bank
        ? t(`A bank runs on its owners' equity. ${name} earns ${pct(roic, 1)} a year on it.`, `בנק פועל על ההון העצמי של בעליו. ${name} מרוויחה עליו ${pct(roic, 1)} בשנה.`)
        : t(`To earn this it ties up${ic ? ` about ${money(ic)} of` : ""} capital in ${w.capital}.${s2c ? ` Each $1 of it brings $${s2c.toFixed(2)} of revenue,` : ""} and it earns ${pct(roic, 1)} a year on it.`,
          `כדי להרוויח את זה היא קושרת${ic ? ` כ־${money(ic)}` : ""} הון ב${w.capital}.${s2c ? ` כל $1 ממנו מביא $${s2c.toFixed(2)} הכנסות,` : ""} והיא מרוויחה עליו ${pct(roic, 1)} בשנה.`)) + verdict,
      tone: beats == null ? "neutral" : beats > 2 ? "good" : beats < -2 ? "bad" : "neutral" });
  }

  // how fast this can grow it
  const rr = val(p, "reinvestment_rate"), cagr = val(p, "rev_cagr_3y");
  if (!bank && rr != null && roic != null && rr > 0 && roic > 0) {
    const fg = (rr / 100) * roic;
    steps.push({ key: "growth", tab: "evidence", title: t("How fast this can grow it", "כמה מהר זה יכול להצמיח אותה"), figure: fg > 100 ? ">100%" : pct(fg), caption: t("growth the reinvestment supports", "צמיחה שההשקעה החוזרת תומכת בה"),
      text: t(`It puts ${pct(rr)} of its after-tax operating profit back into the business. At a ${pct(roic)} return, that supports ${fg > 100 ? "more than 100" : `about ${fg.toFixed(0)}`}% growth a year (reinvestment rate × return on invested capital)${cagr != null ? `; revenue actually grew ${pct(cagr)} a year over the last three years` : ""}. Returns this high rarely last, so expect this to slow.`,
        `היא מחזירה לעסק ${pct(rr)} מהרווח התפעולי אחרי מס. בתשואה של ${pct(roic)}, זה תומך בצמיחה של ${fg > 100 ? "יותר מ־100" : `כ־${fg.toFixed(0)}`}% בשנה (שיעור ההשקעה החוזרת × התשואה על ההון המושקע)${cagr != null ? `; בפועל ההכנסות צמחו ${pct(cagr)} בשנה בשלוש השנים האחרונות` : ""}. תשואות כאלה גבוהות לרוב לא מחזיקות, אז סביר שזה יאט.`).replace(/ Returns this high rarely last, so expect this to slow\.| תשואות כאלה גבוהות לרוב לא מחזיקות, אז סביר שזה יאט\./, roic > 40 ? "$&" : "") });
  }

  // what the price assumes
  const f = valuationFacts(p);
  const mcap = p.market.marketCap ?? p.valuation?.marketCap ?? null;
  if (isNumber(mcap)) {
    const im = !bank ? f.scenarios.find((x) => x.id === "cautious")?.implied : undefined;
    const need = im?.kind === "ok" ? im.growth : null;
    const multiple = bank ? (f.pb != null ? t(`${f.pb.toFixed(1)}× its book value`, `פי ${f.pb.toFixed(1)} מההון בספרים`) : null) : f.pe != null && net && net > 0 ? t(`${f.pe.toFixed(0)}× its net profit`, `פי ${f.pe.toFixed(0)} מהרווח הנקי`) : f.ps != null ? t(`${f.ps.toFixed(f.ps < 1 ? 2 : 1)}× its revenue`, `פי ${f.ps.toFixed(f.ps < 1 ? 2 : 1)} מההכנסות`) : null;
    steps.push({ key: "price", tab: "valuation", title: t("What the price assumes", "מה המחיר מניח"), figure: money(mcap), caption: t("market cap", "שווי שוק"),
      text: t(`The market values ${name} at ${money(mcap)}${multiple ? ` — ${multiple}` : ""}.`, `השוק מעריך את ${name} ב־${money(mcap)}${multiple ? ` — ${multiple}` : ""}.`)
        + (need != null ? t(` At today's margins the price needs about ${pct(need)} revenue growth a year for five years${cagr != null ? `, against ${pct(cagr)} a year over the last three` : ""}.`, ` במרווחים של היום המחיר דורש כ־${pct(need)} צמיחה בהכנסות בשנה לחמש שנים${cagr != null ? `, מול ${pct(cagr)} בשנה בשלוש האחרונות` : ""}.`)
          : bank && f.justifiedPb != null ? t(` Its return on equity would justify about ${f.justifiedPb.toFixed(1)}× book value.`, ` התשואה על ההון העצמי שלה מצדיקה בערך פי ${f.justifiedPb.toFixed(1)} מההון בספרים.`) : "") });
  }

  // one line
  const st = steps.find((x) => x.key === "capital");
  const quality = st?.tone === "good" ? t("earns well above what its money costs", "מרוויחה הרבה יותר ממה שהכסף שלה עולה") : st?.tone === "bad" ? t("earns less than its money costs", "מרוויחה פחות ממה שהכסף שלה עולה") : st ? t("earns about what its money costs", "מרוויחה בערך מה שהכסף שלה עולה") : null;
  const pace = g == null ? null : g >= 25 ? t("growing fast", "צומחת מהר") : g >= 8 ? t("growing steadily", "צומחת בקצב יציב") : g >= 0 ? t("growing slowly", "צומחת לאט") : t("shrinking", "מצטמקת");
  const price = steps.find((x) => x.key === "price");
  const im = !bank ? f.scenarios.find((x) => x.id === "cautious")?.implied : undefined;
  const priced = im?.kind === "ok" && cagr != null ? (im.growth > cagr * 1.2 ? t("priced for more growth than it has delivered", "מתומחרת לצמיחה גבוהה ממה שסיפקה") : im.growth < cagr * 0.8 ? t("priced for less growth than it has delivered", "מתומחרת לצמיחה נמוכה ממה שסיפקה") : t("priced for about the growth it has delivered", "מתומחרת בערך לצמיחה שסיפקה")) : null;
  const bits = [lossMaking ? t("loses money", "מפסידה כסף") : quality, pace, price ? priced : null].filter(Boolean);
  const summary = bits.length ? t(`In one line: ${name} ${bits.join(", ")}.`, `בשורה אחת: ${name} ${bits.join(", ")}.`) : "";
  return { steps, per100, summary, bank: !!bank, lossMaking };
}

/** One sentence per income-flow step, in the company's words and dollars (used by the flow map's hover card). */
export function flowStepNote(p: LensPayload, step: "revenue" | "cost" | "gross" | "opex" | "operating" | "taxother" | "net", amount: number | null, revenue: number | null, he = false): string | null {
  if (!isNumber(amount) || !isNumber(revenue) || revenue <= 0) return null;
  const w = businessWords(p, he), name = p.company ?? p.symbol, t = (en: string, h: string) => (he ? h : en);
  const of100 = usd100(Math.abs(amount), revenue);
  switch (step) {
    case "revenue": return t(`What ${name} sold: ${money(amount)} of ${w.sells}.`, `מה ש־${name} מכרה: ${w.sells} ב־${money(amount)}.`);
    case "cost": return t(`${cap(w.cost)}: ${money(amount)}, or ${of100} of every $100 of revenue.`, `${cap(w.cost)}: ${money(amount)}, כלומר ${of100} מכל $100 הכנסות.`);
    case "gross": return t(`What's left after making what it sells: ${of100} of every $100, to pay for ${w.rnd}, ${w.sga}, and profit.`, `מה שנשאר אחרי ייצור מה שהיא מוכרת: ${of100} מכל $100, כדי לממן ${w.rnd}, ${w.sga} ורווח.`);
    case "opex": return t(`Running the company — ${w.rnd} and ${w.sga}: ${money(amount)}, ${of100} of every $100.`, `הפעלת החברה — ${w.rnd} ו${w.sga}: ${money(amount)}, ${of100} מכל $100.`);
    case "operating": return amount >= 0 ? t(`What the business itself earned before interest and tax: ${of100} of every $100.`, `מה שהעסק עצמו הרוויח לפני ריבית ומס: ${of100} מכל $100.`) : t(`The business lost ${of100} for every $100 it sold before interest and tax.`, `העסק הפסיד ${of100} על כל $100 שמכר, לפני ריבית ומס.`);
    case "taxother": return amount >= 0 ? t(`Mostly income tax, plus interest and other items: ${money(amount)}.`, `בעיקר מס הכנסה, ועוד ריבית וסעיפים אחרים: ${money(amount)}.`) : t(`Other income (such as interest on its cash) added ${money(Math.abs(amount))} after tax.`, `הכנסות אחרות (כמו ריבית על המזומנים שלה) הוסיפו ${money(Math.abs(amount))} אחרי מס.`);
    case "net": return amount >= 0 ? t(`What belongs to the owners: ${of100} of every $100 of revenue.`, `מה ששייך לבעלים: ${of100} מכל $100 הכנסות.`) : t(`After everything, a loss of ${money(Math.abs(amount))}.`, `אחרי הכול, הפסד של ${money(Math.abs(amount))}.`);
  }
}
