import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, BarChart3, Bot, ChevronDown, Cpu, Cloud, FileText, FileSearch, ListChecks, Loader2, NotebookPen, Sparkles, MessageSquare, RefreshCw, Search, Send, LineChart, Sunrise } from "lucide-react";
import TodayList from "@/components/ai/TodayList";
import FocusReview from "@/components/ai/FocusReview";
import FilingsView from "@/components/ai/FilingsView";
import PatternsView from "@/components/ai/PatternsView";
import JournalView from "@/components/ai/JournalView";
import { touchLab, useLabUsage } from "@/lib/labs";
import { toast } from "sonner";
import AiMarkdown from "@/components/ai/AiMarkdown";
import {
  aiLatest, aiStatus, aiStock, aiWriteReport, askAi, readAiLang, saveAiLang,
  type AiLang, type AiReport, type AiStatus, type AiStep,
} from "@/lib/ai";

/**
 * AI Analyst (/ai). The AI on your PC (Ollama) reads the app's own data: tonight's market report,
 * ask-your-data chat, and a one-stock analysis. Falls back to the free cloud keys when the PC model is off.
 */
type Tab = "today" | "report" | "ask" | "stock" | "filings" | "focus" | "patterns" | "journal";
const TABS: { id: Tab; label: string; he: string; icon: JSX.Element }[] = [
  { id: "today", label: "Today's list", he: "הרשימה של היום", icon: <Sunrise size={14} /> },
  { id: "report", label: "Market report", he: "דוח שוק", icon: <FileText size={14} /> },
  { id: "ask", label: "Ask your data", he: "שאלו את הנתונים", icon: <MessageSquare size={14} /> },
  { id: "stock", label: "One stock", he: "מניה אחת", icon: <LineChart size={14} /> },
  { id: "filings", label: "From the filings", he: "מתוך הדוחות", icon: <FileSearch size={14} /> },
  { id: "patterns", label: "Pattern finder", he: "מוצא הדפוסים", icon: <Sparkles size={14} /> },
  { id: "journal", label: "Journal review", he: "סקירת היומן", icon: <NotebookPen size={14} /> },
  { id: "focus", label: "Focus-list review", he: "סקירת רשימת המעקב", icon: <ListChecks size={14} /> },
];

export default function AiAnalyst() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => (TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") as Tab : "today"));
  const [lang, setLangState] = useState<AiLang>(readAiLang);
  const setLang = (l: AiLang) => { setLangState(l); saveAiLang(l); };
  const [status, setStatus] = useState<AiStatus | null>(null);
  useEffect(() => { aiStatus().then(setStatus).catch(() => setStatus(null)); }, []);
  useEffect(() => { document.title = "AI Analyst"; touchLab("ai-analyst"); }, []);
  const go = (t: Tab) => { setTab(t); const p = new URLSearchParams(params); p.set("tab", t); if (t !== "stock") p.delete("symbol"); setParams(p, { replace: true }); };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-3 backdrop-blur lg:px-6">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-2">
          <Link to="/" title="Back to Dashboard" className="mr-1 rounded-md border border-border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><ArrowLeft size={15} /></Link>
          <Bot size={20} className="text-[hsl(160,70%,50%)]" />
          <h1 className="mr-3 font-['Syne',sans-serif] text-2xl font-bold tracking-tight">AI Analyst</h1>
          <StatusChip status={status} />
          <UsageButton />
          <div className="ml-auto flex overflow-hidden rounded-md border border-border text-[12px]" role="group" aria-label="Language">
            {(["en", "he"] as AiLang[]).map((l) => (
              <button key={l} onClick={() => setLang(l)} className={`px-2.5 py-1 ${lang === l ? "bg-primary/15 font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                {l === "en" ? "English" : "עברית"}
              </button>
            ))}
          </div>
        </div>
        <nav className="mx-auto mt-3 flex max-w-[1100px] gap-1" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => go(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium ${tab === t.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
              {t.icon}{lang === "he" ? t.he : t.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-[1100px] px-4 py-5 lg:px-6">
        {tab === "today" && <TodayList lang={lang} />}
        {tab === "focus" && <FocusReview lang={lang} />}
        {tab === "filings" && <FilingsView lang={lang} />}
        {tab === "patterns" && <PatternsView lang={lang} />}
        {tab === "journal" && <JournalView lang={lang} />}
        {tab === "report" && <ReportView lang={lang} />}
        {tab === "ask" && <AskView lang={lang} />}
        {tab === "stock" && <StockView lang={lang} initial={params.get("symbol")} onSymbol={(s) => { const p = new URLSearchParams(params); p.set("tab", "stock"); p.set("symbol", s); setParams(p, { replace: true }); }} />}
      </main>
    </div>
  );
}

const USAGE_NAMES: Record<string, string> = {
  "today-list": "Today's list", "ai-analyst": "AI tab opened", "ai-report": "Market report", "ai-ask": "Ask your data",
  "ai-stock": "One stock", "ai-focus": "Focus-list review", filings: "From the filings", patterns: "Pattern finder", journal: "Journal review",
};
/** How often each section has been used — for deciding later what to keep, move or delete. */
function UsageButton() {
  const [open, setOpen] = useState(false);
  const u = useLabUsage();
  return (
    <span className="relative">
      <button onClick={() => setOpen(!open)} title="How often you've used each section" className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11.5px] text-muted-foreground hover:text-foreground"><BarChart3 size={12} /> Usage</button>
      {open && (
        <div className="absolute left-0 top-7 z-20 w-72 rounded-lg border border-border bg-popover p-3 text-[12px] shadow-lg">
          <div className="mb-1.5 font-semibold">Trial usage</div>
          {Object.entries(USAGE_NAMES).map(([id, name]) => {
            const r = u.data?.get(id);
            return <div key={id} className="flex justify-between py-0.5"><span>{name}</span><span className="text-muted-foreground">{r?.uses ?? 0}{r?.last_used ? ` · last ${new Date(r.last_used).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}</span></div>;
          })}
          <p className="mt-2 text-[11px] text-muted-foreground">After a few weeks we decide what to keep, move elsewhere in the app, or delete.</p>
        </div>
      )}
    </span>
  );
}

