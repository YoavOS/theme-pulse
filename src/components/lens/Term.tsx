import { Fragment, useContext, useMemo, type ReactNode } from "react";
import { TermCompanyContext } from "@/lib/lens/termContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GLOSSARY_EN, buildMatcher, type GlossaryEntry, type GlossaryMatcher } from "@/lib/lens/glossary";
import { GLOSSARY_HE } from "@/lib/lens/he/glossary";
import { isoNums, useLensLang } from "@/lib/lens/i18n";

let heMatcher: GlossaryMatcher | null = null;
const matcherFor = (lang: "en" | "he") => (lang === "he" ? (heMatcher ??= buildMatcher(GLOSSARY_HE, true)) : GLOSSARY_EN);

/**
 * A clickable term: dotted underline, click (or tap / Enter) opens a short plain-language
 * explanation. Safe inside buttons and rows — it doesn't toggle what it sits in.
 */
export function Term({ entry, id, children }: { entry?: GlossaryEntry; id?: string; children?: ReactNode }) {
  const lang = useLensLang();
  const g = matcherFor(lang);
  const e = entry ?? (id ? g.byId.get(id) : undefined);
  const forCompany = useContext(TermCompanyContext);
  if (!e) return <>{children}</>;
  const he = lang === "he";
  const stop = (ev: React.SyntheticEvent) => { ev.stopPropagation(); };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span
          role="button" tabIndex={0}
          onClick={(ev) => { ev.stopPropagation(); }}
          onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") ev.stopPropagation(); }}
          className="cursor-help underline decoration-dotted decoration-from-font underline-offset-[3px] hover:decoration-solid hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-sm"
          aria-label={he ? `מה זה ${e.term}?` : `What is ${e.term}?`}
        >
          {children ?? e.term}
        </span>
      </PopoverTrigger>
      <PopoverContent dir={he ? "rtl" : "ltr"} lang={he ? "he" : "en"} side="top" align="start" className="w-[300px] space-y-1.5 p-3 text-[12.5px] leading-snug" onClick={stop} onPointerDown={stop}>
        <div className="text-[13px] font-semibold text-foreground">{e.term}</div>
        <p className="text-foreground/90">{he ? isoNums(e.def) : e.def}</p>
        {e.why && <p className="text-muted-foreground"><span className="font-semibold text-foreground/80">{he ? "למה זה חשוב: " : "Why it matters: "}</span>{he ? isoNums(e.why) : e.why}</p>}
        <CompanyLines id={e.id} get={forCompany} he={he} />
      </PopoverContent>
    </Popover>
  );
}

/** "For SYMBOL: …" — the company's own number, in plain words and against its industry. */
function CompanyLines({ id, get, he }: { id: string; get: ((entryId: string) => { symbol: string; lines: string[] } | null) | null; he: boolean }) {
  const note = get?.(id);
  if (!note) return null;
  return (
    <div className="mt-1 space-y-1 rounded-md border border-primary/25 bg-primary/[0.06] p-2">
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
