import { lazy, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import LensPanel from "@/components/lens/LensPanel";
import { GlossaryButton, GlossaryProvider } from "@/components/lens/GlossaryBrowser";
const IdeasView = lazy(() => import("@/components/proven/IdeasView"));
import { onLensSymbol } from "@/lib/lens/channel";
import { LensScope, dirOf, setLensLang, useLensLangSetting } from "@/lib/lens/i18n";

/**
 * Fundamentals Lens tab (/lens?symbol=NVDA). Full-page layout when the window is wide; drag the
 * window into a corner and it folds into a single side-panel column.
 * "Follow" keeps it on the ticker you check in Live Execution.
 */
export default function FundamentalsLens() {
  const [params, setParams] = useSearchParams();
  const [symbol, setSymbol] = useState<string | null>(params.get("symbol")?.toUpperCase() || null);
  const [view, setView] = useState<"company" | "ideas">(params.get("view") === "ideas" ? "ideas" : "company");
  const lang = useLensLangSetting();
  const he = lang === "he";
  const [follow, setFollow] = useState<boolean>(() => { try { return localStorage.getItem("lens-follow") !== "0"; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem("lens-follow", follow ? "1" : "0"); } catch { /* ignore */ } }, [follow]);
  // "Follow" tracks every ticker checked in Live Execution; its Lens button always switches the tab.
  useEffect(() => onLensSymbol((s, force) => { if (force || follow) setSymbol(s.toUpperCase()); }), [follow]);
  useEffect(() => {
    document.title = symbol ? `${symbol} · ${he ? "עדשת היסודות" : "Fundamentals Lens"}` : he ? "עדשת היסודות" : "Fundamentals Lens";
    const want: Record<string, string> = {};
    if (symbol) want.symbol = symbol;
    if (view === "ideas") want.view = "ideas";
    if ((params.get("symbol") ?? undefined) !== want.symbol || (params.get("view") ?? undefined) !== want.view) setParams(want, { replace: true });
  }, [symbol, view, params, setParams, he]);
  // a ticker arriving from Live Execution switches back to the company view
  useEffect(() => onLensSymbol((_s, force) => { if (force) setView("company"); }), []);

  return (
    <LensScope.Provider value={true}>
    <GlossaryProvider>
    <div className="flex h-screen flex-col bg-background" dir={dirOf(lang)} lang={lang}>
      {/* both stay mounted so switching back keeps your place (and any prediction you wrote) */}
      <div className={`min-h-0 flex-1 ${view === "company" ? "" : "hidden"}`}>
        <LensPanel symbol={symbol} onSymbolChange={setSymbol} homeLink />
      </div>
      <div className={`min-h-0 flex-1 overflow-y-auto ${view === "ideas" ? "" : "hidden"}`}>
        {view === "ideas" && <Suspense fallback={<p className="p-6">{he ? "טעינה…" : "Loading…"}</p>}><IdeasView active onOpen={(s) => { setSymbol(s.toUpperCase()); setView("company"); }} /></Suspense>}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        <div className="flex overflow-hidden rounded-md border border-border" role="tablist">
          {([["company", symbol ?? (he ? "חברה" : "Company")], ["ideas", he ? "הרעיונות של דמודרן" : "Damodaran's ideas"]] as const).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`px-2 py-0.5 ${view === k ? "bg-primary/20 font-semibold text-primary" : "hover:text-foreground"}`}>{t}</button>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-[hsl(var(--primary))]" />
          {he ? "מעקב אחרי הסימול שנבדק ב-Live Execution" : "Follow the ticker checked in Live Execution"}
        </label>
        {view === "ideas" && <GlossaryButton className="ms-auto" />}
        <div className={`${view === "ideas" ? "" : "ms-auto "}flex overflow-hidden rounded-md border border-border`} role="group" aria-label={he ? "שפה" : "Language"}>
          {([["en", "English"], ["he", "עברית"]] as const).map(([k, t]) => (
            <button key={k} onClick={() => setLensLang(k)} aria-pressed={lang === k} className={`px-2 py-0.5 ${lang === k ? "bg-primary/20 font-semibold text-primary" : "hover:text-foreground"}`}>{t}</button>
          ))}
        </div>
      </div>
    </div>
    </GlossaryProvider>
    </LensScope.Provider>
  );
}
