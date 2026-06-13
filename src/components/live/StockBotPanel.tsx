import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Bot, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent } from "@/components/ui/sheet";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol: string;
  companyName?: string | null;
  sector?: string | null;
}

interface ChatMsg { role: "user" | "assistant"; content: string }

const SUGGESTIONS = [
  "Give me a full analyst-grade analysis",
  "What are the key financial ratios and what do they tell us?",
  "Latest news and what's moving the stock",
  "Compare to its peers",
  "Bull case vs bear case",
];

const cacheKey = (s: string) => `stockbot:${s}`;

export default function StockBotPanel({ open, onOpenChange, symbol, companyName, sector }: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Load cached conversation per symbol
  useEffect(() => {
    if (!symbol) return;
    try {
      const raw = sessionStorage.getItem(cacheKey(symbol));
      setMessages(raw ? JSON.parse(raw) : []);
    } catch { setMessages([]); }
    setErr(null);
  }, [symbol]);

  useEffect(() => {
    if (!symbol) return;
    try { sessionStorage.setItem(cacheKey(symbol), JSON.stringify(messages)); } catch {}
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, symbol]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || sending) return;
    setErr(null);
    const next: ChatMsg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("stockbot-chat", {
        body: { symbol, companyName, sector, messages: next },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      const reply = (data as any)?.reply ?? "";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    setMessages([]);
    try { sessionStorage.removeItem(cacheKey(symbol)); } catch {}
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full max-w-[640px] flex-col gap-0 border-l border-border bg-background p-0 sm:max-w-[640px]">
        <div className="flex items-center justify-between border-b border-border bg-gradient-to-r from-emerald-500/10 via-primary/5 to-transparent px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
              <Bot size={18} className="text-emerald-400" />
            </div>
            <div>
              <div className="font-['Syne',sans-serif] text-base font-semibold text-foreground">
                StockBot — {symbol}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Groq Llama 3.3 70B · live tools: quote, financials, ratios, news, peers
              </div>
            </div>
          </div>
          {messages.length > 0 && (
            <button onClick={reset} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground">
              Clear
            </button>
          )}
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
          {messages.length === 0 && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-card/40 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Sparkles size={14} className="text-emerald-400" />
                  Ask anything about {symbol}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  StockBot pulls live financial statements, ratios, news, and peer data via tool calls, then writes an analyst-grade answer.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-border bg-card/40 px-3 py-1.5 text-xs text-foreground hover:border-emerald-500/40 hover:bg-emerald-500/5"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`mb-4 ${m.role === "user" ? "flex justify-end" : ""}`}>
              {m.role === "user" ? (
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                  {m.content}
                </div>
              ) : (
                <div className="prose prose-sm prose-invert max-w-none text-sm leading-relaxed text-foreground prose-headings:font-['Syne',sans-serif] prose-headings:text-foreground prose-strong:text-foreground prose-a:text-emerald-400">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              )}
            </div>
          ))}

          {sending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
              StockBot is fetching data and analyzing…
            </div>
          )}
          {err && <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</div>}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="border-t border-border bg-background/80 px-4 py-3"
        >
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              rows={1}
              placeholder={`Ask StockBot about ${symbol}…`}
              className="flex-1 resize-none rounded-lg border border-border bg-card/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-emerald-500/40 focus:outline-none"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-white transition-colors hover:bg-emerald-400 disabled:opacity-40"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
