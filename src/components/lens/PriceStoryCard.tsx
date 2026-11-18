import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { LensPayload } from "@/lib/lens/types";
import type { ProvenRow } from "@/lib/proven/types";
import { buildScenarios, demandVsHistory, impliedGrowth, returnOnNewCapital, sizeMultiple, type Implied, type Scenario, type Story } from "@/lib/lens/valuation";
import { AutoTerms, Term } from "./Term";
import { ltr, useLensLang } from "@/lib/lens/i18n";
import { HE_SCENARIO_NAME, heScenarioPlain } from "@/lib/lens/he/price";
import { GrowthAsk } from "./LensVisuals";

// "What the price is betting on" — written for someone new to fundamentals. The app builds the stories
// (from the company's own numbers and its industry's averages) and explains them; experimenting with the
// levers is optional and tucked away.

const usd = (v: number) => { const a = Math.abs(v); return `${v < 0 ? "−" : ""}$${a >= 1e12 ? (a / 1e12).toFixed(2) + "T" : a >= 1e9 ? (a / 1e9).toFixed(1) + "B" : (a / 1e6).toFixed(0) + "M"}`; };
const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`);
const RISK_FREE = 4.2;   // app assumption: US 10-year Treasury yield, late 2026
const TRILLION_POST = "https://aswathdamodaran.substack.com/p/trillion-dollar-market-caps-fairy";
const PARADOX_POST = "https://aswathdamodaran.blogspot.com/2017/03/explaining-paradox-why-good-bad.html";
const MCKINSEY = "https://www.mckinsey.com/capabilities/strategy-and-corporate-finance/our-insights/balancing-roic-and-growth-to-build-value";

// ── wording that stays right when sales are shrinking (negative growth) ──
const abs0 = (g: number) => Math.abs(g).toFixed(0);
/** what the price assumes about sales, as a phrase: "sales grow about 7% a year" / "sales shrink about 7% a year" */
function salesPath(g: number, he: boolean): string {
  if (Math.abs(g) < 0.5) return he ? "מכירות בערך יציבות" : "about flat sales";
  return g > 0 ? (he ? `צמיחה של כ-${ltr(abs0(g) + "%")} במכירות בשנה` : `sales growing about ${abs0(g)}% a year`)
    : (he ? `ירידה של כ-${ltr(abs0(g) + "%")} במכירות בשנה` : `sales shrinking about ${abs0(g)}% a year`);
}
/** what it has done: "grew 9% a year" / "shrank 11% a year" */
function pastPath(g: number, he: boolean): string {
  if (Math.abs(g) < 0.5) return he ? "שמרה על מכירות יציבות" : "kept sales about flat";
  return g > 0 ? (he ? `צמחה בכ-${ltr(abs0(g) + "%")}` : `grew about ${abs0(g)}%`) : (he ? `התכווצה בכ-${ltr(abs0(g) + "%")}` : `shrank about ${abs0(g)}%`);
}
/** size in 10 years: "about 2.5× today's size" / "about 30% smaller than today" */
function sizePhrase(mult: number, he: boolean): string {
  if (mult >= 1.05) return he ? `גדולה בערך פי ${ltr(mult.toFixed(1))} מהיום` : `about ${mult.toFixed(1)}× today's size`;
  if (mult > 0.95) return he ? "בערך באותו גודל כמו היום" : "about the same size as today";
  return he ? `קטנה בכ-${ltr(Math.round((1 - mult) * 100) + "%")} מהיום` : `about ${Math.round((1 - mult) * 100)}% smaller than today`;
}
/** how the price's assumption compares with the record, in words that work for growth and decline */
function versusPast(g: number, past: number, he: boolean): string {
  const d = g - past;
  if (Math.abs(d) <= 5) return he ? "בערך מה שהיא עושה עד עכשיו" : "about what it has been doing";
  if (d < 0) return g < 0 ? (he ? "ירידה מהירה יותר משהייתה — רף נמוך" : "a faster decline than it has had — a low bar") : (he ? "פחות צמיחה ממה שהיא מספקת" : "less growth than it has been delivering");
  if (past < 0 && g < 0) return he ? "שהירידה תואט" : "the decline to slow down";
  if (past < 0) return he ? "מהפך — ממכירות יורדות לצמיחה" : "a turnaround — from shrinking sales to growth";
  return he ? "יותר צמיחה ממה שהיא מספקת" : "more growth than it has been delivering";
}

type Tone = "good" | "mid" | "hard";
const TONE_CLS: Record<Tone, string> = {
  good: "border-[hsl(199,85%,60%)]/50 bg-[hsl(199,85%,60%)]/12 text-[hsl(199,85%,72%)]",
  mid: "border-[hsl(40,90%,58%)]/50 bg-[hsl(40,90%,58%)]/12 text-[hsl(40,95%,70%)]",
  hard: "border-[hsl(25,90%,58%)]/55 bg-[hsl(25,90%,58%)]/12 text-[hsl(25,95%,68%)]",
};
const Chip = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => <span className={`shrink-0 rounded border px-1.5 py-px text-[10.5px] font-semibold ${TONE_CLS[tone]}`}>{children}</span>;

