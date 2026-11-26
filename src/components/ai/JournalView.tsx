import { useCallback, useEffect, useState } from "react";
import { Bot, Download, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { invokeAi, type AiLang } from "@/lib/ai";
import { touchLab } from "@/lib/labs";
import AiMarkdown from "./AiMarkdown";
import { TvExportButton } from "./TvExportButton";

/**
 * Journal review: trades with WHY they were taken, rebuilt with what the stock and market looked like on the
 * day before entry, and reviewed by the AI for thinking and stock selection (not execution).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
interface Entry { id?: string; symbol: string; entry_date: string; entry_price: number | null; exit_date: string | null; exit_price: number | null; setup: string | null; thesis: string | null; conviction: number | null; invalidation: string | null; notes: string | null; source?: string }
const EMPTY: Entry = { symbol: "", entry_date: "", entry_price: null, exit_date: null, exit_price: null, setup: "ema21", thesis: "", conviction: 3, invalidation: "", notes: "" };

export default function JournalView({ lang }: { lang: AiLang }) {
  const he = lang === "he";
  const t = (en: string, h: string) => (he ? h : en);
  const [rows, setRows] = useState<Entry[]>([]);
  const [form, setForm] = useState<Entry | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ content: string; model: string } | null>(null);
  const load = useCallback(async () => {
    const { data } = await db.from("journal_entries").select("*").order("entry_date", { ascending: false }).limit(500);
    setRows(data ?? []);
    const { data: last } = await db.from("ai_reports").select("content, model").eq("kind", "journal").eq("lang", lang).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last) setReview(last);
  }, [lang]);
  useEffect(() => { touchLab("journal"); load(); }, [load]);

  const save = async () => {
    if (!form?.symbol || !form.entry_date) { toast.error(t("Ticker and entry date are needed.", "צריך טיקר ותאריך כניסה.")); return; }
    const row = { ...form, symbol: form.symbol.toUpperCase().trim() };
    const { error } = row.id ? await db.from("journal_entries").update(row).eq("id", row.id) : await db.from("journal_entries").insert(row);
    if (error) { toast.error(error.message); return; }
    setForm(null); load();
  };
  const del = async (id?: string) => { if (!id) return; await db.from("journal_entries").delete().eq("id", id); load(); };
  const importPositions = async () => {
    const { data, error } = await db.from("trade_positions").select("id, symbol, entry_date, entry_price, exit_date, exit_price, notes");
    if (error) { toast.error(error.message); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (data ?? []).map((p: any) => ({ symbol: p.symbol, entry_date: p.entry_date, entry_price: p.entry_price, exit_date: p.exit_date, exit_price: p.exit_price, notes: p.notes, source: "positions", source_id: String(p.id) }));
    if (!items.length) { toast.message(t("No positions found in the app.", "לא נמצאו פוזיציות באפליקציה.")); return; }
    const { error: e2 } = await db.from("journal_entries").upsert(items, { onConflict: "source,source_id", ignoreDuplicates: true });
    if (e2) toast.error(e2.message); else { toast.success(t(`Imported ${items.length} positions.`, `יובאו ${items.length} פוזיציות.`)); load(); }
  };
  const importCsv = async () => {
    const lines = (csv ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const items: Entry[] = [];
    for (const l of lines) {
      const c = l.split(/[,\t;]/).map((x) => x.trim());
      if (!/^[A-Za-z]/.test(c[0] ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(c[1] ?? "")) continue; // skips the header line too
      items.push({ symbol: c[0].toUpperCase(), entry_date: c[1], entry_price: c[2] ? Number(c[2]) : null, exit_date: /^\d{4}-\d{2}-\d{2}$/.test(c[3] ?? "") ? c[3] : null, exit_price: c[4] ? Number(c[4]) : null, setup: c[5] || null, thesis: c[6] || null, conviction: null, invalidation: null, notes: c.slice(7).join(", ") || null });
    }
    if (!items.length) { toast.error(t("No rows recognised — use: ticker, entry date (YYYY-MM-DD), entry price, exit date, exit price, setup, why, notes", "לא זוהו שורות — הפורמט: טיקר, תאריך כניסה (YYYY-MM-DD), מחיר כניסה, תאריך יציאה, מחיר יציאה, סטאפ, למה, הערות")); return; }
    const { error } = await db.from("journal_entries").insert(items.map((x) => ({ ...x, source: "import" })));
    if (error) toast.error(error.message); else { toast.success(t(`Imported ${items.length} trades.`, `יובאו ${items.length} עסקאות.`)); setCsv(null); load(); }
  };
  const runReview = async () => {
    setBusy(true);
    try {
      const data = await invokeAi("ai-analyst", { action: "journal", lang });
      setReview({ content: data.content, model: data.model });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const F = (k: keyof Entry, label: string, type = "text", wide = false) => (
    <label className={`space-y-0.5 text-[12px] ${wide ? "sm:col-span-2" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      {wide ? <textarea value={(form?.[k] as string) ?? ""} onChange={(e) => setForm({ ...form!, [k]: e.target.value })} rows={2} className="w-full rounded-md border border-border bg-muted/30 px-2 py-1" />
        : <input type={type} value={(form?.[k] as string | number | null) ?? ""} onChange={(e) => setForm({ ...form!, [k]: type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value })} className="h-8 w-full rounded-md border border-border bg-muted/30 px-2" />}
    </label>
  );

  return (
    <div className="space-y-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-muted-foreground">{t("Your trades with the reason you took them. The AI rebuilds what each stock and the market looked like the day before entry, and reviews your thinking and selection — not execution.", "העסקאות שלך עם הסיבה שבגללה נלקחו. ה-AI משחזר איך נראו המניה והשוק יום לפני הכניסה, וסוקר את החשיבה ואת בחירת המניות — לא את הביצוע.")}</p>
        <span className="ms-auto inline-flex flex-wrap gap-1.5">
          <button onClick={() => setForm({ ...EMPTY })} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 hover:border-primary/50"><Plus size={13} /> {t("Add a trade", "להוסיף עסקה")}</button>
          <button onClick={importPositions} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 hover:border-primary/50"><Download size={13} /> {t("From my positions", "מהפוזיציות שלי")}</button>
          <button onClick={() => setCsv(csv === null ? "" : null)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 hover:border-primary/50"><Upload size={13} /> {t("Paste a list", "להדביק רשימה")}</button>
          <TvExportButton className="!px-2.5 !py-1.5 !text-[13px]" he={he} fileName="journal" options={[
            { label: t("Open trades", "עסקאות פתוחות"), sections: [{ name: t("Journal - open", "Journal - open"), symbols: rows.filter((r) => !r.exit_date).map((r) => r.symbol) }] },
            { label: t("All trades (open, then closed)", "כל העסקאות (פתוחות ואז סגורות)"), sections: [
              { name: "Journal - open", symbols: rows.filter((r) => !r.exit_date).map((r) => r.symbol) },
              { name: "Journal - closed", symbols: rows.filter((r) => r.exit_date).map((r) => r.symbol) }] },
          ]} />
          <button onClick={runReview} disabled={busy || !rows.length} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : <Bot size={13} />} {t("Review my journal", "לסקור את היומן")}</button>
        </span>
      </div>

      {csv !== null && (
        <div className="space-y-1.5 rounded-lg border border-border p-3">
          <p className="text-[12px] text-muted-foreground">{t("One trade per line: ticker, entry date (YYYY-MM-DD), entry price, exit date, exit price, setup, why, notes — from a spreadsheet, commas or tabs.", "עסקה בכל שורה: טיקר, תאריך כניסה (YYYY-MM-DD), מחיר כניסה, תאריך יציאה, מחיר יציאה, סטאפ, למה, הערות — מגיליון, עם פסיקים או טאבים.")}</p>
          <textarea dir="ltr" value={csv} onChange={(e) => setCsv(e.target.value)} rows={5} className="w-full rounded-md border border-border bg-muted/30 p-2 font-mono text-[12px]" />
          <button onClick={importCsv} className="rounded-md bg-primary px-3 py-1 text-[12px] font-semibold text-primary-foreground">{t("Import", "לייבא")}</button>
        </div>
      )}

      {form && (
        <div className="grid gap-2 rounded-lg border border-primary/30 p-3 sm:grid-cols-4">
          {F("symbol", t("Ticker", "טיקר"))}{F("entry_date", t("Entry date", "תאריך כניסה"), "date")}{F("entry_price", t("Entry price", "מחיר כניסה"), "number")}
          <label className="space-y-0.5 text-[12px]"><span className="text-muted-foreground">{t("Setup", "סטאפ")}</span>
            <select value={form.setup ?? ""} onChange={(e) => setForm({ ...form, setup: e.target.value })} className="h-8 w-full rounded-md border border-border bg-muted/30 px-2">
              <option value="ema21">{t("21 EMA pullback", "פולבק ל-21 EMA")}</option><option value="breakout">{t("Breakout", "פריצה")}</option><option value="other">{t("Other", "אחר")}</option>
            </select></label>
          {F("exit_date", t("Exit date (empty = open)", "תאריך יציאה (ריק = פתוחה)"), "date")}{F("exit_price", t("Exit price", "מחיר יציאה"), "number")}
          <label className="space-y-0.5 text-[12px]"><span className="text-muted-foreground">{t("Conviction (1–5)", "ביטחון (1–5)")}</span>
            <input type="range" min={1} max={5} value={form.conviction ?? 3} onChange={(e) => setForm({ ...form, conviction: Number(e.target.value) })} className="w-full" /></label>
          <div />
          {F("thesis", t("Why I'm entering", "למה אני נכנס/ת"), "text", true)}{F("invalidation", t("What would prove me wrong", "מה יוכיח שטעיתי"), "text", true)}
          {F("notes", t("Notes", "הערות"), "text", true)}
          <div className="flex items-end gap-2 sm:col-span-2"><button onClick={save} className="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground">{t("Save", "לשמור")}</button><button onClick={() => setForm(null)} className="rounded-md border border-border px-3 py-1.5">{t("Cancel", "ביטול")}</button></div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[12.5px]">
            <thead className="bg-muted/30 text-[11px] text-muted-foreground"><tr>{[t("Ticker", "טיקר"), t("Entry", "כניסה"), t("Exit", "יציאה"), t("Result", "תוצאה"), t("Setup", "סטאפ"), t("Why", "למה"), ""].map((h, i) => <th key={i} className="px-2 py-1.5 text-start font-medium">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r) => {
              const res = r.entry_price && r.exit_price ? (100 * (Number(r.exit_price) / Number(r.entry_price) - 1)) : null;
              return (
                <tr key={r.id} className="border-t border-border/50 align-top">
                  <td className="px-2 py-1.5 font-mono font-semibold"><button onClick={() => setForm(r)} className="hover:text-primary">{r.symbol}</button></td>
                  <td dir="ltr" className="px-2 py-1.5">{r.entry_date}{r.entry_price ? ` @ ${r.entry_price}` : ""}</td>
                  <td dir="ltr" className="px-2 py-1.5">{r.exit_date ? `${r.exit_date}${r.exit_price ? ` @ ${r.exit_price}` : ""}` : t("open", "פתוחה")}</td>
                  <td dir="ltr" className={`px-2 py-1.5 ${res == null ? "" : res > 0 ? "text-[hsl(210,90%,65%)]" : "text-[hsl(330,80%,65%)]"}`}>{res == null ? "—" : `${res > 0 ? "+" : ""}${res.toFixed(1)}%`}</td>
                  <td className="px-2 py-1.5">{r.setup ?? "—"}</td>
                  <td className="max-w-[360px] px-2 py-1.5 text-foreground/85">{r.thesis || <span className="text-muted-foreground">{t("no reason written", "לא נכתבה סיבה")}</span>}</td>
                  <td className="px-2 py-1.5"><button onClick={() => del(r.id)} aria-label="Delete" className="text-muted-foreground hover:text-destructive"><Trash2 size={13} /></button></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      {busy && <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-muted-foreground"><Loader2 size={14} className="animate-spin text-primary" />{t("Rebuilding each entry and reviewing (1–3 minutes)…", "משחזר כל כניסה וסוקר (1–3 דקות)…")}</div>}
      {review && <section className="rounded-lg border border-border bg-card p-4"><AiMarkdown text={review.content} /><div className="mt-2 text-[11px] text-muted-foreground">{review.model}</div></section>}
    </div>
  );
}
