import { useState, type ReactNode } from "react";
import { AutoTerms } from "./Term";
import { CHART } from "./QuarterlyChart";

/**
 * The Company story's design language, shared by every Lens tab:
 * a gradient hero (eyebrow · data-written headline · prose) with a key-figures panel and a
 * 01/02/03 strip of the questions the page answers; section heads; panels; an amber "watch" box.
 */

export interface Kpi { label: string; value: string; caption?: string; tone?: "auto" | "neutral" | "warn" }
export interface Step { label: string; question: string; target?: string }

const toneColor = (k: Kpi) => k.tone === "neutral" ? undefined : k.tone === "warn" ? CHART.growth
  : /^[-−]/.test(k.value) ? CHART.negative : k.value === "—" ? undefined : CHART.positive;

export function Hero({ eyebrow, title, meta, children, aside, steps }: {
  eyebrow: string; title: string; meta?: ReactNode; children?: ReactNode;
  aside?: { title: string; subtitle?: string; items: Kpi[]; footer?: ReactNode };
  steps?: Step[];
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 via-card to-card">
      <div className={`grid gap-6 p-5 lg:p-7 ${aside ? "lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]" : ""}`}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">{eyebrow}</p>
          <h1 className="mt-3 max-w-4xl text-2xl font-semibold leading-tight lg:text-3xl">{title}</h1>
          {meta && <p className="mt-3 text-sm text-muted-foreground">{meta}</p>}
          {children && <div className="mt-5 space-y-3 text-[15px] leading-relaxed">{children}</div>}
        </div>
        {aside && <KpiPanel {...aside} />}
      </div>
      {steps && steps.length > 0 && (
        <div className={`grid gap-px border-t border-border bg-border ${steps.length === 4 ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
          {steps.map((s) => {
            const body = <><span className="text-xs text-primary">{s.label}</span><p className="mt-1 text-sm">{s.question}</p></>;
            return s.target
              ? <button key={s.label} onClick={() => document.getElementById(s.target!)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  className="bg-card px-5 py-3 text-start transition-colors hover:bg-muted/40">{body}</button>
              : <div key={s.label} className="bg-card px-5 py-3">{body}</div>;
          })}
        </div>
      )}
    </section>
  );
}

export function KpiPanel({ title, subtitle, items, footer }: { title: string; subtitle?: string; items: Kpi[]; footer?: ReactNode }) {
  return (
    <aside className="rounded-xl border border-border bg-background/40 p-4">
      <h2 className="font-semibold">{title}</h2>
      {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
      <div className="mt-4 grid grid-cols-2 gap-4">
        {items.map((k) => (
          <div key={k.label}>
            <p className="text-xs text-muted-foreground"><AutoTerms text={k.label} /></p>
            <p className="mt-1 font-mono text-xl" dir="ltr" style={{ color: toneColor(k) }}>{k.value}</p>
            {k.caption && <p className="mt-1 text-xs text-muted-foreground">{k.caption}</p>}
          </div>
        ))}
      </div>
      {footer && <div className="mt-4 border-t border-border pt-3 text-sm">{footer}</div>}
    </aside>
  );
}

/** Section title with a one-line subtitle and an optional action on the right. `id` is a jump target for the hero steps. */
export function SectionHead({ id, title, subtitle, action }: { id?: string; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div id={id} className="flex scroll-mt-4 flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground"><AutoTerms text={subtitle} /></p>}
      </div>
      {action}
    </div>
  );
}

/** A context panel: eyebrow, title, body. */
export function Panel({ id, eyebrow, title, children, className = "" }: { id?: string; eyebrow?: string; title?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`min-w-0 scroll-mt-4 rounded-2xl border border-border bg-card/40 p-5 ${className}`}>
      {eyebrow && <p className="text-xs uppercase tracking-wider text-primary">{eyebrow}</p>}
      {title && <h2 className={`${eyebrow ? "mt-2" : ""} text-xl font-semibold`}>{title}</h2>}
      <div className={title || eyebrow ? "mt-3" : ""}>{children}</div>
    </section>
  );
}

/** The amber "watch this" box. */
export function Watch({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-sm leading-relaxed">{children}</div>;
}

/** "Go deeper" accordion, as at the bottom of the Company story. */
export function More({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="min-w-0 rounded-xl border border-border bg-card/30">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full justify-between gap-3 p-4 text-start text-sm font-semibold">
        {title}<span aria-hidden>{open ? "−" : "+"}</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}