type Biz = "good" | "unproven" | "weak";
type Ask = "less" | "same" | "more";
const bizOf = (label: string | null | undefined): Biz | null =>
  !label ? null : ["elite", "proven", "proven_caveat"].includes(label) ? "good" : ["provisional", "emerging", "fading", "was_strong"].includes(label) ? "unproven" : "weak";
const CELL: Record<Biz, Record<Ask, string>> = {
  good: {
    less: "A good business whose price asks for less than it has been doing — the corner of his matrix where business quality and price line up best (he'd still ask whether management is acting its age).",
    same: "A good business priced for more of the same. Owners would earn roughly what the business earns — no bargain, no bubble.",
    more: "What he calls \"admire, but don't buy\": a great business whose price already asks for more than it has delivered.",
  },
  unproven: {
    less: "The price asks for less than the business has been doing, but its record is short or slipping — the story still has to be proven.",
    same: "Priced for the story continuing. Fine if it does; the record to back it isn't there yet.",
    more: "Priced for a big story with no proven record yet — where hopes and results can part ways most sharply.",
  },
  weak: {
    less: "A weak business priced low. His matrix allows that a weak business can be a good investment at the right price — but something has to change.",
    same: "A business that hasn't earned its cost of capital, priced as if that's fine — the wrong side of the trade for an owner, in his matrix.",
    more: "A business that hasn't earned its cost of capital, priced for growth — the worst corner of his matrix: growth at these returns destroys value.",
  },
};

const CELL_HE: Record<Biz, Record<Ask, string>> = {
  good: {
    less: "עסק טוב שהמחיר שלו מבקש פחות ממה שהוא עושה — הפינה במטריצה שלו שבה איכות העסק והמחיר מתיישבים הכי טוב (הוא עדיין היה שואל אם ההנהלה מתנהגת בהתאם לגיל החברה).",
    same: "עסק טוב שמתומחר להמשך של אותו דבר. הבעלים ירוויחו בערך את מה שהעסק מרוויח — לא מציאה, לא בועה.",
    more: "מה שהוא מכנה \"להעריץ, אבל לא לקנות\": עסק נהדר שהמחיר שלו כבר מבקש יותר ממה שהוא סיפק.",
  },
  unproven: {
    less: "המחיר מבקש פחות ממה שהעסק עושה, אבל הרקורד שלו קצר או נשחק — הסיפור עוד צריך להוכיח את עצמו.",
    same: "מתומחר להמשך הסיפור. בסדר אם הוא יימשך; הרקורד שיגבה אותו עוד לא קיים.",
    more: "מתומחר לסיפור גדול בלי רקורד מוכח — המקום שבו תקוות ותוצאות יכולות להיפרד בצורה החדה ביותר.",
  },
  weak: {
    less: "עסק חלש שמתומחר נמוך. המטריצה שלו מאפשרת שעסק חלש יהיה השקעה טובה במחיר הנכון — אבל משהו צריך להשתנות.",
    same: "עסק שלא הרוויח את עלות ההון שלו, מתומחר כאילו זה בסדר — הצד הלא נכון של העסקה לבעלים, לפי המטריצה שלו.",
    more: "עסק שלא הרוויח את עלות ההון שלו, מתומחר לצמיחה — הפינה הגרועה ביותר במטריצה שלו: צמיחה בתשואות כאלה הורסת ערך.",
  },
};

/** One plain line for a scenario's answer. */
function answerText(im: Implied, past: number | null, he = false): { text: string; tone: Tone } {
  if (im.kind === "growth_destroys") return { text: he ? "צמיחה לא תביא אותה לשם" : "growth can't get it there", tone: "hard" };
  if (im.kind === "beyond") return { text: he ? "צריכה יותר מכל צמיחה מציאותית" : "needs more than any realistic growth", tone: "hard" };
  if (im.kind === "shrink") return { text: he ? "המחיר הגיוני גם אם המכירות יתכווצו" : "the price makes sense even if sales shrink", tone: "good" };
  const d = demandVsHistory(im.growth, past);
  const tone: Tone = d === "less" || d === "same" ? "good" : d === "more" ? "mid" : d === "much_more" ? "hard" : im.growth <= 15 ? "mid" : "hard";
  if (im.growth < -0.5) return { text: he ? `הגיוני גם עם ירידה של כ-${ltr(abs0(im.growth) + "%")} בשנה` : `works even if sales shrink ~${abs0(im.growth)}% a year`, tone };
  return { text: he ? `צריכה ${salesPath(im.growth, true)}` : `needs ${salesPath(im.growth, false)}`, tone };
}

function Slider({ label, plain, value, min, max, step, unit, onChange, hint }: { label: string; plain: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; hint?: string }) {
  return (
    <label className="block space-y-0.5">
      <div className="flex justify-between text-[11.5px]"><span className="font-medium">{label}</span><span className="font-mono tabular-nums" dir="ltr">{value.toFixed(step < 1 ? 1 : 0)}{unit}</span></div>
      <div className="text-[10.5px] text-muted-foreground"><AutoTerms text={plain} /></div>
      <input type="range" dir="ltr" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[hsl(var(--primary))]" />
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </label>
  );
}

