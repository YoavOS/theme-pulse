import { useMemo } from "react";
import type { LensPayload } from "@/lib/lens/types";
import { useLensLang } from "@/lib/lens/i18n";
import { wholePicture, type Tab } from "@/lib/lens/wholePicture";
import { AutoTerms } from "./Term";

const SLICE: Record<string, string> = {
  cost: "hsl(var(--down) / 0.85)", rnd: "hsl(280 60% 62%)", sga: "hsl(35 85% 58%)", other: "hsl(var(--muted-foreground) / 0.6)",
  exp: "hsl(35 85% 58%)", prov: "hsl(var(--down) / 0.85)", tax: "hsl(var(--muted-foreground) / 0.45)", net: "hsl(var(--up))",
};
const TONE = { good: "text-[hsl(var(--up))]", bad: "text-[hsl(var(--down))]", neutral: "text-foreground" } as const;

/** One connected story: what it sells → what that costs → what's left → the capital behind it → growth → the price. */
export default function WholePicture({ p, onExplore }: { p: LensPayload; onExplore: (s: Tab) => void }) {
  const he = useLensLang() === "he", t = (en: string, h: string) => (he ? h : en);
  const pic = useMemo(() => wholePicture(p, he), [p, he]);
  if (!pic || !pic.steps.length) return null;
  const slices = pic.per100.filter((s) => s.per100 >= 0.5);
  const scale = Math.max(100, slices.reduce((a, s) => a + s.per100, 0));
  const goTo = { statements: t("See the statements →", "לדוחות ←"), evidence: t("See the evidence →", "לראיות ←"), valuation: t("See the valuation →", "להערכת השווי ←"), learn: t("Learn more →", "ללמוד עוד ←") };
  return <section className="overflow-hidden rounded-2xl border border-border bg-card/40" aria-labelledby="whole-picture">
    <header className="border-b border-border/70 p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">{t("The whole picture", "התמונה המלאה")}</p>
      <h2 id="whole-picture" className="mt-1 text-xl font-semibold">{t("Follow one dollar through the business", "עוקבים אחרי דולר אחד בתוך העסק")}</h2>
      {pic.summary && <p className="mt-2 text-[15px] font-medium leading-relaxed"><AutoTerms text={pic.summary} /></p>}
    </header>
    {slices.length > 1 && <div className="border-b border-border/70 p-5">
      <p className="text-sm text-muted-foreground"><AutoTerms text={t("Where each $100 of revenue goes (last 12 months)", "לאן הולך כל $100 של הכנסות (12 החודשים האחרונים)")} /></p>
      <div className="mt-2 flex h-9 w-full overflow-hidden rounded-lg" dir="ltr" role="img"
        aria-label={slices.map((s) => `${s.label}: $${s.per100.toFixed(0)}`).join(", ")}>
        {slices.map((s) => <div key={s.key} title={`${s.label}: $${s.per100.toFixed(1)}`} style={{ width: `${(s.per100 / scale) * 100}%`, background: s.kind === "loss" ? "repeating-linear-gradient(45deg, hsl(var(--down)/.9) 0 6px, hsl(var(--down)/.5) 6px 12px)" : SLICE[s.key] ?? SLICE.other }}
          className="flex items-center justify-center overflow-hidden border-e border-background/60 text-xs font-semibold text-background last:border-e-0">{s.per100 >= 7 ? `$${s.per100.toFixed(0)}` : ""}</div>)}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {slices.map((s) => <li key={s.key} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.kind === "loss" ? "hsl(var(--down))" : SLICE[s.key] ?? SLICE.other }} /><span><AutoTerms text={s.label} /></span> <bdi className="font-mono">${s.per100.toFixed(0)}</bdi></li>)}
      </ul>
      {pic.lossMaking && <p className="mt-2 text-xs text-muted-foreground"><AutoTerms text={t("Costs add up to more than $100: the striped part is the loss, paid for from savings or outside money.", "העלויות מסתכמות ביותר מ־$100: החלק המפוספס הוא ההפסד, שממומן מחסכונות או מכסף חיצוני.")} /></p>}
    </div>}
    <ol className="divide-y divide-border/70">
      {pic.steps.map((s, i) => <li key={s.key} className="grid gap-3 p-5 sm:grid-cols-[2rem_minmax(0,1fr)_minmax(8rem,auto)]">
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/40 text-sm font-semibold text-primary">{i + 1}</span>
        <div>
          <h3 className="font-semibold"><AutoTerms text={s.title} /></h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground"><AutoTerms text={s.text} /></p>
          <button onClick={() => onExplore(s.tab)} className="mt-1 text-xs text-primary hover:underline">{goTo[s.tab]}</button>
        </div>
        <div className="sm:text-end">
          <p className={`font-mono text-xl font-semibold ${TONE[s.tone ?? "neutral"]}`} dir="ltr">{s.figure}</p>
          {s.caption && <p className="text-xs text-muted-foreground"><AutoTerms text={s.caption} /></p>}
        </div>
      </li>)}
    </ol>
    <p className="border-t border-border/70 px-5 py-3 text-xs text-muted-foreground"><AutoTerms text={t("Built from the company's own filings and the industry's cost of capital. It describes the business; it is not a recommendation.", "נבנה מהדוחות של החברה ומעלות ההון של הענף. זה תיאור של העסק, לא המלצה.")} /></p>
  </section>;
}
