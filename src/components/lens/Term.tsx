import { Fragment, createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, BookOpenText } from "lucide-react";
import { TermCompanyContext } from "@/lib/lens/termContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GLOSSARY_EN, buildMatcher, type GlossaryEntry, type GlossaryMatcher } from "@/lib/lens/glossary";
import { GLOSSARY_HE } from "@/lib/lens/he/glossary";
import { RELATED, groupOf } from "@/lib/lens/glossaryMeta";
import { useOpenGlossary } from "@/lib/lens/glossaryContext";
import { isoNums, useLensLang } from "@/lib/lens/i18n";

const PlainTermsContext = createContext(false);
/** Inside headings, buttons and other controls: show terms as plain text (no nested clickable term). */
export function PlainTerms({children}:{children:ReactNode}) { return <PlainTermsContext.Provider value={true}>{children}</PlainTermsContext.Provider>; }
let heMatcher: GlossaryMatcher | null = null;
export const matcherFor = (lang: "en" | "he") => (lang === "he" ? (heMatcher ??= buildMatcher(GLOSSARY_HE, true)) : GLOSSARY_EN);

/**
 * A clickable term: dotted underline, click (or tap / Enter) opens a card with what it means, how it's
 * calculated, why it matters, how to read the number, what it is for this company, and related terms
 * (which open in the same card, with Back). Safe inside rows — it doesn't toggle what it sits in.
 */
