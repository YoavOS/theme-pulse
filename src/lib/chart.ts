import type { MouseEvent } from "react";

/** Open the app's chart pop-up for a symbol (rendered once by <ChartHost/> in App). */
export function openChart(symbol: string) {
  const s = String(symbol ?? "").toUpperCase().trim();
  if (s) window.dispatchEvent(new CustomEvent("tp:open-chart", { detail: s }));
}

/**
 * onClick for ticker links that point at TradingView: a plain click opens the app's chart,
 * Ctrl/⌘/middle-click still opens TradingView in a new tab.
 */
export function chartClick(symbol: string, stop = true) {
  return (e: MouseEvent) => {
    if (stop) e.stopPropagation();
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openChart(symbol);
  };
}
