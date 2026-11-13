import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import LensPanel from "@/components/lens/LensPanel";
import { onLensSymbol } from "@/lib/lens/channel";

/**
 * Fundamentals Lens tab (/lens?symbol=NVDA). Full-page layout when the window is wide; drag the
 * window into a corner and it folds into a single side-panel column.
 * "Follow" keeps it on the ticker you check in Live Execution.
 */
export default function FundamentalsLens() {
  const [params, setParams] = useSearchParams();
  const [symbol, setSymbol] = useState<string | null>(params.get("symbol")?.toUpperCase() || null);
  const [follow, setFollow] = useState<boolean>(() => { try { return localStorage.getItem("lens-follow") !== "0"; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem("lens-follow", follow ? "1" : "0"); } catch { /* ignore */ } }, [follow]);
  // "Follow" tracks every ticker checked in Live Execution; its Lens button always switches the tab.
  useEffect(() => onLensSymbol((s, force) => { if (force || follow) setSymbol(s.toUpperCase()); }), [follow]);
  useEffect(() => {
    document.title = symbol ? `${symbol} · Fundamentals Lens` : "Fundamentals Lens";
    if (symbol && params.get("symbol") !== symbol) setParams({ symbol }, { replace: true });
  }, [symbol, params, setParams]);

  return (
    <div className="flex h-screen flex-col bg-background">
      <div className="min-h-0 flex-1">
        <LensPanel symbol={symbol} onSymbolChange={setSymbol} homeLink />
      </div>
      <label className="flex items-center gap-2 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-[hsl(var(--primary))]" />
        Follow the ticker checked in Live Execution
      </label>
    </div>
  );
}