export function Term({ entry, id, children }: { entry?: GlossaryEntry; id?: string; children?: ReactNode }) {
  const lang = useLensLang();
  const g = matcherFor(lang);
  const e = entry ?? (id ? g.byId.get(id) : undefined);
  const plain = useContext(PlainTermsContext);
  const [open, setOpen] = useState(false);
  const [trail, setTrail] = useState<string[]>([]);   // related terms opened inside this card
  if (!e || plain) return <>{children ?? e?.term}</>;
  const he = lang === "he";
  const stop = (ev: React.SyntheticEvent) => { ev.stopPropagation(); };
  const shown = (trail.length ? g.byId.get(trail[trail.length - 1]) : null) ?? e;
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setTrail([]); }}>
      <PopoverTrigger asChild>
        <span
          role="button" tabIndex={0}
          onClick={(ev) => { ev.stopPropagation(); }}
          onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); ev.currentTarget.click(); } }}
          className="cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-[4px] hover:decoration-solid hover:decoration-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-sm"
          aria-label={he ? `מה זה ${e.term}?` : `What is ${e.term}?`}
        >
          {children ?? e.term}
        </span>
      </PopoverTrigger>
      <PopoverContent dir={he ? "rtl" : "ltr"} lang={he ? "he" : "en"} side="top" align="start" collisionPadding={12}
        className="max-h-[min(70vh,560px)] w-[330px] overflow-y-auto p-3 text-[12.5px] leading-snug" onClick={stop} onPointerDown={stop}>
        {trail.length > 0 && (
          <button onClick={() => setTrail(trail.slice(0, -1))} className="mb-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            {he ? <ArrowRight size={11} /> : <ArrowLeft size={11} />}
            {he ? "חזרה ל" : "Back to "}{(trail.length > 1 ? g.byId.get(trail[trail.length - 2]) : e)?.term}
          </button>
        )}
        <TermBody entry={shown} onRelated={(rid) => setTrail([...trail.filter((x) => x !== rid), rid])} onAll={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The full explanation of one term — used in the term card and in the all-terms browser.
 * `onRelated` opens a related term in place; `onAll` runs before jumping to the all-terms browser
 * (hide that link with `showAll={false}` inside the browser itself).
 */
export function TermBody({ entry: e, onRelated, onAll, showTitle = true, showAll = true }: {
  entry: GlossaryEntry; onRelated?: (id: string) => void; onAll?: () => void; showTitle?: boolean; showAll?: boolean;
}) {
  const lang = useLensLang(), he = lang === "he";
  const g = matcherFor(lang);
  const forCompany = useContext(TermCompanyContext);
  const openAll = useOpenGlossary();
  const txt = (s: string) => (he ? isoNums(s) : s);
  const group = groupOf(e.id);
  const related = (RELATED[e.id] ?? []).map((id) => g.byId.get(id)).filter((x): x is GlossaryEntry => !!x);
  return (
    <div className="space-y-2">
      {showTitle && (
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[13.5px] font-semibold text-foreground">{e.term}</div>
          {group && <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{he ? group.he : group.en}</span>}
        </div>
      )}
      <p className="text-foreground/90">{txt(e.def)}</p>
      {e.formula && (
        <div className="rounded-md bg-muted/40 px-2 py-1.5">
          <div className="text-[10.5px] font-semibold text-muted-foreground">{he ? "איך מחשבים" : "How it's calculated"}</div>
          <div className="mt-0.5 font-mono text-[11.5px] text-foreground/90" dir="auto">{e.formula}</div>
        </div>
      )}
      {e.why && <Labeled label={he ? "למה זה חשוב" : "Why it matters"}>{txt(e.why)}</Labeled>}
      {e.read && <Labeled label={he ? "איך לקרוא את המספר" : "How to read it"}>{txt(e.read)}</Labeled>}
      <CompanyLines id={e.id} get={forCompany} he={he} />
      {related.length > 0 && onRelated && (
        <div className="border-t border-border/60 pt-2">
          <div className="mb-1 text-[10.5px] font-semibold text-muted-foreground">{he ? "כדאי לקרוא גם" : "Read it with"}</div>
          <div className="flex flex-wrap gap-1">
            {related.map((r) => (
              <button key={r.id} onClick={() => onRelated(r.id)}
                className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[11px] text-foreground/85 hover:border-primary/50 hover:bg-primary/10 hover:text-foreground">
                {r.term}
              </button>
            ))}
          </div>
        </div>
      )}
      {showAll && openAll && (
        <button onClick={() => { onAll?.(); openAll(e.id); }} className="inline-flex items-center gap-1 pt-0.5 text-[11px] text-primary hover:underline">
          <BookOpenText size={11} /> {he ? "כל המושגים" : "All terms"}
        </button>
      )}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return <p className="text-muted-foreground"><span className="font-semibold text-foreground/80">{label}: </span>{children}</p>;
}

/** "For SYMBOL: …" — the company's own number, in plain words and against its industry. */
function CompanyLines({ id, get, he }: { id: string; get: ((entryId: string) => { symbol: string; lines: string[] } | null) | null; he: boolean }) {
  const note = get?.(id);
  if (!note) return null;
  return (
    <div className="space-y-1 rounded-md border border-primary/25 bg-primary/[0.06] p-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">{he ? <>ב-<bdi>{note.symbol}</bdi></> : `For ${note.symbol}`}</div>
      {note.lines.map((l, i) => <p key={i} className={i === 0 ? "text-foreground" : "text-foreground/85"}>{l}</p>)}
    </div>
  );
}

/**
 * Plain text with every glossary term made clickable (the first time each term appears in this
 * piece of text, so a paragraph doesn't turn into a wall of underlines).
 * `skip` lists entry ids not to link here (e.g. the term a card is already about).
 * In Hebrew it also keeps numbers left-to-right inside the right-to-left text.
 */
export function AutoTerms({ text, skip }: { text: string | null | undefined; skip?: string[] }) {
  const lang = useLensLang();
  const parts = useMemo(() => {
    if (!text) return [] as ReactNode[];
    const g = matcherFor(lang);
    const plain = (s: string) => (g.prefixed ? isoNums(s) : s);
    const out: ReactNode[] = [];
    const seen = new Set(skip ?? []);
    let last = 0, k = 0;
    const re = new RegExp(g.re.source, g.re.flags);
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const word = m[2];
      const e = g.entryFor(word);
      if (!e || seen.has(e.id)) continue;
      seen.add(e.id);
      const start = m.index + (m[1]?.length ?? 0);
      if (start > last) out.push(plain(text.slice(last, start)));
      out.push(<Term key={k++} entry={e}>{word}</Term>);
      last = start + word.length;
    }
    if (last < text.length) out.push(plain(text.slice(last)));
    return out;
  }, [text, skip, lang]);
  if (!text) return null;
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}
