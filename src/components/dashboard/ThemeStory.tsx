import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BookOpen, ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { ThemeData } from "@/data/themeData";

const DM_MONO = "'DM Mono', monospace";
const MAX_AGE_MS = 7 * 24 * 3600_000;
const VERSION = 1;

interface Story {
  headline: string;
  phase?: "early" | "building" | "mature" | "fading" | "unclear";
  phase_reason?: string;
  story: string[];
  concepts?: { term: string; explain: string }[];
  drivers?: { title: string; detail: string; date?: string | null; refs?: number[] }[];
  how_it_reaches_stocks?: { who: string; how: string }[];
  price_check?: string;
  risks?: { risk: string; explain: string }[];
  watch?: { event: string; when?: string | null; why: string }[];
}
interface Sources {
  headlines?: { n: number; title: string; url: string; source: string | null; date: string | null }[];
  web?: { title: string | null; url: string }[];
}
interface Loaded { story: Story; sources: Sources | null; createdAt: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = () => (supabase as any).from("theme_narratives");
const mem = new Map<string, Loaded>();

const PHASE: Record<string, { label: string; cls: string }> = {
  early: { label: "Early", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  building: { label: "Building", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  mature: { label: "Mature", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  fading: { label: "Fading", cls: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  unclear: { label: "Unclear", cls: "bg-white/5 text-muted-foreground border-white/10" },
};

/** Text with [n] references turned into small links to the numbered headlines. */
function Cited({ text, sources }: { text: string; sources: Sources | null }) {
  const parts: ReactNode[] = [];
  const re = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    parts.push(text.slice(last, m.index));
    m[1].split(",").map((x) => Number(x.trim())).forEach((n, i) => {
      const h = sources?.headlines?.find((s) => s.n === n);
      parts.push(h
        ? <a key={`${m!.index}-${i}`} href={h.url} target="_blank" rel="noreferrer" title={h.title} className="ml-0.5 align-super text-[9px] text-primary hover:underline">{n}</a>
        : <span key={`${m!.index}-${i}`} className="ml-0.5 align-super text-[9px] text-muted-foreground">{n}</span>);
    });
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[9.5px] uppercase tracking-widest text-muted-foreground" style={{ fontFamily: DM_MONO }}>{title}</div>
      {children}
    </div>
  );
}

/** The narrative behind a group, inside the Theme Strength Meter ("i" panel). */
export default function ThemeStory({ theme, mode }: { theme: ThemeData; mode: string }) {
  const key = `${mode}:${theme.theme_name.toLowerCase()}`;
  const [data, setData] = useState<Loaded | null>(() => mem.get(key) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showSources, setShowSources] = useState(false);

  const generate = useCallback(async (refresh: boolean) => {
    setLoading(true); setError(null);
    try {
      const valid = theme.tickers.filter((t) => !t.skipped);
      const symbols = [...valid].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 12).map((t) => ({ symbol: t.symbol, pct: t.pct }));
      const up = valid.filter((t) => t.pct > 0).length;
      const stats = {
        performance_pct: theme.performance_pct, up, total: valid.length,
        perf_1d: theme.perf_1d ?? null, perf_1w: theme.perf_1w ?? null, perf_1m: theme.perf_1m ?? null, perf_3m: theme.perf_3m ?? null,
      };
      const { data: r, error: e } = await supabase.functions.invoke("theme-story", { body: { name: theme.theme_name, mode, symbols, stats, refresh } });
      if (e) throw new Error(e.message);
      if (r?.error) throw new Error(r.error);
      const loaded: Loaded = { story: r.story, sources: r.sources ?? null, createdAt: r.createdAt };
      mem.set(key, loaded);
      setData(loaded);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [theme, mode, key]);

  // Saved story first (one small read); write a new one only when there is none or it's a week old.
  useEffect(() => {
    let cancelled = false;
    setExpanded(false); setShowSources(false); setError(null);
    const m = mem.get(key);
    if (m) { setData(m); return; }
    setData(null);
    (async () => {
      const { data: row } = await table().select("story, sources, created_at, version").eq("key", key).maybeSingle();
      if (cancelled) return;
      if (row?.story && row.version === VERSION) {
        const loaded: Loaded = { story: row.story, sources: row.sources, createdAt: row.created_at };
        mem.set(key, loaded);
        setData(loaded);
        if (Date.now() - Date.parse(row.created_at) < MAX_AGE_MS) return;
      }
      void generate(false);
    })().catch(() => { if (!cancelled) void generate(false); });
    return () => { cancelled = true; };
  }, [key, generate]);

  const s = data?.story;
  const src = data?.sources ?? null;
  const phase = PHASE[s?.phase ?? "unclear"] ?? PHASE.unclear;
  const age = data ? new Date(data.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;

  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.03]">
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2">
        <h4 className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground" style={{ fontFamily: DM_MONO }}>
          <BookOpen size={11} className="text-primary" /> The story
        </h4>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {age && <span title="Stories are rewritten weekly">written {age}</span>}
          <button
            onClick={() => void generate(true)}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-foreground disabled:opacity-50"
            title="Rewrite the story with the latest news"
          >
            <RefreshCw size={10} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      <div className="space-y-3 px-3 py-3 text-[13px] leading-relaxed text-foreground/90">
        {!s && loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={12} className="animate-spin" /> Reading the news and writing the story (about 20–40 seconds, once a week)…
          </div>
        )}
        {error && <div className="text-xs text-loss-strong">{error}</div>}
        {s && (
          <>
            <div className="flex items-start gap-2">
              <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${phase.cls}`} title={s.phase_reason}>{phase.label}</span>
              <p className="font-semibold text-foreground">{s.headline}</p>
            </div>
            {s.story.slice(0, expanded ? undefined : 1).map((p, i) => <p key={i}><Cited text={p} sources={src} /></p>)}

            {expanded && (
              <div className="space-y-4 pt-1">
                {s.phase_reason && <p className="text-xs text-muted-foreground"><span className="text-foreground">Phase — {phase.label}:</span> {s.phase_reason}</p>}

                {!!s.concepts?.length && (
                  <Section title="Key ideas explained">
                    <dl className="space-y-2">
                      {s.concepts.map((c) => (
                        <div key={c.term} className="rounded-md bg-white/[0.04] px-2.5 py-2">
                          <dt className="text-xs font-semibold text-foreground">{c.term}</dt>
                          <dd className="text-xs text-foreground/80">{c.explain}</dd>
                        </div>
                      ))}
                    </dl>
                  </Section>
                )}

                {!!s.drivers?.length && (
                  <Section title="What's driving it now">
                    <ul className="space-y-2">
                      {s.drivers.map((d, i) => (
                        <li key={i} className="border-l-2 border-primary/40 pl-2.5">
                          <div className="text-xs font-semibold text-foreground">
                            {d.title}{d.date && <span className="ml-1.5 font-normal text-muted-foreground" style={{ fontFamily: DM_MONO }}>{d.date}</span>}
                            {d.refs?.length ? <Cited text={` [${d.refs.join(",")}]`} sources={src} /> : null}
                          </div>
                          <div className="text-xs text-foreground/80"><Cited text={d.detail} sources={src} /></div>
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}

                {!!s.how_it_reaches_stocks?.length && (
                  <Section title="How it reaches the stocks">
                    <ul className="space-y-1.5 text-xs">
                      {s.how_it_reaches_stocks.map((h, i) => (
                        <li key={i}><span className="font-semibold text-foreground">{h.who}:</span> <span className="text-foreground/80"><Cited text={h.how} sources={src} /></span></li>
                      ))}
                    </ul>
                  </Section>
                )}

                {s.price_check && (
                  <Section title="Does the market agree?">
                    <p className="text-xs text-foreground/80">{s.price_check}</p>
                  </Section>
                )}

                {!!s.risks?.length && (
                  <Section title="What could break it">
                    <ul className="space-y-1.5 text-xs">
                      {s.risks.map((r, i) => <li key={i}><span className="font-semibold text-foreground">{r.risk}:</span> <span className="text-foreground/80"><Cited text={r.explain} sources={src} /></span></li>)}
                    </ul>
                  </Section>
                )}

                {!!s.watch?.length && (
                  <Section title="What to watch">
                    <ul className="space-y-1.5 text-xs">
                      {s.watch.map((w, i) => (
                        <li key={i}>
                          <span className="font-semibold text-foreground">{w.event}</span>
                          {w.when && <span className="ml-1.5 text-muted-foreground" style={{ fontFamily: DM_MONO }}>{w.when}</span>}
                          <span className="text-foreground/80"> — <Cited text={w.why} sources={src} /></span>
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}

                {(src?.headlines?.length || src?.web?.length) ? (
                  <div>
                    <button onClick={() => setShowSources((v) => !v)} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                      <ChevronDown size={11} className={`transition ${showSources ? "rotate-180" : ""}`} /> Sources ({(src?.headlines?.length ?? 0) + (src?.web?.length ?? 0)})
                    </button>
                    {showSources && (
                      <ol className="mt-1.5 space-y-1 text-[11px]">
                        {src?.headlines?.map((h) => (
                          <li key={h.n} className="flex gap-1.5">
                            <span className="w-5 shrink-0 text-right text-muted-foreground">{h.n}.</span>
                            <a href={h.url} target="_blank" rel="noreferrer" className="text-foreground/80 hover:text-primary hover:underline">
                              {h.title}<span className="text-muted-foreground"> · {h.source ?? ""}{h.date ? ` · ${h.date}` : ""}</span>
                            </a>
                          </li>
                        ))}
                        {src?.web?.map((w, i) => (
                          <li key={`w${i}`} className="flex gap-1.5">
                            <span className="w-5 shrink-0 text-right text-muted-foreground">↗</span>
                            <a href={w.url} target="_blank" rel="noreferrer" className="text-foreground/80 hover:text-primary hover:underline">{w.title ?? w.url}</a>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                ) : null}
                <p className="text-[10px] text-muted-foreground">Written by AI from the listed news and web sources; background explanations use general knowledge. Not investment advice.</p>
              </div>
            )}

            <button onClick={() => setExpanded((v) => !v)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              <ChevronDown size={12} className={`transition ${expanded ? "rotate-180" : ""}`} /> {expanded ? "Show less" : "Read the full story"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
