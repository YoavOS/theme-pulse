import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import LensPanel from "@/components/lens/LensPanel";
import IdeasView from "@/components/proven/IdeasView";
import { onLensSymbol } from "@/lib/lens/channel";

/**
 * Fundamentals Lens tab (/lens?symbol=NVDA). Full-page layout when the window is wide; drag the
 * window into a corner and it folds into a single side-panel column.
 * "Follow" keeps it on the ticker you check in Live Execution.
 */
export default function FundamentalsLens() {
  const [params, setParams] = useSearchParams();
  const [symbol, setSymbol] = useState<string | null>(params.get("symbol")?.toUpperCase() || null);
  const [view, setView] = useState<"company" | "ideas">(params.get("view") === "ideas" ? "ideas" : "company");
  const [follow, setFollow] = useState<boolean>(() => { try { return localStorage.getItem("lens-follow") !== "0"; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem("lens-follow", follow ? "1" : "0"); } catch { /* ignore */ } }, [follow]);
  // "Follow" tracks every ticker checked in Live Execution; its Lens button always switches the tab.
  useEffect(() => onLensSymbol((s, force) => { if (force || follow) setSymbol(s.toUpperCase()); }), [follow]);
  useEffect(() => {
    document.title = symbol ? `${symbol} · Fundamentals Lens` : "Fundamentals Lens";
    const want: Record<string, string> = {};
    if (symbol) want.symbol = symbol;
    if (view === "ideas") want.view = "ideas";
    if ((params.get("symbol") ?? undefined) !== want.symbol || (params.get("view") ?? undefined) !== want.view) setParams(want, { replace: true });
  }, [symbol, view, params, setParams]);
  // a ticker arriving from Live Execution switches back to the company view
  useEffect(() => onLensSymbol((_s, force) => { if (force) setView("company"); }), []);

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* both stay mounted so switching back keeps your place (and any prediction you wrote) */}
      <div className={`min-h-0 flex-1 ${view === "company" ? "" : "hidden"}`}>
        <LensPanel symbol={symbol} onSymbolChange={setSymbol} homeLink />
      </div>
      <div className={`min-h-0 flex-1 overflow-y-auto ${view === "ideas" ? "" : "hidden"}`}>
        <IdeasView active={view === "ideas"} onOpen={(s) => { setSymbol(s.toUpperCase()); setView("company"); }} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        <div className="flex overflow-hidden rounded-md border border-border" role="tablist">
          {([["company", symbol ?? "Company"], ["ideas", "Damodaran's ideas"]] as const).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`px-2 py-0.5 ${view === k ? "bg-primary/20 font-semibold text-primary" : "hover:text-foreground"}`}>{t}</button>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-[hsl(var(--primary))]" />
          Follow the ticker checked in Live Execution
        </label>
      </div>
    </div>
  );
}
