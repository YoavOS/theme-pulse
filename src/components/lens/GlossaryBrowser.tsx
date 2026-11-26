import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpenText, ChevronDown, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GLOSSARY_GROUPS } from "@/lib/lens/glossaryMeta";
import { GlossaryOpenContext, useOpenGlossary } from "@/lib/lens/glossaryContext";
import { useLensLang } from "@/lib/lens/i18n";
import { TermBody, matcherFor } from "./Term";

/**
 * All the Fundamentals terms in one place: search, browse by group, open any term to the same
 * explanation its card shows (including what it is for the company on screen). Provides the
 * "All terms" link inside every term card below it.
 */
export function GlossaryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; id?: string; n: number }>({ open: false, n: 0 });
  const open = useCallback((id?: string) => setState((s) => ({ open: true, id, n: s.n + 1 })), []);
  return (
    <GlossaryOpenContext.Provider value={open}>
      {children}
      <GlossaryDialog open={state.open} focusId={state.id} request={state.n} onOpenChange={(o) => setState((s) => ({ ...s, open: o }))} />
    </GlossaryOpenContext.Provider>
  );
}

/** Header button that opens the browser. */
export function GlossaryButton({ className = "" }: { className?: string }) {
  const open = useOpenGlossary();
  const he = useLensLang() === "he";
  if (!open) return null;
  return (
    <button onClick={() => open()} title={he ? "כל המושגים — מילון עם הסברים" : "All terms — glossary with explanations"}
      className={`inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground ${className}`}>
      <BookOpenText size={12} /> {he ? "מושגים" : "Terms"}
    </button>
  );
}

const norm = (s: string) => s.toLowerCase().replace(/[֑-ׇ]/g, "");

function GlossaryDialog({ open, focusId, request, onOpenChange }: { open: boolean; focusId?: string; request: number; onOpenChange: (o: boolean) => void }) {
  const lang = useLensLang(), he = lang === "he";
  const g = matcherFor(lang);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const jump = useCallback((id: string) => {
    setExpanded(id);
    requestAnimationFrame(() => requestAnimationFrame(() => listRef.current?.querySelector(`[data-term="${id}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" })));
  }, []);

  // each open request: clear filters, and go straight to the asked-for term
  useEffect(() => {
    if (!open) return;
    setQ(""); setGroup(null);
    if (focusId) jump(focusId); else setExpanded(null);
  }, [open, request]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const needle = norm(q.trim());
    return GLOSSARY_GROUPS.filter((gr) => !group || gr.key === group).map((gr) => ({
      ...gr,
      entries: gr.ids.map((id) => g.byId.get(id)!).filter((e) => e && (!needle || [e.term, ...(e.also ?? []), e.def].some((s) => norm(s).includes(needle)))),
    })).filter((gr) => gr.entries.length);
  }, [q, group, g]);
  const count = groups.reduce((n, gr) => n + gr.entries.length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={he ? "rtl" : "ltr"} lang={lang} className="flex max-h-[88vh] max-w-2xl flex-col gap-3 overflow-hidden p-4 sm:p-5">
        <DialogHeader className="space-y-1 text-start">
          <DialogTitle className="flex items-center gap-2"><BookOpenText size={17} className="text-primary" /> {he ? "כל המושגים" : "All terms"}</DialogTitle>
          <DialogDescription className="text-[12.5px]">
            {he ? "כל מילה עם קו מנוקד בעדשה נפתחת להסבר. כאן אפשר לחפש ולעבור על כולן." : "Every word with a dotted underline in the Lens opens an explanation. Here you can search and browse all of them."}
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus={!focusId}
            placeholder={he ? "חיפוש מושג, למשל: תזרים, מכפיל, רבעוני" : "Search a term, e.g. cash flow, P/E, QoQ"}
            aria-label={he ? "חיפוש מושג" : "Search terms"}
            className="h-8 w-full rounded-md border border-border bg-muted/30 pe-2 ps-8 text-[13px]" />
        </div>
        <div className="flex flex-wrap gap-1">
          {[{ key: null as string | null, en: "All", he: "הכול" }, ...GLOSSARY_GROUPS].map((gr) => (
            <button key={gr.key ?? "all"} onClick={() => setGroup(gr.key)} aria-pressed={group === gr.key}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${group === gr.key ? "border-primary/60 bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
              {he ? gr.he : gr.en}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-muted-foreground" aria-live="polite">{he ? `${count} מושגים` : `${count} terms`}</div>
        <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto pe-1">
          {groups.map((gr) => (
            <section key={gr.key}>
              <h3 className="sticky top-0 z-[1] bg-background/95 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">{he ? gr.he : gr.en}</h3>
              <ul className="divide-y divide-border/60 rounded-lg border border-border">
                {gr.entries.map((e) => {
                  const isOpen = expanded === e.id;
                  return (
                    <li key={e.id} data-term={e.id} className="scroll-mt-8">
                      <button onClick={() => setExpanded(isOpen ? null : e.id)} aria-expanded={isOpen}
                        className={`flex w-full items-start gap-2 px-3 py-2 text-start hover:bg-muted/30 ${isOpen ? "bg-muted/20" : ""}`}>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium">{e.term}</span>
                          {!isOpen && <span className="block truncate text-[11.5px] text-muted-foreground">{e.def}</span>}
                        </span>
                        <ChevronDown size={13} className={`mt-1 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </button>
                      {isOpen && (
                        <div className="px-3 pb-3 text-[12.5px] leading-snug">
                          <TermBody entry={e} showTitle={false} showAll={false} onRelated={(id) => { setQ(""); setGroup(null); jump(id); }} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {!count && <p className="py-6 text-center text-[13px] text-muted-foreground">{he ? "לא נמצא מושג כזה." : "No matching term."}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
