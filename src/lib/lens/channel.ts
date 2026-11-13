// Keeps the Fundamentals Lens tab on the same ticker as the rest of the app
// (same-site BroadcastChannel; it can't see tickers typed inside tradingview.com).
const NAME = "tp-fundamentals-lens";
const TAB = "tp-fundamentals-lens-tab";

/** `force` switches the Lens even when its "Follow" box is off (an explicit click, not a passing ticker). */
export function postLensSymbol(symbol: string, force = false) {
  try { const c = new BroadcastChannel(NAME); c.postMessage({ symbol, force }); c.close(); } catch { /* unsupported */ }
}

export function onLensSymbol(cb: (symbol: string, force: boolean) => void): () => void {
  try {
    const c = new BroadcastChannel(NAME);
    c.onmessage = (e) => { if (typeof e.data?.symbol === "string") cb(e.data.symbol, e.data.force === true); };
    return () => c.close();
  } catch { return () => {}; }
}

/** Open the Lens as a normal browser tab — or, if the tab it opened before is still there, switch it
 *  to this ticker and bring it forward instead of opening another. */
export function openLensTab(symbol: string | null) {
  const url = `/lens${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ""}`;
  const w = window.open("", TAB);           // existing named tab, or a new blank one
  if (!w) { window.open(url, "_blank"); return; }
  let blank = true;
  try { blank = w.location.href === "about:blank"; } catch { /* not readable → treat as new */ }
  if (blank) { w.location.href = url; return; }
  if (symbol) postLensSymbol(symbol, true);
  w.focus();
}
