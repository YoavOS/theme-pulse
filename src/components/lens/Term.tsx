import { Fragment, useMemo, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GLOSSARY_BY_ID, GLOSSARY_RE, entryFor, type GlossaryEntry } from "@/lib/lens/glossary";

/**
 * A clickable term: dotted underline, click (or tap / Enter) opens a short plain-language
 * explanation. Safe inside buttons and rows — it doesn't toggle what it sits in.
 */
export function Term({ entry, id, children }: { entry?: GlossaryEntry; id?: string; children?: ReactNode }) {
  const e = entry ?? (id ? GLOSSARY_BY_ID.get(id) : undefined);
  if (!e) return <>{children}</>;
  const stop = (ev: React.SyntheticEvent) => { ev.stopPropagation(); };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span
          role="button" tabIndex={0}
          onClick={(ev) => { ev.stopPropagation(); }}
          onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") ev.stopPropagation(); }}
          className="cursor-help underline decoration-dotted decoration-from-font underline-offset-[3px] hover:decoration-solid hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-sm"
          aria-label={`What is ${e.term}?`}
        >
          {children ?? e.term}
        </span>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-[300px] space-y-1.5 p-3 text-[12.5px] leading-snug" onClick={stop} onPointerDown={stop}>
        <div className="text-[13px] font-semibold text-foreground">{e.term}</div>
        <p className="text-foreground/90">{e.def}</p>
        {e.why && <p className="text-muted-foreground"><span className="font-semibold text-foreground/80">Why it matters: </span>{e.why}</p>}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Plain text with every glossary term made clickable (the first time each term appears in this
 * piece of text, so a paragraph doesn't turn into a wall of underlines).
 * `skip` lists entry ids not to link here (e.g. the term a card is already about).
 */
export function AutoTerms({ text, skip }: { text: string | null | undefined; skip?: string[] }) {
  const parts = useMemo(() => {
    if (!text) return [] as ReactNode[];
    const out: ReactNode[] = [];
    const seen = new Set(skip ?? []);
    let last = 0, k = 0;
    GLOSSARY_RE.lastIndex = 0;
    for (let m = GLOSSARY_RE.exec(text); m; m = GLOSSARY_RE.exec(text)) {
      const e = entryFor(m[0]);
      if (!e || seen.has(e.id)) continue;
      seen.add(e.id);
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push(<Term key={k++} entry={e}>{m[0]}</Term>);
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }, [text, skip]);
  if (!text) return null;
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}
