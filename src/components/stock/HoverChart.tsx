import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
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

/**
 * Hover a row → a small 3-month chart follows the mouse after a short pause.
 * Usage: const hover = useHoverChart(); <tr {...hover.bind(sym, name)}> … {hover.node}
 */
export function useHoverChart() {
  const [state, setState] = useState<{ symbol: string; name?: string | null; x: number; y: number; bars: Bars | null | undefined } | null>(null);
  const timer = useRef<number | null>(null);
  const pos = useRef({ x: 0, y: 0 });
  const current = useRef<string | null>(null);
  const clear = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = null; };
  const hide = useCallback(() => { clear(); current.current = null; setState(null); }, []);

  useEffect(() => {
    window.addEventListener("scroll", hide, true);
    return () => { window.removeEventListener("scroll", hide, true); clear(); };
  }, [hide]);

  const bind = (symbol: string, name?: string | null) => ({
    onMouseEnter: (e: MouseEvent) => {
      clear(); current.current = symbol; pos.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        if (current.current !== symbol) return;
        setState({ symbol, name, ...pos.current, bars: undefined });
        void quickBars(symbol).then((bars) => setState((s) => (s && s.symbol === symbol ? { ...s, bars } : s)));
      }, DELAY);
    },
    onMouseMove: (e: MouseEvent) => {
      pos.current = { x: e.clientX, y: e.clientY };
      setState((s) => (s && s.symbol === symbol ? { ...s, x: e.clientX, y: e.clientY } : s));
    },
    onMouseLeave: () => { if (current.current === symbol) hide(); },
    onMouseDown: hide,
  });

  let node: JSX.Element | null = null;
  if (state && typeof document !== "undefined") {
    const vw = window.innerWidth, vh = window.innerHeight, gap = 18;
    const left = state.x + gap + W < vw ? state.x + gap : Math.max(8, state.x - gap - W);
    const top = Math.min(Math.max(8, state.y - H / 2), vh - H - 8);
    const b = state.bars, t = b ? technicals(b, null) : null;
    const n = b?.c.length ?? 0, chg = b && n > 1 ? (b.c[n - 1] / b.c[n - 2] - 1) * 100 : null;
    node = createPortal(
      <div role="tooltip" className="pointer-events-none fixed z-[90] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-2xl" style={{ left, top, width: W }}>
        <div className="mb-1 flex items-baseline gap-2">
          <span className="font-mono text-base font-semibold">{state.symbol}</span>
          <span className="truncate text-xs text-muted-foreground">{state.name ?? ""}</span>
          {b && <span className="ms-auto font-mono text-sm">{b.c[n - 1].toFixed(2)} <span style={{ color: tone(chg) }}>{pct(chg, 2)}</span></span>}
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
      </div>, document.body);
  }
  return { bind, node, hide };
}
