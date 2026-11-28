import { memo, useCallback, useEffect, useSyncExternalStore, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CHART } from "@/components/lens/QuarterlyChart";
import { StockChart } from "@/components/chart/StockChart";
import { technicals, type Bars } from "@/lib/portfolio/engine";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const cache = new Map<string, Promise<Bars | null>>();

/** Daily bars from the PC's prices, cached for the session. Hovering never starts a download. */
function quickBars(symbol: string): Promise<Bars | null> {
  let p = cache.get(symbol);
  if (!p) {
    p = db.rpc("portfolio_bars", { syms: [symbol], n: 300 }).then(({ data }: { data: { d: string[]; o: unknown[]; h: unknown[]; l: unknown[]; c: unknown[]; v: unknown[] }[] | null }) => {
      const r = (data ?? [])[0];
      return r ? { d: r.d, o: r.o.map(Number), h: r.h.map(Number), l: r.l.map(Number), c: r.c.map(Number), v: r.v.map(Number) } : null;
    }).catch(() => null);
    cache.set(symbol, p!);
    p!.then((b) => { if (!b) cache.delete(symbol); });
  }
  return p!;
}

const W = 480, H = 330, DELAY = 350;
const pct = (v: number | null | undefined, d = 1) => v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`;
const tone = (v: number | null | undefined) => v == null || v === 0 ? undefined : v > 0 ? CHART.positive : CHART.negative;

type HoverState = { symbol: string; name?: string | null; x: number; y: number; bars: Bars | null | undefined } | null;

// The hover state lives outside React state of the page, so moving the mouse over a big table only
// redraws the small preview — never the table itself.
let hoverState: HoverState = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const setHover = (next: HoverState) => { hoverState = next; emit(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
let timer: number | null = null, current: string | null = null, frame = 0;
const pos = { x: 0, y: 0 };
const clear = () => { if (timer) window.clearTimeout(timer); timer = null; };
const hideHover = () => { clear(); current = null; if (hoverState) setHover(null); };

/**
 * Hover a row → a small 3-month chart follows the mouse after a short pause.
 * Usage: const hover = useHoverChart(); <tr {...hover.bind(sym, name)}> … {hover.node}
 * `bind` returns stable handlers that never change the calling component's state.
 */
export function useHoverChart() {
  useEffect(() => {
    window.addEventListener("scroll", hideHover, true);
    window.addEventListener("blur", hideHover);
    return () => { window.removeEventListener("scroll", hideHover, true); window.removeEventListener("blur", hideHover); hideHover(); };
  }, []);
  const bind = useCallback((symbol: string, name?: string | null) => ({
    onMouseEnter: (e: MouseEvent) => {
      clear(); current = symbol; pos.x = e.clientX; pos.y = e.clientY;
      if (hoverState && hoverState.symbol !== symbol) setHover(null);
      timer = window.setTimeout(() => {
        if (current !== symbol) return;
        setHover({ symbol, name, x: pos.x, y: pos.y, bars: undefined });
        void quickBars(symbol).then((bars) => { if (hoverState && hoverState.symbol === symbol) setHover({ ...hoverState, bars }); });
      }, DELAY);
    },
    onMouseMove: (e: MouseEvent) => {
      pos.x = e.clientX; pos.y = e.clientY;
      if (!hoverState || hoverState.symbol !== symbol || frame) return;
      frame = window.requestAnimationFrame(() => { frame = 0; if (hoverState && hoverState.symbol === symbol) setHover({ ...hoverState, x: pos.x, y: pos.y }); });
    },
    onMouseLeave: () => { if (current === symbol) hideHover(); },
    onMouseDown: hideHover,
  }), []);
  return { bind, node: <HoverLayer />, hide: hideHover };
}

function HoverLayer() {
  const state = useSyncExternalStore(subscribe, () => hoverState, () => null);
  if (!state || typeof document === "undefined") return null;
  const vw = window.innerWidth, vh = window.innerHeight, gap = 18;
  const left = state.x + gap + W < vw ? state.x + gap : Math.max(8, state.x - gap - W);
  const top = Math.min(Math.max(8, state.y - H / 2), vh - H - 8);
  const b = state.bars;
  return createPortal(
    <div role="tooltip" className="pointer-events-none fixed z-[90] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-2xl" style={{ left, top, width: W }}>
      <Preview symbol={state.symbol} name={state.name} bars={b} />
    </div>, document.body);
}

/** The chart part is memoised, so following the mouse only moves the box. */
const Preview = memo(function Preview({ symbol, name, bars: b }: { symbol: string; name?: string | null; bars: Bars | null | undefined }) {
  const t = b ? technicals(b, null) : null;
  const n = b?.c.length ?? 0, chg = b && n > 1 ? (b.c[n - 1] / b.c[n - 2] - 1) * 100 : null;
  return <>
    <div className="mb-1 flex items-baseline gap-2">
      <span className="font-mono text-base font-semibold">{symbol}</span>
      <span className="truncate text-xs text-muted-foreground">{name ?? ""}</span>
      {b && n > 0 && <span className="ms-auto font-mono text-sm">{b.c[n - 1].toFixed(2)} <span style={{ color: tone(chg) }}>{pct(chg, 2)}</span></span>}
    </div>
    {b === undefined ? <p className="flex h-[200px] items-center justify-center gap-2 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" />Loading chart…</p>
      : b === null || n < 30 ? <p className="flex h-[200px] items-center justify-center text-center text-xs text-muted-foreground">No daily prices on the PC yet.<br />Click the row to open the full panel — it downloads them.</p>
      : <StockChart bars={b} height={420} range="3M" mini />}
    {t && <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
      <span>vs 21 EMA <b className="font-mono" style={{ color: tone(t.vsEma21) }}>{pct(t.vsEma21)}</b></span>
      <span>vs 50 SMA <b className="font-mono" style={{ color: tone(t.vsSma50) }}>{pct(t.vsSma50)}</b></span>
      <span>from 52w high <b className="font-mono">{pct(t.fromHigh)}</b></span>
      <span className="ms-auto">Click for the full panel</span>
    </p>}
  </>;
});
