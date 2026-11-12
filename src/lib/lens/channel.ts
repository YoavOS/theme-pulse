// Keeps a popped-out Fundamentals Lens window on the same ticker as the main app
// (same-site BroadcastChannel; it can't see tickers typed inside tradingview.com).
const NAME = "tp-fundamentals-lens";

export function postLensSymbol(symbol: string) {
  try { const c = new BroadcastChannel(NAME); c.postMessage({ symbol }); c.close(); } catch { /* unsupported */ }
}

export function onLensSymbol(cb: (symbol: string) => void): () => void {
  try {
    const c = new BroadcastChannel(NAME);
    c.onmessage = (e) => { if (typeof e.data?.symbol === "string") cb(e.data.symbol); };
    return () => c.close();
  } catch { return () => {}; }
}

export function openLensWindow(symbol: string | null) {
  const url = `/lens${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ""}`;
  window.open(url, "tp-fundamentals-lens", "popup,width=430,height=920");
}
