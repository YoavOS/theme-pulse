import { useState } from "react";
import { Bot, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { aiFocus, type AiLang } from "@/lib/ai";
import { touchLab } from "@/lib/labs";
import AiMarkdown from "./AiMarkdown";

/** The AI reviews your focus list (the one pasted or uploaded in RS Alpha → Organize focus list). */
function readFocus(): { title: string; symbols: string[] }[] {
  let raw = "";
  try { raw = localStorage.getItem("focus_list_v1") ?? ""; } catch { /* private mode */ }
  try { const j = JSON.parse(raw); if (typeof j === "string") raw = j; } catch { /* plain text */ }
  const groups: { title: string; symbols: string[] }[] = [];
  let cur = { title: "List", symbols: [] as string[] };
  const seen = new Set<string>();
  for (const tok of raw.split(/[\s,;|]+/)) {
    if (!tok) continue;
    if (tok.startsWith("###")) { if (cur.symbols.length) groups.push(cur); cur = { title: tok.replace(/^#+/, "").replace(/_/g, " ") || "Section", symbols: [] }; continue; }
    let t = tok.trim().toUpperCase();
    const c = t.indexOf(":"); if (c >= 0) t = t.slice(c + 1);
    t = t.replace(/[^A-Z0-9.-]/g, "");
    if (!t || seen.has(t) || ["SPY", "QQQ", "IWM"].includes(t)) continue;
    seen.add(t); cur.symbols.push(t);
  }
  if (cur.symbols.length) groups.push(cur);
  return groups;
}

export default function FocusReview({ lang }: { lang: AiLang }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ text: string; model: string } | null>(null);
  const groups = readFocus();
  const n = groups.reduce((s, g) => s + g.symbols.length, 0);
  const run = async () => {
    touchLab("ai-focus");
    setBusy(true);
    try { const r = await aiFocus(groups, lang); setRes({ text: r.content, model: r.model }); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted-foreground">{n ? `${n} stocks in ${groups.length} section${groups.length === 1 ? "" : "s"} — your latest focus list from RS Alpha → Organize focus list.` : "No focus list yet: paste or upload it in RS Alpha → Organize focus list first."}</span>
        <button onClick={run} disabled={busy || !n} className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Bot size={13} />} Review it
        </button>
      </div>
      {busy && <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-[13px] text-muted-foreground"><Loader2 size={14} className="animate-spin text-primary" /> The AI is reviewing your list (1–2 minutes)…</div>}
      {res && <div className="rounded-lg border border-border bg-card p-5"><div className="mb-2 text-[11.5px] text-muted-foreground">{res.model}</div><AiMarkdown text={res.text} /></div>}
    </div>
  );
}
