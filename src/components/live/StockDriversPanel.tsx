import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Sparkles, TrendingUp, Briefcase, Scale, X, Send, MessageSquare } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent } from "@/components/ui/sheet";

interface StockCtx {
  symbol: string;
  companyName?: string | null;
  sector?: string | null;
  price?: number | null;
  return1d?: number | null;
  return1w?: number | null;
  return1m?: number | null;
  rsRating?: number | null;
}

interface Props extends StockCtx {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Analysis {
  shortTerm: string[];
  longTerm: string[];
  outlook: string;
  generatedAt?: string;
}

interface ChatMsg { role: "user" | "assistant"; content: string }

const cacheKey = (s: string) => `stockDrivers:${s}`;
const TTL_MS = 1000 * 60 * 60 * 6;

const SUGGESTIONS = [
  "Why is the stock strong lately?",
  "What are the main risks?",
  "How does it compare to peers?",
  "What should I watch in the next earnings?",
];

export default function StockDriversPanel({ open, onOpenChange, ...ctx }: Props) {
  const { symbol } = ctx;
  const [data, setData] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const loadDrivers = async (force = false) => {
    if (!symbol) return;
    if (!force) {
      try {
        const raw = localStorage.getItem(cacheKey(symbol));
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.ts && Date.now() - parsed.ts < TTL_MS && parsed.data) {
            setData(parsed.data);
            return;
          }
        }
      } catch {}
    }
    setLoading(true);
    setError(null);
    try {
      const { data: resp, error: fnErr } = await supabase.functions.invoke("stock-drivers-analysis", {
        body: ctx,
      });
      if (fnErr) throw new Error(fnErr.message);
      if ((resp as any)?.error) throw new Error((resp as any).error);
      setData(resp as Analysis);
      try { localStorage.setItem(cacheKey(symbol), JSON.stringify({ ts: Date.now(), data: resp })); } catch {}
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // Reset state and load when symbol changes / panel opens
  useEffect(() => {
    if (!open || !symbol) return;
    setData(null);
    setMessages([]);
    setChatErr(null);
    setInput("");
    loadDrivers(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, open]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setChatErr(null);
    const nextMessages: ChatMsg[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    try {
      const { data: resp, error: fnErr } = await supabase.functions.invoke("stock-drivers-chat", {
        body: { ...ctx, messages: nextMessages },
      });
      if (fnErr) throw new Error(fnErr.message);
      if ((resp as any)?.error) throw new Error((resp as any).error);
      const reply = (resp as any)?.reply ?? "";
      setMessages([...nextMessages, { role: "assistant", content: reply }]);
    } catch (e) {
      setChatErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-l border-border/60 bg-background p-0 sm:max-w-[520px]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-primary" />
            <h2 className="font-['Syne',sans-serif] text-base font-semibold">
              Stock Drivers — {symbol}
            </h2>
            <span className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              AI
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => loadDrivers(true)}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
              title="Regenerate drivers analysis"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Refresh
            </button>
            <button
              onClick={() => onOpenChange(false)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Close panel"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {ctx.companyName && (
            <div className="text-xs text-muted-foreground">
              {ctx.companyName}{ctx.sector ? ` · ${ctx.sector}` : ""}
              {ctx.price != null ? ` · $${Number(ctx.price).toFixed(2)}` : ""}
              {ctx.rsRating != null ? ` · RS ${ctx.rsRating}` : ""}
            </div>
          )}

          {loading && !data && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> Generating analysis…
            </div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          {data && (
            <div className="space-y-3">
              <Section
                color="hsl(160,80%,45%)"
                icon={<TrendingUp size={13} />}
                title="Short-Term Drivers"
                items={data.shortTerm}
              />
              <Section
                color="hsl(210,80%,60%)"
                icon={<Briefcase size={13} />}
                title="Long-Term Drivers"
                items={data.longTerm}
              />
              <div className="rounded-lg border border-[hsl(40,85%,55%)]/30 bg-[hsl(40,85%,55%)]/5 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[hsl(40,85%,55%)]">
                  <Scale size={13} /> Overall Outlook
                </div>
                <p className="text-[13px] leading-relaxed text-foreground/90">{data.outlook}</p>
              </div>
            </div>
          )}

          {/* Chat section */}
          <div className="pt-2">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <MessageSquare size={13} /> Ask Groq about {symbol}
            </div>

            {messages.length === 0 && (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    disabled={sending}
                    className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-left text-[12px] text-foreground/80 hover:bg-accent disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div ref={scrollRef} className="mt-2 space-y-2">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.role === "user"
                      ? "ml-6 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-[13px] text-foreground"
                      : "mr-6 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-[13px] text-foreground/90 prose prose-sm prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:pl-4 [&_li]:my-0.5"
                  }
                >
                  {m.role === "assistant" ? <ReactMarkdown>{m.content}</ReactMarkdown> : m.content}
                </div>
              ))}
              {sending && (
                <div className="mr-6 flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground">
                  <Loader2 size={12} className="animate-spin" /> Thinking…
                </div>
              )}
              {chatErr && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                  {chatErr}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Chat input */}
        <div className="border-t border-border/60 bg-background/80 p-3">
          <form
            onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
            className="flex items-end gap-2"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder="Ask Groq…"
              rows={1}
              className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={sending}
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              Send
            </button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({
  color, icon, title, items,
}: { color: string; icon: React.ReactNode; title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/40 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color }}>
        {icon} {title}
      </div>
      <ul className="space-y-1.5 text-[13px] leading-relaxed text-foreground/90">
        {items.map((b, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="text-primary">•</span><span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
