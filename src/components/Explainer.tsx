import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type Tone = "good" | "bad" | "warn" | "neutral";
const TONE: Record<Tone, string> = {
  good: "border-gain-medium/40 bg-gain-medium/[0.07]",
  bad: "border-loss-medium/40 bg-loss-medium/[0.07]",
  warn: "border-[hsl(40,90%,55%)]/40 bg-[hsl(40,90%,55%)]/[0.07]",
  neutral: "border-border bg-card",
};
const DOT: Record<Tone, string> = {
  good: "bg-gain-medium", bad: "bg-loss-medium", warn: "bg-[hsl(40,90%,55%)]", neutral: "bg-muted-foreground",
};

/** The one-glance summary at the top of a tab: a headline and up to a few short lines. */
export function BottomLine({ tone = "neutral", title, lines, children }: { tone?: Tone; title: ReactNode; lines?: ReactNode[]; children?: ReactNode }) {
  return (
    <section className={`rounded-lg border px-4 py-3 ${TONE[tone]}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[tone]}`} />
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground">Bottom line</span>
      </div>
      <div className="mt-1 text-base font-semibold leading-snug">{title}</div>
      {lines && lines.filter(Boolean).length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-sm text-muted-foreground">
          {lines.filter(Boolean).map((l, i) => <li key={i} className="flex gap-2"><span className="text-muted-foreground/60">›</span><span>{l}</span></li>)}
        </ul>
      )}
      {children}
    </section>
  );
}

/** Method, evidence and reading notes — closed by default so the page stays short. */
export function HowItWorks({ title = "How this works & the evidence", children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-md border border-border/60 ${className}`}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground">
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-0" : "-rotate-90"}`} />
        {title}
      </button>
      {open && <div className="space-y-2 border-t border-border/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">{children}</div>}
    </div>
  );
}

/** Sticky row of jump links for long pages (each target needs a matching id and scroll-mt). */
export function SectionNav({ items }: { items: { id: string; label: string }[] }) {
  return (
    <nav className="sticky top-0 z-20 -mx-4 border-b border-border/60 bg-background/85 px-4 py-1.5 backdrop-blur-md">
      <div className="flex gap-1 overflow-x-auto">
        {items.map((it) => (
          <a
            key={it.id}
            href={`#${it.id}`}
            onClick={(e) => { e.preventDefault(); document.getElementById(it.id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
            className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            {it.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

/** A section that can be folded away (e.g. long tables most people don't need every time). */
export function Fold({ title, hint, defaultOpen = false, children }: { title: ReactNode; hint?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-lg border border-border bg-card">
      <button onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-3 text-left">
        <ChevronDown size={16} className={`shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
        <span className="text-sm font-semibold">{title}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </button>
      {open && <div className="border-t border-border px-4 py-3">{children}</div>}
    </section>
  );
}
