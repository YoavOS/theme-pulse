import type { LensPayload } from "@/lib/lens/types";
import type { ProvenRow } from "@/lib/proven/types";
import { valuationFacts, valuationStory } from "@/lib/lens/tabStories";
import { AutoTerms } from "./Term";
import { Panel, SectionHead } from "./LensUI";
import { StoryHero, name, useT } from "./TabHeroes";
import { MarketValuation } from "./CompanyContext";
import { GrowthAsk } from "./LensVisuals";
import PriceStoryCard from "./PriceStoryCard";

/** The Valuation tab: hero, what the price expects (or price-to-book against return on equity for banks), and the multiples. */
export default function ValuationView({ p, proven }: { p: LensPayload; proven: ProvenRow | null }) {
  const { he, t } = useT();
  const story = valuationStory(p, he), f = valuationFacts(p);
  const hasModel = !p.financial && !!p.valuation && f.scenarios.length > 0;
  return (
    <div className="space-y-5">
      <StoryHero eyebrow={`${t("The price, explained", "המחיר, במילים פשוטות")} · ${p.symbol}`} story={story}
        meta={`${name(p)}${p.valuation ? ` · ${t("Cost of capital", "עלות הון")}: ${p.valuation.costOfCapital.toFixed(1)}% (${p.valuation.costOfCapitalSource})` : ""}`}
        asideTitle={t("What is being paid", "מה משלמים")} asideSubtitle={t("The latest market snapshot", "נתוני השוק האחרונים")}
        steps={[
          { label: t("01 · Price", "01 · מחיר"), question: t("What is being paid?", "כמה משלמים?"), target: "val-multiples" },
          { label: t("02 · Expectations", "02 · ציפיות"), question: p.financial ? t("What return does it buy?", "איזו תשואה זה קונה?") : t("What has to happen?", "מה צריך לקרות?"), target: "val-expect" },
          { label: t("03 · Judgment", "03 · שיקול דעת"), question: t("Is the bar high or low?", "האם הרף גבוה או נמוך?"), target: "val-expect" },
        ]} />

      <section className="space-y-3">
        <SectionHead id="val-expect" title={p.financial ? t("Price against return on equity", "המחיר מול התשואה על ההון העצמי") : t("What the price expects", "מה המחיר מצפה")}
          subtitle={p.financial ? t("For banks, Damodaran reads price to book against return on equity and cost of equity.", "בבנקים, דמודרן קורא את מכפיל ההון מול התשואה על ההון העצמי ועלות ההון העצמי.")
            : t("Turn the price into the growth it needs, then compare it with what the company and its industry have done.", "הופכים את המחיר לצמיחה שהוא צריך, ומשווים למה שהחברה והענף עשו.")} />
        {hasModel && <>
          <Panel eyebrow={t("Growth the price needs vs. growth delivered", "הצמיחה שהמחיר צריך מול הצמיחה שהושגה")}><GrowthAsk p={p} /></Panel>
          <PriceStoryCard p={p} proven={proven} wide />
        </>}
        {p.financial && <BankPriceToBook p={p} />}
        {!hasModel && !p.financial && <Panel><p className="text-sm text-muted-foreground"><AutoTerms text={t("The price model needs structured SEC data on capital, debt and margins, which isn't available for this company.", "מודל המחיר צריך נתוני SEC מובנים על הון, חוב ושיעורי רווח, שאינם זמינים לחברה הזו.")} /></p></Panel>}
      </section>

      <section className="space-y-3">
        <SectionHead id="val-multiples" title={t("What investors pay per dollar", "כמה משקיעים משלמים על כל דולר")}
          subtitle={t("Market cap, share price and the multiples — the quick view of the price.", "שווי שוק, מחיר למניה ומכפילים — המבט המהיר על המחיר.")} />
        <MarketValuation p={p} bare />
      </section>
    </div>
  );
}

function BankPriceToBook({ p }: { p: LensPayload }) {
  const { t } = useT();
  const f = valuationFacts(p);
  const rows: [string, string][] = [
    [t("Return on equity", "תשואה על ההון העצמי"), f.roe != null ? `${f.roe.toFixed(1)}%` : "—"],
    [t("Cost of equity (industry)", "עלות ההון העצמי (ענף)"), f.costOfEquity != null ? `${f.costOfEquity.toFixed(1)}%` : "—"],
    [t("Long-run growth (assumed)", "צמיחה לטווח ארוך (הנחה)"), "3.0%"],
    [t("Price to book that return would justify", "מכפיל הון שהתשואה הזו מצדיקה"), f.justifiedPb != null ? `${f.justifiedPb.toFixed(2)}×` : "—"],
    [t("Price to book the market pays", "מכפיל ההון שהשוק משלם"), f.pb != null ? `${f.pb.toFixed(2)}×` : "—"],
  ];
  return (
    <Panel eyebrow={t("A simple yardstick", "מדד פשוט")} title={t("What would the return on equity justify?", "מה התשואה על ההון העצמי מצדיקה?")}>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3 rounded-lg bg-muted/25 px-3 py-2"><dt className="text-muted-foreground"><AutoTerms text={k} /></dt><dd className="font-mono" dir="ltr">{v}</dd></div>)}
      </dl>
      <p className="mt-3 font-mono text-xs text-muted-foreground" dir="ltr">P/B = (ROE − g) ÷ (cost of equity − g)</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground"><AutoTerms text={t("This assumes today's return on equity lasts forever. If competition or credit losses pull it down, the justified price to book falls with it — which is often what a low price to book is saying.",
        "ההנחה היא שהתשואה של היום על ההון העצמי נמשכת לנצח. אם תחרות או הפסדי אשראי יורידו אותה, מכפיל ההון המוצדק יורד איתה — ולעיתים קרובות זה מה שמכפיל הון נמוך אומר.")} /></p>
    </Panel>
  );
}

