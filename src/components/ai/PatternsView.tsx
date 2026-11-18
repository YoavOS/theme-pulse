import { useCallback, useEffect, useState } from "react";
import { Loader2, Play, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { invokeAi, waitJob, type AiLang } from "@/lib/ai";
import { touchLab } from "@/lib/labs";
import { rulePart, type Rule } from "@/lib/patterns";
import AiMarkdown from "./AiMarkdown";

/**
 * Pattern finder: what did stocks look like before they rose 30%+ within 60 sessions? Every single trait and
 * every pair of traits is counted on the older 70% of dates and re-checked on the newer 30% — only patterns
 * that held up there are marked as such. The AI then explains them.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
interface Run { id: number; created_at: string; split_date: string; thresholds: number[][]; base_train: number; base_test: number; n_train: number; n_test: number; ai_text: string | null; ai_text_he: string | null; ai_model: string | null }
interface Match { rule_a: number; rule_abin: number; rule_b: number | null; rule_bbin: number | null; symbol: string }

async function call(body: Record<string, unknown>) {
  return invokeAi("pattern-finder", body);
}

export default function PatternsView({ lang }: { lang: AiLang }) {
  const he = lang === "he";
  const [status, setStatus] = useState<{ done: number; total: number; samples: number } | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    call({ action: "status" }).then(setStatus).catch(() => undefined);
    const { data: r } = await db.from("pattern_runs").select("*").order("id", { ascending: false }).limit(1).maybeSingle();
    setRun(r ?? null);
    if (r) {
      const { data: rs } = await db.from("pattern_rules").select("*").eq("run_id", r.id).order("lift_test", { ascending: false }).limit(60);
      setRules(rs ?? []);
      const { data: m } = await db.rpc("pattern_matches", { rid: r.id, max_rules: 8 });
      setMatches(m ?? []);
    }
  }, []);
  useEffect(() => { touchLab("patterns"); load(); }, [load]);

  const build = async () => {
    setBusy(he ? "בונה דגימות מהיסטוריית המחירים…" : "Building samples from the price history…");
    try {
      for (let i = 0; i < 200; i++) {
        const r = await call({ action: "samples" });
        setBusy(he ? `בונה דגימות… נשארו ${r.remaining} מניות` : `Building samples… ${r.remaining} stocks left`);
        if (r.done) break;
      }
      setBusy(he ? "מחפש דפוסים ובודק אותם על תקופה חדשה (עד כמה דקות)…" : "Finding patterns and checking them on a newer period (up to a few minutes)…");
      const m = await call({ action: "mine" });
      await load();
      if (m?.jobs?.length) {
        setBusy(he ? "ה-AI כותב הסבר לדפוסים…" : "The AI is writing the explanation…");
        await Promise.all(m.jobs.map((id: number) => waitJob("pattern-finder", id).catch(() => undefined)));
        await load();
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const held = rules.filter((r) => r.held).slice(0, 12);
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
  const RuleText = ({ r }: { r: { a: number; abin: number; b: number | null; bbin: number | null } }) => {
    const parts = [rulePart(r.a, r.abin, run!.thresholds, he), ...(r.b ? [rulePart(r.b, r.bbin!, run!.thresholds, he)] : [])];
    return <>{parts.map((p, i) => <span key={i}>{i > 0 && <span className="text-muted-foreground">{he ? " וגם " : " + "}</span>}<span className="font-medium">{p.trait}</span> <span className="text-muted-foreground">({p.fifth}: <span dir="ltr">{p.range}</span>)</span></span>)}</>;
  };
  const text = run ? (he ? run.ai_text_he ?? run.ai_text : run.ai_text) : null;

  return (
    <div className="space-y-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-muted-foreground">{he ? "איך נראו מניות לפני שעלו 30%+ תוך 60 ימי מסחר? כל תכונה וכל זוג תכונות נספרים על 70% הישנים של התאריכים ונבדקים מחדש על 30% החדשים." : "What did stocks look like before they rose 30%+ within 60 sessions? Every trait and every pair of traits is counted on the older 70% of dates and re-checked on the newer 30%."}</p>
        <button onClick={build} disabled={!!busy} className="ms-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-60">{busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}{run ? (he ? "להריץ שוב" : "Run again") : (he ? "להריץ" : "Run")}</button>
      </div>
      {status && <p className="text-[12px] text-muted-foreground">{he ? `דגימות: ${status.samples?.toLocaleString() ?? 0} · מניות שעובדו: ${status.done ?? 0} / ${status.total ?? 0}` : `Samples: ${status.samples?.toLocaleString() ?? 0} · stocks processed: ${status.done ?? 0} / ${status.total ?? 0}`}</p>}
      {busy && <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-muted-foreground"><Loader2 size={14} className="animate-spin text-primary" />{busy}</div>}
      {run && (
        <>
          <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-[12.5px]">{he
            ? <>שיעור הבסיס: <b dir="ltr">{pct(run.base_train)}</b> מהדגימות בתקופה הישנה ו-<b dir="ltr">{pct(run.base_test)}</b> בחדשה (אחרי {run.split_date}) הפכו למנצחות גדולות. "פי 2" פירושו פי שניים מהבסיס — עדיין מיעוט מהמקרים.</>
            : <>Base rate: <b>{pct(run.base_train)}</b> of samples in the older period and <b>{pct(run.base_test)}</b> in the newer one (after {run.split_date}) became big winners. A lift of 2× means twice that — still a minority of cases.</>}</p>
          <section className="rounded-lg border border-border bg-card p-3">
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{he ? "דפוסים שהחזיקו גם בתקופה החדשה" : "Patterns that held up in the newer period"}</h3>
            {held.length === 0 ? <p className="text-muted-foreground">{he ? "שום דפוס לא החזיק — גם זו תוצאה." : "No pattern held up — that's a result too."}</p> : (
              <div className="overflow-x-auto"><table className="w-full text-[12.5px]">
                <thead className="text-[11px] text-muted-foreground"><tr><th className="text-start font-medium">{he ? "הדפוס" : "Pattern"}</th><th className="text-end font-medium">{he ? "פי (ישן)" : "Lift (older)"}</th><th className="text-end font-medium">{he ? "פי (חדש)" : "Lift (newer)"}</th><th className="text-end font-medium">{he ? "מקרים (חדש)" : "Cases (newer)"}</th><th className="text-end font-medium">{he ? "20 יום מול SPY" : "20d vs SPY"}</th></tr></thead>
                <tbody>{held.map((r, i) => (
                  <tr key={i} className="border-t border-border/50 align-top">
                    <td className="py-1.5 pe-2"><RuleText r={r} /></td>
                    <td dir="ltr" className="text-end">{r.lift_train.toFixed(1)}×</td><td dir="ltr" className="text-end font-semibold">{r.lift_test.toFixed(1)}×</td>
                    <td dir="ltr" className="text-end">{r.n_test.toLocaleString()}</td><td dir="ltr" className="text-end">{r.fwd20_test != null ? `${r.fwd20_test > 0 ? "+" : ""}${r.fwd20_test.toFixed(1)}` : "—"}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </section>
          {matches.length > 0 && (
            <section className="rounded-lg border border-border bg-card p-3">
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground"><Search size={11} className="me-1 inline" />{he ? "מניות שמתאימות לדפוסים האלה עכשיו" : "Stocks that fit these patterns now"}</h3>
              <div className="flex flex-wrap gap-1.5">{[...new Set(matches.map((m) => m.symbol))].slice(0, 80).map((s) => <a key={s} href={`/ai?tab=stock&symbol=${s}`} className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[12px] hover:text-primary">{s}</a>)}</div>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">{he ? "רשימה ללימוד, לא איתות: רוב המקרים גם בדפוס חזק לא הופכים למנצחים גדולים." : "A list to study, not a signal: most cases, even in a strong pattern, don't become big winners."}</p>
            </section>
          )}
          {text && <section className="rounded-lg border border-border bg-card p-4"><AiMarkdown text={text} /><div className="mt-2 text-[11px] text-muted-foreground">{run.ai_model}</div></section>}
        </>
      )}
    </div>
  );
}
