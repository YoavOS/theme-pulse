import { useEffect, useMemo, useState } from "react";
import { BookOpen, ExternalLink, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { LensPayload } from "@/lib/lens/types";
import type { ProvenRow } from "@/lib/proven/types";
import { READING_GUIDE } from "@/lib/lens/readingGuide";
import { READING_GUIDE_HE } from "@/lib/lens/he/readingGuide";
import { ltr, useLensLang } from "@/lib/lens/i18n";
import { AutoTerms } from "./Term";

/**
 * "What the numbers can't tell you" — Damodaran's point that numbers need a story: for this company,
 * where its numbers are least reliable, the odds its edge lasts (from the 10-K history of every company),
 * and the questions only its story can answer.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
interface Fade { above5: number; level: string; n5: number; kept5: number | null; most5: number | null; n3: number; kept3: number | null }
interface Base { k: number; kept_pct: number; strong_pct: number; all_kept_pct: number }

let fadeCache: Fade[] | null = null;
function useFade(symbol: string) {
  const [fade, setFade] = useState<Fade[] | null>(fadeCache);
  const [base, setBase] = useState<Base | null>(null);
  useEffect(() => {
    let alive = true;
    setBase(null);
    if (!fadeCache) db.from("fade_rates").select("*").then(({ data }: { data: Fade[] | null }) => { fadeCache = data ?? []; if (alive) setFade(fadeCache); });
    db.from("lookalike_base").select("k, kept_pct, strong_pct, all_kept_pct").eq("symbol", symbol).maybeSingle().then(({ data }: { data: Base | null }) => { if (alive) setBase(data); });
    return () => { alive = false; };
  }, [symbol]);
  return { fade, base };
}

export default function LimitsCard({ p, proven }: { p: LensPayload; proven: ProvenRow | null }) {
  const { fade, base } = useFade(p.symbol);
  const he = useLensLang() === "he";
  const t = (en: string, h: string) => (he ? h : en);
  const S = he ? ltr(p.symbol) : p.symbol;

  const warnings = useMemo(() => {
    const w: { title: string; text: string }[] = [];
    const stage = p.lifeCycle?.stage;
    const flags = new Set(proven?.flags ?? []);
    const a = p.adjust;
    if (p.financial || proven?.track === "financial") w.push({ title: t("A bank or insurer", "בנק או חברת ביטוח"), text: t("For financial companies debt is raw material, so return on capital, margins and debt ratios don't mean what they mean elsewhere. Look at return on equity against the cost of equity, and book value.", "בחברות פיננסיות החוב הוא חומר הגלם, ולכן תשואה על ההון, שיעורי רווח ויחסי חוב לא אומרים את מה שהם אומרים בחברות אחרות. כדאי להסתכל על התשואה על ההון העצמי מול עלות ההון העצמי, ועל ההון העצמי בספרים.") });
    if (stage === "startup" || stage === "young_growth" || proven?.track === "young") w.push({ title: t("Young company", "חברה צעירה"), text: t("Its past numbers say little about its future — the value rests almost entirely on the story (how big it can get, what margins it can reach). Losses now can be fine; the question is whether the story is plausible.", "המספרים שלה מהעבר אומרים מעט על העתיד — הערך נשען כמעט כולו על הסיפור (עד כמה היא יכולה לגדול, לאיזה שיעור רווח היא יכולה להגיע). הפסדים עכשיו יכולים להיות בסדר; השאלה היא אם הסיפור סביר.") });
    if (a?.rndTtm && a.revenueTtm && a.rndTtm / a.revenueTtm >= 0.08) w.push({ title: t(`Heavy R&D (${Math.round((100 * a.rndTtm) / a.revenueTtm)}% of revenue)`, `מו"פ כבד (${ltr(Math.round((100 * a.rndTtm) / a.revenueTtm) + "%")} מההכנסות)`), text: t("Accounting treats R&D as an expense, though it builds future products. Reported profit is understated and return on capital overstated; the R&D card shows Damodaran's correction.", "החשבונאות רושמת מו\"פ כהוצאה, למרות שהוא בונה את המוצרים של העתיד. הרווח המדווח נמוך מהאמיתי והתשואה על ההון גבוהה ממנה; כרטיס המו\"פ מראה את התיקון של דמודרן.") });
    if (proven?.track === "cyclical" || flags.has("cyclical_by_volatility")) w.push({ title: t("Cyclical", "חברה מחזורית"), text: t("Its returns swing with the economy or commodity prices. One year — good or bad — is not the normal level; use the multi-year average.", "התשואות שלה עולות ויורדות עם הכלכלה או עם מחירי הסחורות. שנה אחת — טובה או רעה — היא לא הרמה הרגילה; עדיף להסתכל על הממוצע של כמה שנים.") });
    if (flags.has("ex_goodwill_better")) w.push({ title: t("Acquisitions", "רכישות"), text: t("A large part of its capital is goodwill from acquisitions. The business itself earns much more than the total return shows — the question is whether it overpaid.", "חלק גדול מההון שלה הוא מוניטין מרכישות. העסק עצמו מרוויח הרבה יותר ממה שהתשואה הכוללת מראה — השאלה היא אם היא שילמה יותר מדי.") });
    if (a?.leaseNow && a.icBase && a.leaseNow / a.icBase > 0.2) w.push({ title: t("Big lease commitments", "התחייבויות חכירה גדולות"), text: t("Leases are debt in disguise; the Lens counts them, which lowers return on capital and raises debt compared with the reported figures.", "חכירות הן חוב בתחפושת; העדשה סופרת אותן, ולכן התשואה על ההון נמוכה יותר והחוב גבוה יותר מהמספרים המדווחים.") });
    if (flags.has("stale_filings")) w.push({ title: t("Old filings", "דוחות ישנים"), text: t("No annual report in about two years — the numbers may be out of date.", "אין דוח שנתי כבר כשנתיים — המספרים עלולים להיות לא מעודכנים.") });
    if ((proven?.years_valid ?? 10) < 7 && proven?.status === "ok") w.push({ title: t(`Only ${proven?.years_valid} years of data`, `רק ${ltr(proven?.years_valid)} שנים של נתונים`), text: t("Too few years to tell a lasting edge from a good run.", "מעט מדי שנים כדי להבחין בין יתרון מתמשך לתקופה טובה.") });
    return w;
  }, [p, proven, he]); // eslint-disable-line react-hooks/exhaustive-deps

  // this company's record → the matching fade-rate row
  const odds = useMemo(() => {
    const s = (proven?.series ?? []).map((x) => x.spread).filter((x): x is number => typeof x === "number");
    if (s.length < 5 || !fade?.length) return null;
    const last5 = s.slice(-5), last3 = s.slice(-3).sort((x, y) => x - y);
    const above5 = last5.filter((x) => x > 0).length, med = last3[1];
    const level = med < 0 ? "below" : med < 5 ? "0-5" : med < 15 ? "5-15" : "15+";
    const row = fade.find((f) => f.above5 === above5 && f.level === level);
    return row && row.n5 >= 20 ? { above5, level, row } : null;
  }, [proven, fade]);

  const story = he ? [
    { q: "למה היא מרוויחה יותר ממה שההון שלה עולה — מה מונע ממתחרים להעתיק אותה?", where: "דוח 10-K, סעיף 1 (העסק ← תחרות) — ואז להשוות לתשואות של המתחרים." },
    { q: "עד כמה היא יכולה לגדול? האם השוק שהמחיר מניח גדול מספיק לה ולכל המתחרות שלה?", where: "דוחות ענף, טענות החברה עצמה על גודל השוק (יום משקיעים), ובדיקת הענף בעמוד הרעיונות." },
    { q: "האם ההנהלה משקיעה בתשואות טובות, או גדלה רק כדי לגדול?", where: "דוח 10-K, סעיף 7 (דיון וניתוח של ההנהלה) והתשואה על ההון החדש בעדשה." },
    { q: "מה יכול לשבור את הסיפור?", where: "דוח 10-K, סעיף 1A (גורמי סיכון) — במיוחד סיכונים חדשים לעומת השנה שעברה." },
    { q: "האם המחיר כבר מגלם את כל זה?", where: "כרטיס \"על מה המחיר מהמר\" למעלה: מה המחיר צריך, והאם זה אפשרי, סביר ומסתבר." },
  ] : [
    { q: "Why does it earn more than its capital costs — what stops competitors from copying it?", where: "10-K, Item 1 (Business → Competition) — then compare with its competitors' returns." },
    { q: "How big can it get? Is the market it is priced for big enough for it and all its rivals?", where: "Industry reports, the company's own market-size claims (Investor Day), and the industry check in Ideas." },
    { q: "Is management investing at good returns, or growing for its own sake?", where: "10-K, Item 7 (Management's discussion) and the return on new capital in the Lens." },
    { q: "What could break the story?", where: "10-K, Item 1A (Risk factors) — especially new risks compared with last year." },
    { q: "Is the price already counting on all of this?", where: "Open Valuation to test the growth, margin and capital assumptions required by the saved market value." },
  ];


  return (
    <section className="rounded-lg border border-[hsl(40,90%,55%)]/30 p-3 text-[12.5px]">
      <div className="mb-2 flex items-center gap-1.5">
        <ShieldAlert size={14} className="text-[hsl(40,90%,60%)]" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(40,90%,60%)]">{t("What the numbers can't tell you", "מה המספרים לא יכולים לספר")}</span>
        <ReadingGuideButton />
      </div>
      <p className="mb-2 text-foreground/85">{<AutoTerms text={t("Damodaran: numbers without a story become a spreadsheet fantasy; a story without numbers is a fairy tale. The numbers here describe the past — the value rests on the future.", "דמודרן: מספרים בלי סיפור הופכים לפנטזיה בגיליון אלקטרוני; סיפור בלי מספרים הוא אגדה. המספרים כאן מתארים את העבר — והערך תלוי בעתיד.")}/>}</p>

      {warnings.length > 0 && (
        <div className="mb-2 space-y-1.5">
          <div className="text-[11px] font-semibold text-muted-foreground">{he ? <>איפה המספרים של {S} הכי פחות אמינים</> : <>Where {p.symbol}'s numbers are least reliable</>}</div>
          {warnings.map((w) => <p key={w.title}><span className="font-semibold">{w.title}.</span> <span className="text-foreground/85"><AutoTerms text={w.text} /></span></p>)}
        </div>
      )}

      {(odds || base) && (
        <div className="mb-2 rounded-md bg-muted/30 p-2">
          <div className="text-[11px] font-semibold text-muted-foreground">{t("Will the edge last? The odds from history", "האם היתרון יחזיק? הסיכויים מההיסטוריה")}</div>
          {odds && (
            <p className="mt-0.5">{he
              ? <>מבין החברות שהרוויחו מעל עלות ההון שלהן ב-{ltr(odds.above5)} מתוך {ltr(5)} שנים, עם מרווח אחרון {odds.level === "below" ? "שלילי" : <>של {ltr(odds.level)} נקודות</>}: <span className="font-semibold">{ltr(odds.row.kept5 + "%")}</span> עדיין היו מעליה אחרי חמש שנים, ו-{ltr(odds.row.most5 + "%")} נשארו מעליה לפחות ב-{ltr(4)} מתוך {ltr(5)} השנים הבאות <span className="text-muted-foreground">({ltr(odds.row.n5)} מקרים)</span>.</>
              : <>Companies that beat their cost of capital in {odds.above5} of 5 years, with a recent spread of {odds.level === "below" ? "below zero" : `${odds.level} points`}: <span className="font-semibold">{odds.row.kept5}%</span> were still above it 5 years later; {odds.row.most5}% stayed above in at least 4 of the next 5 years <span className="text-muted-foreground">({odds.row.n5} cases)</span>.</>}</p>
          )}
          {base && (
            <p className="mt-0.5">{he
              ? <>מבין {ltr(base.k)} החברות מהעבר שנראו הכי דומה ל-{S} היום, <span className="font-semibold">{ltr(base.kept_pct + "%")}</span> המשיכו להרוויח מעל עלות ההון שלהן ב-{ltr(4)} מתוך {ltr(5)} השנים הבאות או יותר (בכלל החברות: {ltr(base.all_kept_pct + "%")}).</>
              : <>Of the {base.k} past companies that looked most like {p.symbol} does now, <span className="font-semibold">{base.kept_pct}%</span> kept earning above their cost of capital in 4+ of the next 5 years (for all companies: {base.all_kept_pct}%).</>}</p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">{<AutoTerms text={t("Only companies still listed today are in this history — failed ones are missing — so these odds are somewhat too optimistic.", "בהיסטוריה הזו יש רק חברות שעדיין נסחרות היום — חברות שנכשלו חסרות — ולכן הסיכויים האלה אופטימיים מדי במידה מסוימת.")}/>}</p>
        </div>
      )}

      <div className="space-y-1">
        <div className="text-[11px] font-semibold text-muted-foreground">{t("Questions only the story can answer", "שאלות שרק הסיפור יכול לענות עליהן")}</div>
        {story.map((s) => <p key={s.q}><span className="text-foreground"><AutoTerms text={s.q} /></span> <span className="text-muted-foreground">— <AutoTerms text={s.where} /></span></p>)}
      </div>
    </section>
  );
}

export function ReadingGuideButton() {
  const he = useLensLang() === "he";
  const guide = he ? READING_GUIDE_HE : READING_GUIDE;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"><BookOpen size={11} /> {he ? "איך לקרוא את המספרים" : "How to read these numbers"}</button>
      </DialogTrigger>
      <DialogContent dir={he ? "rtl" : "ltr"} className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{he ? "איך לקרוא את המספרים" : "How to read these numbers"}</DialogTitle></DialogHeader>
        <div className="space-y-4 text-[13px]">
          {guide.map((g) => (
            <div key={g.id}>
              <div className="font-semibold">{g.name}</div>
              <p className="text-foreground/90">{g.says}</p>
              <div className="mt-1 text-[12px] font-semibold text-muted-foreground">{he ? "איך זה יכול להטעות" : "How it can mislead"}</div>
              <ul className="list-disc space-y-0.5 ps-5 text-foreground/85">{g.misleads.map((m) => <li key={m}>{m}</li>)}</ul>
              <p className="mt-1"><span className="font-semibold text-muted-foreground">{he ? "לקרוא יחד עם: " : "Read it with: "}</span>{g.pairWith}</p>
              {g.link && <a href={g.link.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-primary hover:underline"><ExternalLink size={11} /> {g.link.title}</a>}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
