import type { LensPayload } from "@/lib/lens/types";
import type { ProvenRow } from "@/lib/proven/types";
import { useLensLang } from "@/lib/lens/i18n";
import { GLOSSARY } from "@/lib/lens/glossary";
import { bankMeasures, evidenceStory, learnStory, statementsStory, type TabStory } from "@/lib/lens/tabStories";
import { AutoTerms } from "./Term";
import { Hero, Panel, Watch, type Step } from "./LensUI";
import { CHART } from "./QuarterlyChart";

/** Every Lens tab opens like the Company story: a hero with a headline written from the data. */
export function StoryHero({ eyebrow, story, meta, steps, asideTitle, asideSubtitle }: { eyebrow: string; story: TabStory; meta?: string; steps: Step[]; asideTitle: string; asideSubtitle?: string }) {
  return (
    <Hero eyebrow={eyebrow} title={story.title} meta={meta} steps={steps}
      aside={{ title: asideTitle, subtitle: asideSubtitle, items: story.kpis,
        footer: story.footer || story.watch ? <div className="space-y-3">{story.footer && <p><AutoTerms text={story.footer} /></p>}{story.watch && <Watch><AutoTerms text={story.watch} /></Watch>}</div> : undefined }}>
      {story.paras.map((s, i) => <p key={i} className={i === story.paras.length - 1 && story.paras.length > 2 ? "text-muted-foreground" : ""}><AutoTerms text={s} /></p>)}
    </Hero>
  );
}

export const useT = () => { const he = useLensLang() === "he"; return { he, t: (en: string, h: string) => (he ? h : en) }; };
export const name = (p: LensPayload) => p.company ?? p.symbol;

export function StatementsHero({ p }: { p: LensPayload }) {
  const { he, t } = useT();
  const story = statementsStory(p, he);
  const ttm = (p.statements ?? []).find((s) => s.kind === "ttm");
  const bank = p.financial && !!ttm && ttm.nonIntExp != null;
  return <StoryHero eyebrow={`${t("The statements, explained", "הדוחות, במילים פשוטות")} · ${p.symbol}`} story={story}
    meta={`${name(p)} · ${t("Last 12 months to", "12 חודשים עד")} ${ttm?.end ?? "—"} · USD`}
    asideTitle={t("The last twelve months", "12 החודשים האחרונים")} asideSubtitle={t("Each line answers: how much of the sales is left?", "כל שורה עונה: כמה מהמכירות נשאר?")}
    steps={[
      { label: t("01 · Income", "01 · הכנסות"), question: t("Where does each dollar go?", "לאן הולך כל דולר?"), target: "st-flow" },
      bank ? { label: t("02 · Credit", "02 · אשראי"), question: t("How much is set aside for bad loans?", "כמה מופרש להלוואות רעות?"), target: "st-flow" }
        : { label: t("02 · Cash", "02 · מזומן"), question: t("Does profit become cash?", "האם הרווח הופך למזומן?"), target: "st-cash" },
      { label: t("03 · Trends", "03 · מגמות"), question: t("Which lines are changing?", "אילו שורות משתנות?"), target: "st-trends" },
    ]} />;
}

export function EvidenceHero({ p, proven }: { p: LensPayload; proven: ProvenRow | null }) {
  const { he, t } = useT();
  return <StoryHero eyebrow={`${t("The evidence, explained", "הראיות, במילים פשוטות")} · ${p.symbol}`} story={evidenceStory(p, proven, he)}
    meta={`${name(p)} · ${p.damodaran ? `${t("Benchmarks", "השוואה")}: ${p.damodaran.name} (${p.damodaran.asOf})` : t("No industry benchmark", "אין השוואה ענפית")}`}
    asideTitle={t("Returns against the hurdle", "תשואות מול הרף")} asideSubtitle={t("The core of Damodaran's test", "לב המבחן של דמודרן")}
    steps={[
      { label: t("01 · Returns", "01 · תשואות"), question: t("How are the returns earned?", "איך התשואות מושגות?"), target: "blk-read" },
      { label: t("02 · Durability", "02 · עמידות"), question: t("Have they lasted for years?", "האם הן מחזיקות שנים?"), target: "blk-track" },
      { label: t("03 · Comparison", "03 · השוואה"), question: t("How does it compare with its industry?", "איך היא נראית מול הענף?"), target: "blk-industry-bars" },
    ]} />;
}