function StatusChip({ status }: { status: AiStatus | null }) {
  if (!status) return <span className="text-[11.5px] text-muted-foreground">checking the AI…</span>;
  const l = status.local;
  if (l.configured && l.reachable) {
    return <span title={`Installed: ${(l.installed ?? []).join(", ")}`} className="inline-flex items-center gap-1 rounded-full border border-[hsl(160,70%,45%)]/40 bg-[hsl(160,70%,45%)]/10 px-2 py-0.5 text-[11.5px] text-[hsl(160,70%,55%)]"><Cpu size={12} /> On your PC · {l.model}</span>;
  }
  return (
    <span title={l.configured ? `The PC model didn't answer: ${l.error ?? ""}` : "Ollama isn't set up — restart with Start Theme Pulse to set it up."}
      className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11.5px] text-muted-foreground">
      <Cloud size={12} /> {status.cloudFallback ? "Cloud AI (PC model off)" : "No AI set up"}
    </span>
  );
}

const Busy = ({ text }: { text: string }) => (
  <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-[13px] text-muted-foreground"><Loader2 size={15} className="animate-spin text-primary" />{text}</div>
);
const ago = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

// ------------------------------------------------------------------ market report
function ReportView({ lang }: { lang: AiLang }) {
  const [reports, setReports] = useState<AiReport[] | null>(null);
  const [pick, setPick] = useState(0);
  const [writing, setWriting] = useState(false);
  const load = useCallback(() => { aiLatest("market", lang, undefined, 10).then((r) => { setReports(r); setPick(0); }).catch((e) => { toast.error(e.message); setReports([]); }); }, [lang]);
  useEffect(() => { setReports(null); load(); }, [load]);
  useEffect(() => { touchLab("ai-report"); }, []);
  const write = async () => {
    touchLab("ai-report");
    setWriting(true);
    try { await aiWriteReport(lang); load(); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setWriting(false); }
  };
  const r = reports?.[pick];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        {reports && reports.length > 1 && (
          <select value={pick} onChange={(e) => setPick(Number(e.target.value))} className="h-8 rounded-md border border-border bg-background px-2">
            {reports.map((x, i) => <option key={x.id} value={i}>{x.day}</option>)}
          </select>
        )}
        <span className="text-muted-foreground">{lang === "he" ? "נכתב אוטומטית כל ערב מסחר אחרי הסריקה הלילית." : "Written automatically every trading night after the nightly scans."}</span>
        <button onClick={write} disabled={writing} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 font-medium text-primary hover:bg-primary/20 disabled:opacity-60">
          {writing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}{lang === "he" ? "כתוב עכשיו" : "Write it now"}
        </button>
      </div>
      {writing && <Busy text={lang === "he" ? "ה-AI קורא את נתוני היום וכותב (1–3 דקות)…" : "The AI is reading today's data and writing (1–3 minutes)…"} />}
      {reports === null ? <Busy text="Loading…" /> : !r ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
          {lang === "he" ? "אין עדיין דוח. לחצו על \"כתוב עכשיו\"." : "No report yet. Press \"Write it now\"."}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="mb-3 flex flex-wrap items-baseline gap-2 border-b border-border pb-2">
            <h2 className="text-lg font-semibold">{r.title}</h2>
            <span className="text-[11.5px] text-muted-foreground">{ago(r.created_at)} · {r.model}</span>
          </div>
          <AiMarkdown text={r.content} />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ask your data
interface Msg { role: "user" | "assistant"; content: string; steps?: AiStep[]; model?: string }
const SUGGEST: Record<AiLang, string[]> = {
  en: [
    "Which industries have the most stocks that entered stage 2 in the last 4 weeks?",
    "Show stage 2 stocks within 3% of their pivot with a stop risk under 6%, strongest RS first.",
    "Which proven-strong businesses are in stage 2 with RS above 80?",
    "Historically, how did stocks that entered stage 2 do after 8 weeks versus SPY?",
    "Which of my themes are strengthening this week and which are fading?",
  ],
  he: [
    "באילו תעשיות יש הכי הרבה מניות שנכנסו לשלב 2 בארבעת השבועות האחרונים?",
    "הראה מניות בשלב 2 במרחק של עד 3% מנקודת הפריצה עם סיכון סטופ מתחת ל-6%.",
    "אילו עסקים עם רקורד מוכח נמצאים בשלב 2 עם RS מעל 80?",
    "היסטורית, איך הצליחו מניות שנכנסו לשלב 2 אחרי 8 שבועות לעומת SPY?",
    "אילו מהתמות שלי מתחזקות השבוע ואילו נחלשות?",
  ],
};

function AskView({ lang }: { lang: AiLang }) {
  const [msgs, setMsgs] = useState<Msg[]>(() => { try { return JSON.parse(sessionStorage.getItem("ai_chat_v1") ?? "[]"); } catch { return []; } });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<AiStep[]>([]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { try { sessionStorage.setItem("ai_chat_v1", JSON.stringify(msgs.slice(-30))); } catch { /* ignore */ } end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);
  const send = async (q: string) => {
    touchLab("ai-ask");
    q = q.trim();
    if (!q || busy) return;
    const history = msgs.map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setInput(""); setBusy(true); setLive([]);
    try {
      const r = await askAi(q, history, setLive);
      setMsgs((m) => [...m, { role: "assistant", content: r.answer, steps: r.steps, model: r.model }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: `⚠️ ${e instanceof Error ? e.message : String(e)}` }]);
    } finally { setBusy(false); }
  };
  const he = lang === "he";
  return (
    <div className="space-y-3">
      {msgs.length === 0 && (
        <div className="space-y-2" dir={he ? "rtl" : "ltr"}>
          <p className="text-[13px] text-muted-foreground">{he ? "שאלו כל שאלה על הנתונים באפליקציה — ה-AI כותב שאילתות, בודק ועונה. הוא רק קורא, לא משנה כלום." : "Ask anything about the app's data — the AI writes queries, checks, and answers. It only reads; it never changes anything."}</p>
          <div className="flex flex-wrap gap-2">
            {SUGGEST[lang].map((s) => <button key={s} onClick={() => send(s)} className="rounded-full border border-border px-3 py-1.5 text-start text-[12.5px] hover:border-primary/50 hover:text-primary">{s}</button>)}
          </div>
        </div>
      )}
      {msgs.map((m, i) => m.role === "user" ? (
        <div key={i} dir="auto" className="ms-auto max-w-[80%] rounded-lg bg-primary/10 px-3.5 py-2 text-[13px]">{m.content}</div>
      ) : (
        <div key={i} className="rounded-lg border border-border bg-card p-4">
          <AiMarkdown text={m.content} />
          {(m.steps?.length || m.model) && <Steps steps={m.steps ?? []} model={m.model} />}
        </div>
      ))}
      {busy && (
        <div className="rounded-lg border border-border bg-card p-4 text-[12.5px] text-muted-foreground">
          <div className="flex items-center gap-2"><Loader2 size={14} className="animate-spin text-primary" />{he ? "חושב ובודק בנתונים…" : "Thinking and checking the data…"}</div>
          {live.length > 0 && <ul className="mt-2 space-y-0.5 font-mono text-[11px]">{live.map((s, i) => <li key={i}>· {s.why ?? s.tool}{s.rows != null ? ` → ${s.rows} rows` : ""}{s.error ? " (error, retrying)" : ""}</li>)}</ul>}
        </div>
      )}
      <div ref={end} />
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="sticky bottom-3 flex gap-2 rounded-lg border border-border bg-background/95 p-2 backdrop-blur">
        <input dir="auto" value={input} onChange={(e) => setInput(e.target.value)} placeholder={he ? "שאלו על השוק, תעשיות, מניות, הרשימות שלכם…" : "Ask about the market, industries, stocks, your lists…"}
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-muted/30 px-3 text-[13px]" />
        <button type="submit" disabled={busy || !input.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"><Send size={13} /></button>
        {msgs.length > 0 && <button type="button" onClick={() => setMsgs([])} className="rounded-md border border-border px-2.5 text-[12px] text-muted-foreground hover:text-foreground">{he ? "שיחה חדשה" : "New chat"}</button>}
      </form>
    </div>
  );
}

function Steps({ steps, model }: { steps: AiStep[]; model?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 border-t border-border pt-2 text-[11.5px] text-muted-foreground">
      <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 hover:text-foreground">
        <ChevronDown size={12} className={open ? "" : "-rotate-90"} /> How I found this ({steps.length} lookup{steps.length === 1 ? "" : "s"}){model ? ` · ${model}` : ""}
      </button>
      {open && (
        <ol className="mt-2 space-y-2">
          {steps.map((s, i) => (
            <li key={i}>
              <div>{i + 1}. {s.tool}{s.symbol ? ` ${s.symbol}` : ""}{s.why ? ` — ${s.why}` : ""}{s.rows != null ? ` · ${s.rows} rows` : ""}{s.error ? <span className="text-destructive"> · {s.error}</span> : null}</div>
              {s.sql && <pre dir="ltr" className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-muted/50 p-2 font-mono text-[11px] text-foreground/80">{s.sql}</pre>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ one stock
function StockView({ lang, initial, onSymbol }: { lang: AiLang; initial: string | null; onSymbol: (s: string) => void }) {
  const [input, setInput] = useState((initial ?? "").toUpperCase());
  const [symbol, setSymbol] = useState((initial ?? "").toUpperCase());
  const [saved, setSaved] = useState<AiReport | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const he = lang === "he";
  useEffect(() => {
    if (!symbol) { setSaved(null); return; }
    setSaved(undefined);
    aiLatest("stock", lang, symbol).then((r) => setSaved(r[0] ?? null)).catch(() => setSaved(null));
  }, [symbol, lang]);
  const run = async (s = symbol) => {
    touchLab("ai-stock");
    if (!s) return;
    setBusy(true);
    try {
      const r = await aiStock(s, lang);
      setSaved({ id: 0, kind: "stock", day: "", lang, subject: s, title: `${s} analysis`, content: r.content, model: r.model, created_at: new Date().toISOString() });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const submit = () => { const s = input.trim().toUpperCase(); if (!s) return; setSymbol(s); onSymbol(s); };
  const fresh = saved && Date.now() - new Date(saved.created_at).getTime() < 12 * 3600_000;
  return (
    <div className="space-y-3">
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-wrap items-center gap-2">
        <span className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} placeholder="Ticker" className="h-9 w-40 rounded-md border border-border bg-muted/30 pl-7 pr-2 font-mono text-[13px] uppercase" />
        </span>
        <button type="submit" className="h-9 rounded-md border border-border px-3 text-[13px] hover:border-primary/50 hover:text-primary">{he ? "פתח" : "Open"}</button>
        {symbol && (
          <>
            <button type="button" onClick={() => run()} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-primary-foreground disabled:opacity-60">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Bot size={13} />}{saved ? (he ? "נתח מחדש" : "Analyse again") : (he ? "נתח" : "Analyse")}
            </button>
            <Link to={`/lens?symbol=${symbol}`} className="text-[12.5px] text-muted-foreground underline decoration-dotted hover:text-foreground">{he ? "פתח בעדשת היסודות" : "Open in Fundamentals Lens"}</Link>
          </>
        )}
      </form>
      {busy && <Busy text={he ? `ה-AI קורא את כל מה שהאפליקציה יודעת על ${symbol}…` : `The AI is reading everything the app knows about ${symbol}…`} />}
      {!symbol ? <p className="text-[13px] text-muted-foreground">{he ? "הקלידו טיקר לניתוח: מגמה, שלב, בסיס, העסק וחדשות — מנתוני האפליקציה." : "Type a ticker for an analysis of trend, stage, setup, the business and news — from the app's own data."}</p>
        : saved === undefined ? <Busy text="Loading…" />
        : saved === null ? (!busy && <div className="rounded-lg border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">{he ? `אין עדיין ניתוח ל-${symbol}. לחצו "נתח".` : `No analysis of ${symbol} yet. Press "Analyse".`}</div>)
        : (
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="mb-3 flex flex-wrap items-baseline gap-2 border-b border-border pb-2">
              <h2 className="font-mono text-lg font-semibold">{saved.subject}</h2>
              <span className="text-[11.5px] text-muted-foreground">{ago(saved.created_at)} · {saved.model}{!fresh ? (he ? " · ישן — כדאי לנתח מחדש" : " · older — consider analysing again") : ""}</span>
            </div>
            <AiMarkdown text={saved.content} />
          </div>
        )}
    </div>
  );
}
