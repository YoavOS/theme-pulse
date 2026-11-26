import { ClipboardCopy, Download, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { buildTvText, type TvSection } from "@/lib/industryRanking";
import { useTickersIn } from "@/lib/tvTickers";

/**
 * "TradingView" button for any list in the AI tab. Download gives a .txt file for TradingView's
 * watchlist "Import list"; Copy puts the same text on the clipboard. Each option is one choice of
 * sections (e.g. "This list" / "All three lists"). Sections become ###headers in the watchlist.
 */
export interface TvOption { label: string; sections: TvSection[] }

export function TvExportButton({ options, fileName, he = false, className = "" }: { options: TvOption[]; fileName: string; he?: boolean; className?: string }) {
  const usable = options.map((o) => ({ ...o, built: buildTvText(o.sections) })).filter((o) => o.built.symbols > 0);
  const t = (en: string, h: string) => (he ? h : en);
  const report = (b: ReturnType<typeof buildTvText>) =>
    `${b.symbols} ${t("symbols", "סימולים")}${b.sections > 1 ? `, ${b.sections} ${t("sections", "קטעים")}` : ""}${b.cut ? ` — ${b.cut} ${t("left out (TradingView's 1,000 limit)", "לא נכנסו (מגבלת 1,000 של TradingView)")}` : ""}`;
  const download = (o: (typeof usable)[number]) => {
    const blob = new Blob([o.built.text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName.replace(/[^\w-]+/g, "_")}_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(`${t("Downloaded", "הורד")}: ${report(o.built)}`, { description: t("In TradingView: watchlist menu → Import list… → choose this file.", "ב-TradingView: תפריט רשימת המעקב ← Import list… ← לבחור את הקובץ.") });
  };
  const copy = async (o: (typeof usable)[number]) => {
    try { await navigator.clipboard.writeText(o.built.text); toast.success(`${t("Copied", "הועתק")}: ${report(o.built)}`, { description: t("Paste into a TradingView watchlist, or save as .txt and use Import list.", "אפשר להדביק ברשימת מעקב ב-TradingView, או לשמור כ-txt ולייבא.") }); }
    catch { toast.error(t("The browser blocked the clipboard — use Download instead.", "הדפדפן חסם את ההעתקה — אפשר להשתמש בהורדה.")); }
  };
  const total = usable[0]?.built.symbols ?? 0;
  return (
    <DropdownMenu dir={he ? "rtl" : "ltr"}>
      <DropdownMenuTrigger asChild disabled={!usable.length}>
        <button title={usable.length ? t("Import into TradingView", "ייבוא ל-TradingView") : t("No symbols in this list", "אין סימולים ברשימה")}
          className={`inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40 ${className}`}>
          <TrendingUp size={12} /> TradingView{total ? <span className="tabular-nums opacity-70">· {total}</span> : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {usable.map((o, i) => (
          <div key={o.label}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">{o.label} · {report(o.built)}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => download(o)} className="gap-2 text-[12.5px]"><Download size={13} /> {t("Download .txt for Import list", "הורדת קובץ txt לייבוא")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void copy(o)} className="gap-2 text-[12.5px]"><ClipboardCopy size={13} /> {t("Copy to clipboard", "העתקה ללוח")}</DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** TradingView button for AI-written text: the universe tickers it mentions, in order. Hidden when there are none. */
export function TvFromText({ text, name, fileName, he = false, className = "" }: { text: string; name: string; fileName: string; he?: boolean; className?: string }) {
  const symbols = useTickersIn([text]);
  if (!symbols.length) return null;
  return <TvExportButton className={className} he={he} fileName={fileName}
    options={[{ label: he ? `מניות שמוזכרות (${symbols.slice(0, 6).join(", ")}${symbols.length > 6 ? "…" : ""})` : `Stocks mentioned (${symbols.slice(0, 6).join(", ")}${symbols.length > 6 ? "…" : ""})`, sections: [{ name, symbols }] }]} />;
}