export function LearnHero({ p, seen, total }: { p: LensPayload; seen: number; total: number }) {
  const { he, t } = useT();
  return <StoryHero eyebrow={`${t("Learn with", "לומדים עם")} ${p.symbol}`} story={learnStory(p, seen, total, GLOSSARY.length, he)}
    meta={`${name(p)}${p.lifeCycle ? ` · ${p.lifeCycle.label}` : ""}`}
    asideTitle={t("Your progress", "ההתקדמות שלך")}
    steps={[
      { label: t("01 · Foundations", "01 · יסודות"), question: t("Value, life cycle, story", "ערך, מחזור חיים, סיפור"), target: "blk-foundations" },
      { label: t("02 · Growth & profit", "02 · צמיחה ורווח"), question: t("Is it growing, and what does it keep?", "האם היא גדלה, ומה נשאר?"), target: "blk-pillar-growth" },
      { label: t("03 · Risk & price", "03 · סיכון ומחיר"), question: t("What could break, and what is priced in?", "מה יכול להישבר, ומה מגולם במחיר?"), target: "blk-pillar-pricing" },
    ]} />;
}

/** Evidence card for banks: efficiency ratio and provisions over the last quarters. */
export function BankMeasuresCard({ p }: { p: LensPayload }) {
  const { t } = useT();
  const b = bankMeasures(p.statements ?? []);
  if (!b) return null;
  const Row = ({ label, k, good }: { label: string; k: "efficiency" | "provisions"; good: "low" }) => {
    const vals = b.series.map((x) => x[k]);
    const max = Math.max(1, ...vals.filter((v): v is number => v != null));
    const now = b.latest[k], ago = b.yearAgo?.[k] ?? null;
    const delta = now != null && ago != null ? now - ago : null;
    const better = delta != null && (good === "low" ? delta < 0 : delta > 0);
    return (
      <div className="rounded-xl bg-muted/25 p-3">
        <div className="flex items-baseline justify-between gap-2 text-sm"><span className="font-medium"><AutoTerms text={label} /></span>
          <span className="font-mono" dir="ltr">{now != null ? `${now.toFixed(1)}%` : "—"}{delta != null && <span className="ms-2 text-xs" style={{ color: better ? CHART.positive : CHART.negative }}>{delta > 0 ? "+" : "−"}{Math.abs(delta).toFixed(1)} pp</span>}</span></div>
        <div className="mt-2 flex h-12 items-end gap-1" dir="ltr" aria-hidden>
          {b.series.map((x) => <div key={x.end} title={`${x.end}: ${x[k]?.toFixed(1) ?? "—"}%`} className="flex-1 rounded-t" style={{ height: `${Math.max(4, ((x[k] ?? 0) / max) * 100)}%`, background: x.end === b.latest.end ? CHART.positive : "hsl(var(--muted-foreground) / 0.35)" }} />)}
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground" dir="ltr"><span>{b.series[0].end.slice(2, 7)}</span><span>{b.latest.end.slice(2, 7)}</span></div>
      </div>
    );
  };
  return (
    <Panel eyebrow={t("Bank measures", "מדדי בנק")} title={t("Lean, and careful with credit?", "רזה, וזהיר באשראי?")}>
      <div className="space-y-3">
        <Row label={t("Efficiency ratio", "יחס יעילות")} k="efficiency" good="low" />
        <Row label={t("Credit-loss provisions as % of revenue", "הפרשות להפסדי אשראי כאחוז מההכנסות")} k="provisions" good="low" />
        <p className="text-xs leading-relaxed text-muted-foreground"><AutoTerms text={t("Change is against the same quarter a year earlier; for both, lower is better. Provisions rise when the bank expects more defaults, so they move with the economy.", "השינוי הוא מול אותו רבעון אשתקד; בשניהם נמוך יותר עדיף. ההפרשות עולות כשהבנק צופה יותר חדלות פירעון, ולכן הן זזות עם הכלכלה.")} /></p>
      </div>
    </Panel>
  );
}