export default function PriceStoryCard({ p, proven, wide = false }: { p: LensPayload; proven: ProvenRow | null; /** lay the sections side by side (wide screens) */ wide?: boolean }) {
  const v = p.valuation;
  const he = useLensLang() === "he";
  const [open, setOpen] = useState(true);
  const [learn, setLearn] = useState(false);
  const [detail, setDetail] = useState(false);   // the longer explanations stay folded until asked for
  const [lab, setLab] = useState(false);
  const ev = v ? Math.max(1, v.marketCap + v.debt - v.cash) : 1;
  const scenarios = useMemo<Scenario[]>(() => (v ? buildScenarios(v, ev, RISK_FREE) : []), [v, ev]);
  const typical = scenarios.find((s) => s.id === "typical");
  // optional experiment — starts from the typical story
  const [margin, setMargin] = useState<number | null>(null);
  const [s2c, setS2c] = useState<number | null>(null);
  const [wacc, setWacc] = useState<number | null>(null);
  const labStory = useMemo<Story | null>(() => (typical ? { ...typical.story, targetMargin: margin ?? typical.story.targetMargin, salesToCapital: s2c ?? typical.story.salesToCapital, costOfCapital: wacc ?? typical.story.costOfCapital } : null), [typical, margin, s2c, wacc]);
  const labRes = useMemo(() => (labStory ? impliedGrowth(labStory, ev) : null), [labStory, ev]);
  if (!v || !typical) return null;

  const S = he ? ltr(p.symbol) : p.symbol;
  const U = (x: number) => (he ? ltr(usd(x)) : usd(x));
  const P = (x: number | null | undefined, d = 0) => (he ? ltr(pct(x, d)) : pct(x, d));
  const past = v.pastGrowth3y ?? v.pastGrowth1y;
  const pastWhen = he ? (v.pastGrowth3y !== null ? "בשנה, בממוצע על פני שלוש השנים האחרונות" : "בשנה האחרונה") : v.pastGrowth3y !== null ? "a year over the last three years" : "last year";
  const im = typical.implied;
  const mult = sizeMultiple(im, v.revenue);
  const marginJump = typical.story.targetMargin - v.opMargin;
  const cautious = scenarios.find((s) => s.id === "cautious")!;
  const roNewToday = returnOnNewCapital(cautious.story);

  // what the price asks of the business, against what it has shown: growth AND profitability
  const gAsk = im.kind === "ok" ? demandVsHistory(im.growth, past) : null;
  const marginAsk = marginJump > 15 ? 2 : marginJump > 5 ? 1 : 0;   // judgement: pp of operating margin it must add
  const growthLevel = gAsk === "less" ? 0 : gAsk === "same" ? 1 : gAsk === "more" ? 2 : gAsk === "much_more" ? 3 : null;
  const askLevel = growthLevel === null ? null : Math.max(growthLevel, growthLevel + marginAsk >= 2 ? 2 : growthLevel + marginAsk);

  // ── the price in one sentence ──
  let headline: React.ReactNode;
  if (he) {
    if (im.kind === "ok") {
      const d = gAsk;
      headline = (
        <>במחיר של {U(ev)}, המחיר מניח <b>{salesPath(im.growth, true)}</b> בחמש השנים הבאות
          {marginJump > 1 ? <>, ובמקביל שהיא תהפוך לרווחית כמו החברה הממוצעת בענף שלה (רווח תפעולי של {P(typical.story.targetMargin)} מהמכירות, לעומת {P(v.opMargin)} היום)</> : null}.
          {mult ? <> בעוד 10 שנים היא תהיה {sizePhrase(mult, true)}.</> : null}
          {past !== null && <> עד עכשיו היא {pastPath(past, true)} {pastWhen} — כלומר המחיר מצפה ל{versusPast(im.growth, past, true)}{marginAsk === 2 ? <>, אבל גם ל<b>שיעור רווח גבוה בהרבה ממה שהראתה</b> — זה ההימור האמיתי</> : marginAsk === 1 ? <>, ובנוסף לשיעור רווח גבוה מזה של היום</> : null}.</>}</>
      );
    } else if (im.kind === "growth_destroys") {
      headline = <>גם אם {S} תהפוך לרווחית כמו הענף שלה, כל דולר חדש שהיא משקיעה ירוויח פחות ממה שהוא עולה — כך שצמיחה לא יכולה להסביר את המחיר של {U(ev)}. המחיר מהמר על עסק רווחי הרבה יותר מהממוצע בענף שלה.</>;
    } else if (im.kind === "beyond") {
      headline = <>אפילו צמיחה מהירה מאוד לא מגיעה למחיר של {U(ev)} עם סיפור טיפוסי. המחיר מניח ש-{S} תהפוך לרווחית הרבה יותר או לגדולה הרבה יותר מחברה ממוצעת בענף שלה.</>;
    } else {
      headline = <>המחיר של {U(ev)} עבור {S} היה הגיוני גם אם המכירות שלה היו מתכווצות. השוק מצפה ממנה למעט.</>;
    }
  } else if (im.kind === "ok") {
    const d = gAsk;
    headline = (
      <>At {usd(ev)}, the price assumes <b>{salesPath(im.growth, false)}</b> for the next five years
        {marginJump > 1 ? <>, while {S} becomes as profitable as the average company in its industry ({pct(typical.story.targetMargin)} of sales kept as operating profit, vs {pct(v.opMargin)} today)</> : null}.
        {mult ? <> In 10 years it would be {sizePhrase(mult, false)}.</> : null}
        {past !== null && <> So far it {pastPath(past, false)} {pastWhen} — so the price expects {versusPast(im.growth, past, false)}{marginAsk === 2 ? <>, but also a <b>much higher profit margin than it has shown</b> — that's the real bet</> : marginAsk === 1 ? <>, plus a higher profit margin than today's</> : null}.</>}</>
    );
  } else if (im.kind === "growth_destroys") {
    headline = <>Even if {S} becomes as profitable as its industry, each new dollar it invests would earn less than it costs — so growth can't explain its {usd(ev)} price. The price is betting on a much more profitable business than its industry's average.</>;
  } else if (im.kind === "beyond") {
    headline = <>Even very fast growth doesn't reach its {usd(ev)} price with a typical story. The price assumes {S} becomes far more profitable or far bigger than an average company in its industry.</>;
  } else {
    headline = <>{S}'s {usd(ev)} price would make sense even if its sales shrank. The market is expecting little from it.</>;
  }

  // ── possible / plausible / probable (typical story) ──
  const possible: { tone: Tone; chip: string; text: string } = he ? (mult === null
    ? { tone: im.kind === "shrink" ? "good" : "hard", chip: im.kind === "shrink" ? "קל" : "לא ברור", text: im.kind === "shrink" ? "המחיר לא צריך שהיא תגדל בכלל." : "אף קצב צמיחה לא גורם לסיפור הזה לעבוד, כך ששאלת הגודל בכלל לא עולה." }
    : mult < 1 ? { tone: "good", chip: "קל", text: `בעוד 10 שנים היא יכולה להיות ${sizePhrase(mult, true)} (מכירות של כ-${U(im.kind === "ok" ? im.path[9].revenue : 0)}) — המחיר לא צריך שהיא תגדל.` }
    : mult <= 3 ? { tone: "good", chip: "גודל בהישג יד", text: `בעוד 10 שנים היא צריכה להיות ${sizePhrase(mult, true)} (מכירות של כ-${U(im.kind === "ok" ? im.path[9].revenue : 0)}).` }
    : mult <= 10 ? { tone: "mid", chip: "קפיצה גדולה", text: `היא צריכה לגדול בערך פי ${ltr(mult.toFixed(1))} ב-10 שנים (מכירות של כ-${U(im.kind === "ok" ? im.path[9].revenue : 0)}). האם השוק שלה גדול מספיק לזה? זו שאלה של שיקול דעת — והשאלה הראשונה של דמודרן.` }
    : { tone: "hard", chip: "קפיצה עצומה", text: `היא צריכה לגדול בערך פי ${ltr(mult.toFixed(0))} ב-10 שנים (מכירות של כ-${U(im.kind === "ok" ? im.path[9].revenue : 0)}). מעט שווקים יכולים להכיל כל כך הרבה צמיחה של חברה אחת.` })
    : mult === null
    ? { tone: im.kind === "shrink" ? "good" : "hard", chip: im.kind === "shrink" ? "Easy" : "Unclear", text: im.kind === "shrink" ? "The price doesn't need it to get bigger at all." : "No growth rate makes this story work, so the size question doesn't even arise." }
    : mult < 1 ? { tone: "good", chip: "Easy", text: `In 10 years it can be ${sizePhrase(mult, false)} (sales of ~${usd(im.kind === "ok" ? im.path[9].revenue : 0)}) — the price doesn't need it to grow.` }
    : mult <= 3 ? { tone: "good", chip: "Reachable size", text: `In 10 years it needs to be ${sizePhrase(mult, false)} (sales of ~${usd(im.kind === "ok" ? im.path[9].revenue : 0)}).` }
    : mult <= 10 ? { tone: "mid", chip: "Big leap", text: `It needs to become about ${mult.toFixed(1)}× bigger in 10 years (sales of ~${usd(im.kind === "ok" ? im.path[9].revenue : 0)}). Is its market big enough for that? That's your judgement — and Damodaran's first question.` }
    : { tone: "hard", chip: "Huge leap", text: `It needs to become about ${mult.toFixed(0)}× bigger in 10 years (sales of ~${usd(im.kind === "ok" ? im.path[9].revenue : 0)}). Few markets can hold that much growth for one company.` };
  const growthAsk = im.kind === "ok" ? im.growth : null;
  const dPast = growthAsk !== null ? demandVsHistory(growthAsk, past) : null;
  const plausibleParts: string[] = [];
  if (he) {
    if (growthAsk !== null) plausibleParts.push(past !== null ? `המחיר מניח ${salesPath(growthAsk, true)}; עד עכשיו היא ${pastPath(past, true)} ${pastWhen}${v.industryGrowth5y !== null ? `, והענף שלה ${pastPath(v.industryGrowth5y, true)} בשנה על פני חמש שנים` : ""}.` : `המחיר מניח ${salesPath(growthAsk, true)}.`);
    if (marginJump > 5) plausibleParts.push(`היא גם צריכה להעלות את שיעור הרווח שלה מ-${P(v.opMargin)} ל-${P(typical.story.targetMargin)} — שינוי גדול לכל עסק.`);
  } else {
  if (growthAsk !== null) plausibleParts.push(past !== null ? `The price assumes ${salesPath(growthAsk, false)}; so far it ${pastPath(past, false)} ${pastWhen}${v.industryGrowth5y !== null ? `, and its industry ${pastPath(v.industryGrowth5y, false)} a year over five years` : ""}.` : `The price assumes ${salesPath(growthAsk, false)}.`);
  if (marginJump > 5) plausibleParts.push(`It also has to raise its profit margin from ${pct(v.opMargin)} to ${pct(typical.story.targetMargin)} — a big change for any business.`);
  }
  const plausibleTone: Tone = im.kind !== "ok" ? "hard" : (dPast === "much_more" || marginJump > 15) ? "hard" : (dPast === "more" || marginJump > 5) ? "mid" : "good";
  const plausible = he
    ? { tone: plausibleTone, chip: plausibleTone === "good" ? "בתוך הרקורד שלה" : plausibleTone === "mid" ? "מתיחה" : "מעבר לרקורד שלה", text: plausibleParts.join(" ") || "המספרים לא תומכים בסיפור הזה בשום קצב צמיחה." }
    : { tone: plausibleTone, chip: plausibleTone === "good" ? "Within its record" : plausibleTone === "mid" ? "A stretch" : "Beyond its record", text: plausibleParts.join(" ") || "The numbers don't support this story at any growth rate." };
  const biz = bizOf(proven?.label);
  const ageFound = proven?.checks?.find((c) => c.id === "age");
  // the track-record sentence may already name the same miss — don't say it twice
  const ageCheck = ageFound && ageFound.miss && proven?.sentence?.toLowerCase().includes(ageFound.miss.toLowerCase()) ? { ...ageFound, pass: null } : ageFound;
  const probableTone: Tone = !biz ? "mid" : biz === "good" && ageCheck?.pass !== false ? "good" : biz === "weak" ? "hard" : "mid";
  const probable = he ? {
    tone: probableTone,
    chip: probableTone === "good" ? "נתמך ברקורד שלה" : probableTone === "mid" ? "ראיות מעורבות" : "עוד לא נתמך",
    text: `${proven?.sentence ? `הרקורד שלה: ${proven.sentence}` : "הרקורד שלה עוד לא קיבל ציון."}${ageCheck ? ` ${ageCheck.pass === false ? `והיא לא מתנהגת בהתאם לגילה: ${ageCheck.miss}.` : ageCheck.pass ? "היא משתמשת בהון שלה כפי שחברה בגילה צריכה." : ""}` : ""}`,
  } : {
    tone: probableTone,
    chip: probableTone === "good" ? "Backed by its record" : probableTone === "mid" ? "Mixed evidence" : "Not backed yet",
    text: `${proven?.sentence ? `Its track record: ${proven.sentence.charAt(0).toLowerCase()}${proven.sentence.slice(1)}` : "Its track record isn't scored yet."}${ageCheck ? ` ${ageCheck.pass === false ? `And it isn't acting its age: ${ageCheck.miss}.` : ageCheck.pass ? "It's using its capital the way a company its age should." : ""}` : ""}`,
  };
  const ask: Ask | null = im.kind === "shrink" ? "less" : im.kind !== "ok" ? "more" : askLevel === null ? null : askLevel === 0 ? "less" : askLevel === 1 ? "same" : "more";

  return (
    <section className="rounded-lg border border-border">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2.5 text-start hover:bg-muted/30">
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><Term id="reverse_dcf">{he ? "על מה המחיר מהמר" : "What the price is betting on"}</Term></span>
          <span className="block text-[11px] text-muted-foreground">{he ? "מחיר מניה הוא הימור על העתיד. הנה מה שצריך להתממש כדי שהמחיר הזה יהיה הגיוני." : "A share price is a bet on the future. Here's what has to come true for this one to make sense."}</span>
        </span>
        <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3.5 px-3 pb-3">
          <p className={`leading-snug ${wide ? "max-w-5xl text-[14.5px]" : "text-[13.5px]"}`}>{headline}</p>
          <GrowthAsk p={p} />
          {im.kind === "ok" && growthAsk !== null && growthAsk >= 20 && (
            <p className="text-[11.5px] leading-snug text-muted-foreground">{he
              ? <>לפרופורציה: מתוך החברות שצמחו ביותר מ-{ltr("20%")} בשנה ב-{ltr("1994")}, רק {ltr("13%")} עדיין צמחו בקצב כזה עשר שנים אחר כך (<a href={MCKINSEY} target="_blank" rel="noopener noreferrer" className="underline">McKinsey</a>). קשה לשמור על צמיחה מהירה.</>
              : <>For perspective: of companies growing over 20% a year in 1994, only 13% were still growing that fast ten years later (<a href={MCKINSEY} target="_blank" rel="noopener noreferrer" className="underline">McKinsey</a>). Fast growth is hard to keep.</>}</p>
          )}

          <div className={wide ? "grid items-start gap-5 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]" : "space-y-3.5"}>
          {/* three ready-made stories */}
          <div className="space-y-1.5">
            <div className="text-[12px] font-semibold">{he ? "שלוש דרכים שבהן הסיפור יכול להתפתח" : "Three ways the story could go"}</div>
            <div className="space-y-1.5">
              {scenarios.map((s) => {
                const a = answerText(s.implied, past, he);
                return (
                  <div key={s.id} className="rounded-md bg-muted/20 p-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-semibold">{he ? HE_SCENARIO_NAME[s.id] : s.name}</span>
                      <span className="ms-auto"><Chip tone={a.tone}>{a.text}</Chip></span>
                    </div>
                    <div className="text-[11.5px] leading-snug text-muted-foreground">{he ? <>אם {S} <AutoTerms text={heScenarioPlain(s.id, v)} />.</> : <>If {S} <AutoTerms text={s.plain} />.</>}</div>
                  </div>
                );
              })}
            </div>
            {!detail ? null : he ? (
            <p className="text-[11.5px] leading-snug">
              <span className="font-semibold">מה לשים לב: </span>
              ככל שהעסק טוב יותר — יותר רווח שנשאר מכל מכירה (<Term id="operating_margin">שיעור רווח</Term>), פחות כסף שנדרש כדי לצמוח (<Term id="sales_to_capital">מכירות להון</Term>) — כך המחיר צריך פחות צמיחה. ערך נובע מצמיחה <em>וגם</em> ממה שהצמיחה הזו עולה.
              {cautious.implied.kind === "growth_destroys" && <> בסיפור הזהיר הצמיחה אפילו <em>מורידה</em> את הערך: בשיעור הרווח של היום, כל דולר חדש שמושקע מרוויח בערך {P(roNewToday)}, פחות מה-{P(v.costOfCapital, 1)} שהכסף הזה עולה. צמיחה עוזרת רק לעסק שמרוויח יותר מ<Term id="cost_of_capital">עלות ההון</Term> שלו.</>}
            </p>
            ) : (
            <p className="text-[11.5px] leading-snug">
              <span className="font-semibold">What to notice: </span>
              the better the business — more profit kept from each sale (<Term id="operating_margin">margin</Term>), less money needed to grow (<Term id="sales_to_capital">sales to capital</Term>) — the less growth the price needs. Value comes from growth <em>and</em> from what that growth costs.
              {cautious.implied.kind === "growth_destroys" && <> In the cautious story growth even <em>lowers</em> value: at today's margin, each new dollar invested earns about {pct(roNewToday)}, less than the {pct(v.costOfCapital, 1)} that money costs. Growth only helps a business that earns more than its <Term id="cost_of_capital">cost of capital</Term>.</>}
            </p>
            )}
          </div>

          {/* the 3P test */}
          <div className="space-y-1.5">
            <div className="text-[12px] font-semibold">{he ? <><Term id="three_p">שלוש השאלות של דמודרן</Term> על הסיפור הטיפוסי</> : <><Term id="three_p">Damodaran's three questions</Term> about the typical story</>}</div>
            {(he
              ? [["אפשרי?", "האם היא יכולה להגיע לגודל כזה?", possible], ["סביר?", "האם המספרים מתאימים למה שהיא הראתה?", plausible], ["מסתבר?", "האם יש ראיות שזה יקרה?", probable]] as const
              : [["Possible?", "Could it get that big?", possible], ["Plausible?", "Do the numbers fit what it has shown?", plausible], ["Probable?", "Is there evidence it will happen?", probable]] as const).map(([q, sub, r]) => (
              <div key={q} className="space-y-0.5">
                <div className="flex items-center gap-2 text-[12px]"><span className="font-semibold">{q}</span><span className="text-muted-foreground">{sub}</span><span className="ms-auto"><Chip tone={r.tone}>{r.chip}</Chip></span></div>
                <p className="text-[11.5px] leading-snug text-muted-foreground"><AutoTerms text={r.text} /></p>
              </div>
            ))}
            {detail && <p className="text-[11px] leading-snug text-muted-foreground">{he ? "סיפורים רבים עוברים את השאלה הראשונה ונכשלים באחרונה. אפשרי זה קל; מסתבר זה החלק הקשה." : "Many stories pass the first question and fail the last. Possible is easy; probable is the hard part."}</p>}
          </div>

          {/* good company vs good investment */}
          {biz && ask && (
            <div className="space-y-1.5">
              <div className="text-[12px] font-semibold"><Term id="good_company">{he ? "חברה טובה ≠ השקעה טובה" : "Good company ≠ good investment"}</Term></div>
              {detail && <p className="text-[11.5px] leading-snug text-muted-foreground">{he ? "דמודרן שואל שתי שאלות נפרדות: האם זה עסק טוב, והאם המחיר מבקש יותר מדי? חברה נהדרת יכולה להיות השקעה גרועה אם המחיר כבר מניח שהכול ילך כשורה. כאן \"מה שהיא הראתה\" פירושו גם הצמיחה שלה וגם שיעור הרווח שלה." : "Damodaran asks two separate questions: is this a good business, and is the price asking too much? A great company can be a poor investment if the price already assumes everything goes right. Here \"what it has shown\" means both its growth and its profit margin."}</p>}
              <div className="grid grid-cols-[auto_repeat(3,minmax(0,1fr))] gap-px overflow-hidden rounded-md border border-border text-[10px]">
                <div className="bg-muted/30 p-1" />
                {(["less", "same", "more"] as Ask[]).map((a) => <div key={a} className="bg-muted/30 p-1 text-center text-muted-foreground">{he ? (a === "less" ? "המחיר מבקש פחות ממה שהראתה" : a === "same" ? "בערך מה שהראתה" : "יותר ממה שהראתה") : a === "less" ? "price asks less than it has shown" : a === "same" ? "about what it has shown" : "more than it has shown"}</div>)}
                {(["good", "unproven", "weak"] as Biz[]).map((b) => (
                  <Fragment key={b}>
                    <div className="bg-muted/30 p-1 text-muted-foreground">{he ? (b === "good" ? "עסק מוכח" : b === "unproven" ? "לא מוכח / נשחק" : "לא מרוויח את עלותו") : b === "good" ? "Proven business" : b === "unproven" ? "Unproven / slipping" : "Not earning its cost"}</div>
                    {(["less", "same", "more"] as Ask[]).map((a) => <div key={b + a} className={`p-1 ${b === biz && a === ask ? "bg-primary/25 ring-1 ring-primary" : "bg-background"}`} />)}
                  </Fragment>
                ))}
              </div>
              <p className="text-[12px] leading-snug"><AutoTerms text={(he ? CELL_HE : CELL)[biz][ask]} /></p>
            </div>
          )}

          </div>
          <div className={wide ? "grid items-start gap-5 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]" : "space-y-3.5"}>
          <div className="space-y-1.5">
          <button onClick={() => setDetail(!detail)} className="flex items-center gap-1 text-[11.5px] text-primary hover:underline">{detail ? (he ? "פחות הסברים" : "Fewer explanations") : (he ? "להראות את ההסברים" : "Show the reasoning")} <ChevronDown size={12} className={detail ? "rotate-180" : ""} /></button>
          {/* learn: what's a story */}
          <button onClick={() => setLearn(!learn)} className="flex items-center gap-1 text-[11.5px] text-primary hover:underline">{he ? "מה זה \"סיפור\" בהערכת שווי?" : <>What's a "story" in valuation?</>} <ChevronDown size={12} className={learn ? "rotate-180" : ""} /></button>
          {learn && he && (
            <div className="space-y-1 rounded-md bg-muted/20 p-2.5 text-[11.5px] leading-snug">
              <p><Term id="damodaran">דמודרן</Term> אומר שכל מחיר הוא <Term id="story">סיפור שמסופר במספרים</Term>. כל סיפור של חברה עוסק בארבעה דברים:</p>
              <p><b>כמה גדולה?</b> — באיזה קצב המכירות צומחות, ועד כמה החברה יכולה לגדול.</p>
              <p><b>כמה רווחית?</b> — כמה מכל דולר מכירות היא שומרת כרווח תפעולי (<Term id="operating_margin">שיעור הרווח התפעולי</Term> שלה).</p>
              <p><b>כמה עולה לה לצמוח?</b> — כמה כסף היא צריכה להחזיר לעסק (<Term id="reinvestment">השקעה מחדש</Term>) על כל דולר חדש של מכירות.</p>
              <p><b>כמה מסוכנת?</b> — התשואה שמשקיעים דורשים בעבור הסיכון הזה (<Term id="cost_of_capital">עלות ההון</Term> שלה, {P(v.costOfCapital, 1)} בענף שלה).</p>
              <p>האפליקציה ממלאת את אלה מהמספרים של החברה עצמה ומהממוצעים של הענף שלה, ואז שואלת איזו צמיחה המחיר צריך. אין צורך לקבוע שום דבר.</p>
            </div>
          )}
          {learn && !he && (
            <div className="space-y-1 rounded-md bg-muted/20 p-2.5 text-[11.5px] leading-snug">
              <p><Term id="damodaran">Damodaran</Term> says every price is a <Term id="story">story told in numbers</Term>. Every company story is about four things:</p>
              <p><b>How big?</b> — how fast sales grow, and how large the company can become.</p>
              <p><b>How profitable?</b> — how much of each dollar of sales it keeps as operating profit (its <Term id="operating_margin">operating margin</Term>).</p>
              <p><b>How much it costs to grow?</b> — how much money it has to put back into the business (<Term id="reinvestment">reinvestment</Term>) for each new dollar of sales.</p>
              <p><b>How risky?</b> — the return investors demand for that risk (its <Term id="cost_of_capital">cost of capital</Term>, {pct(v.costOfCapital, 1)} for its industry).</p>
              <p>The app fills these from the company's own numbers and its industry's averages, then asks what growth the price needs. You don't have to set anything.</p>
            </div>
          )}

          </div>
          <div className="space-y-1.5">
          {/* optional experiment */}
          <button onClick={() => setLab(!lab)} className="flex items-center gap-1 text-[11.5px] text-primary hover:underline">{he ? "לנסות בעצמך (לא חובה)" : "Experiment yourself (optional)"} <ChevronDown size={12} className={lab ? "rotate-180" : ""} /></button>
          {lab && labStory && labRes && (
            <div className="space-y-2 rounded-md bg-muted/20 p-2.5">
              <p className="text-[11px] text-muted-foreground">{he ? "מתחילים מהסיפור הטיפוסי. אפשר להזיז מנוף אחד ולראות כמה צמיחה המחיר צריך אז." : "Starts from the typical story. Move one lever and watch how much growth the price then needs."}</p>
              <Slider label={he ? "כמה רווחית היא תהיה" : "How profitable it becomes"} plain={he ? "שיעור הרווח התפעולי שהיא מגיעה אליו בעוד 5 שנים — החלק מהמכירות שהיא שומרת כרווח תפעולי." : "Operating margin it reaches in 5 years — the share of sales it keeps as operating profit."} value={labStory.targetMargin} min={-10} max={60} step={0.5} unit="%" onChange={setMargin}
                hint={he ? `היום ${ltr(pct(v.opMargin, 1))}${v.industryOpMargin !== null ? ` · ממוצע הענף ${ltr(pct(v.industryOpMargin, 1))}` : ""}` : `today ${pct(v.opMargin, 1)}${v.industryOpMargin !== null ? ` · industry average ${pct(v.industryOpMargin, 1)}` : ""}`} />
              <Slider label={he ? "כמה עולה לה לצמוח" : "How much it costs to grow"} plain={he ? "המכירות שהיא מקבלת על כל דולר שהיא משקיעה מחדש — גבוה יותר אומר שהצמיחה זולה יותר." : "Sales it gets for each $1 it reinvests — higher means growth is cheaper."} value={labStory.salesToCapital} min={0.2} max={6} step={0.1} unit="×" onChange={setS2c}
                hint={he ? `${v.salesToCapital !== null ? `היום ${ltr(v.salesToCapital.toFixed(2) + "×")}` : ""}${v.industrySalesToCapital !== null ? ` · ענף ${ltr(v.industrySalesToCapital.toFixed(2) + "×")}` : ""}` : `${v.salesToCapital !== null ? `today ${v.salesToCapital.toFixed(2)}×` : ""}${v.industrySalesToCapital !== null ? ` · industry ${v.industrySalesToCapital.toFixed(2)}×` : ""}`} />
              <Slider label={he ? "כמה מסוכנת" : "How risky"} plain={he ? "התשואה השנתית שמשקיעים דורשים מעסק מהסוג הזה (עלות ההון)." : "The yearly return investors demand for this kind of business (cost of capital)."} value={labStory.costOfCapital} min={4} max={16} step={0.1} unit="%" onChange={setWacc} hint={v.costOfCapitalSource} />
              <p className="text-[12.5px] leading-snug">
                {he ? (labRes.kind === "ok" ? <>אז המחיר מניח <b>{salesPath(labRes.growth, true)}</b>.</>
                  : labRes.kind === "growth_destroys" ? <>עם המספרים האלה, הצמיחה מורידה את הערך — כל דולר חדש ירוויח בערך {P(returnOnNewCapital(labStory), 1)}, פחות מהעלות שלו, {P(labStory.costOfCapital, 1)}.</>
                  : labRes.kind === "beyond" ? <>שום צמיחה מציאותית לא מגיעה למחיר עם המספרים האלה.</> : <>המחיר הגיוני גם אם המכירות יתכווצו.</>)
                  : labRes.kind === "ok" ? <>Then the price assumes <b>{salesPath(labRes.growth, false)}</b>.</>
                  : labRes.kind === "growth_destroys" ? <>With these numbers, growth lowers value — each new dollar would earn about {pct(returnOnNewCapital(labStory), 1)}, less than its {pct(labStory.costOfCapital, 1)} cost.</>
                  : labRes.kind === "beyond" ? <>No realistic growth reaches the price with these numbers.</> : <>The price makes sense even if sales shrink.</>}
              </p>
              <button onClick={() => { setMargin(null); setS2c(null); setWacc(null); }} className="text-[11px] text-muted-foreground underline">{he ? "חזרה לסיפור הטיפוסי" : "Reset to the typical story"}</button>
            </div>
          )}

          </div>
          </div>
          {he ? (
          <p className="text-[10.5px] leading-snug text-muted-foreground">
            גרסה מפושטת של הגישה של דמודרן — הקריאה שלו במחירים כנקודת איזון (<a href={TRILLION_POST} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">Trillion Dollar Market Caps, דצמ׳ 2025 <ExternalLink size={9} /></a>) ומטריצת העסק × המחיר שלו (<a href={PARADOX_POST} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">Explaining a Paradox, 2017 <ExternalLink size={9} /></a>). מניחה תחזית של 10 שנים, תקרת צמיחה לטווח ארוך של {ltr(RISK_FREE + "%")}, ומחיר של היום שכולל את החוב פחות המזומנים. דרך לחשוב, לא המלצה.
          </p>
          ) : (
          <p className="text-[10.5px] leading-snug text-muted-foreground">
            A simplified version of Damodaran's approach — his break-even reading of prices (<a href={TRILLION_POST} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">Trillion Dollar Market Caps, Dec 2025 <ExternalLink size={9} /></a>) and his business × price matrix (<a href={PARADOX_POST} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">Explaining a Paradox, 2017 <ExternalLink size={9} /></a>). Assumes a 10-year forecast, a {RISK_FREE}% long-run growth ceiling, and today's price including debt minus cash. A way to think, not a recommendation.
          </p>
          )}
        </div>
      )}
    </section>
  );
}
