import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isTradingDay, nyNow, prevTradingDay, type Bars, type PositionRow } from "@/lib/portfolio/engine";
import { supabase } from "@/integrations/supabase/client";
import { TradingDatePicker } from "./TradingDatePicker";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
import type { NewPosition } from "@/hooks/usePortfolio";

const field = "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary";
const lbl = "mb-1 block text-xs text-muted-foreground";
const numOrNull = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

/** Add a position (dollar amount at a price — shares are worked out), or edit one buy (`row`). */
export function PositionDialog({ open, onOpenChange, row, onSave, prefill }: {
  open: boolean; onOpenChange: (o: boolean) => void; row?: PositionRow | null;
  onSave: (p: NewPosition, stop: number | null) => Promise<boolean>; prefill?: Partial<NewPosition>;
}) {
  const today = nyNow().date;
  const lastSession = isTradingDay(today) ? today : prevTradingDay(today);
  const empty = { symbol: "", amount: "", price: "", date: lastSession, stop: "", initialStop: "", target: "", setup: "", notes: "" };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [bars, setBars] = useState<Bars | null>(null);
  useEffect(() => {
    if (!open) return;
    setF(row ? {
      symbol: row.symbol, amount: (Number(row.shares) * Number(row.entry_price)).toFixed(2), price: String(row.entry_price), date: row.entry_date,
      stop: row.stop != null ? String(row.stop) : "", initialStop: row.initial_stop != null ? String(row.initial_stop) : "",
      target: row.target != null ? String(row.target) : "", setup: row.setup ?? "", notes: row.notes ?? "",
    } : { ...empty, symbol: prefill?.symbol ?? "" });
  }, [open, row, prefill?.symbol]); // eslint-disable-line react-hooks/exhaustive-deps
  // the stock's daily prices, for the date picker (each day's move, that day's open/high/low/close)
  const sym = f.symbol.trim().toUpperCase();
  useEffect(() => {
    if (!open || !/^[A-Z][A-Z0-9.-]{0,9}$/.test(sym)) { setBars(null); return; }
    let live = true;
    const t = window.setTimeout(async () => {
      const { data } = await db.rpc("portfolio_bars", { syms: [sym], n: 300 });
      const r = (data ?? [])[0];
      if (live) setBars(r ? { d: r.d, o: r.o.map(Number), h: r.h.map(Number), l: r.l.map(Number), c: r.c.map(Number), v: r.v.map(Number) } : null);
    }, 350);
    return () => { live = false; window.clearTimeout(t); };
  }, [sym, open]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const amount = numOrNull(f.amount.replace(/[$,]/g, "")), price = numOrNull(f.price), stopN = numOrNull(row ? f.stop : f.initialStop), target = numOrNull(f.target);
  const shares = amount && price ? amount / price : null;
  const valid = /^[A-Za-z][A-Za-z0-9.-]{0,9}$/.test(f.symbol.trim()) && !!amount && amount > 0 && !!price && price > 0 && /^\d{4}-\d{2}-\d{2}$/.test(f.date);
  const risk = shares && price && stopN != null && stopN < price ? { total: (price - stopN) * shares, pct: (1 - stopN / price) * 100 } : null;
  const day = bars ? bars.d.indexOf(f.date) : -1;
  const outside = day >= 0 && price != null && (price > bars!.h[day] * 1.005 || price < bars!.l[day] * 0.995);
  const save = async () => {
    if (!valid) return;
    setBusy(true);
    const ok = await onSave({
      symbol: sym, shares: +shares!.toFixed(6), entry_price: price!, entry_date: f.date,
      initial_stop: row ? numOrNull(f.initialStop) : stopN, target, setup: f.setup.trim() || null, notes: f.notes.trim() || null,
    }, row ? numOrNull(f.stop) : stopN);
    setBusy(false);
    if (ok) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{row ? `Edit ${row.symbol}` : "Add a position"}</DialogTitle>
          <DialogDescription>{row ? "Change this buy. The stop can move as the trade works; the first stop stays for R." : "How much you put in and at what price. Stop and target are optional but unlock risk, R and alerts."}</DialogDescription>
        </DialogHeader>
        <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="col-span-2"><span className={lbl}>Symbol</span>
            <input className={`${field} font-mono uppercase`} value={f.symbol} onChange={set("symbol")} disabled={!!row} autoFocus={!row} placeholder="NVDA" /></label>
          <div className="col-span-2"><span className={lbl}>Date bought</span>
            <TradingDatePicker value={f.date} onChange={(d) => setF((s) => ({ ...s, date: d }))} bars={bars} onUsePrice={(p) => setF((s) => ({ ...s, price: String(p) }))} /></div>
          <label><span className={lbl}>Amount invested ($)</span><input inputMode="decimal" className={`${field} font-mono`} value={f.amount} onChange={set("amount")} placeholder="5000" /></label>
          <label><span className={lbl}>Price paid</span><input inputMode="decimal" className={`${field} font-mono`} value={f.price} onChange={set("price")} placeholder="125.40" /></label>
          <p className="col-span-2 -mt-1 text-[11px] text-muted-foreground">{shares ? <>= <b className="font-mono text-foreground">{shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}</b> shares</> : "Shares are worked out from the amount and the price."}
            {outside && <span className="ms-2 text-amber-200">That price is outside the day's range ({bars!.l[day].toFixed(2)}–{bars!.h[day].toFixed(2)}).</span>}</p>
          {row ? (
            <>
              <label><span className={lbl}>Current stop</span><input inputMode="decimal" className={`${field} font-mono`} value={f.stop} onChange={set("stop")} placeholder="optional" /></label>
              <label><span className={lbl}>First stop (for R)</span><input inputMode="decimal" className={`${field} font-mono`} value={f.initialStop} onChange={set("initialStop")} placeholder="optional" /></label>
            </>
          ) : (
            <label><span className={lbl}>Stop</span><input inputMode="decimal" className={`${field} font-mono`} value={f.initialStop} onChange={set("initialStop")} placeholder="optional" /></label>
          )}
          <label className={row ? "col-span-2 sm:col-span-1" : ""}><span className={lbl}>Target</span><input inputMode="decimal" className={`${field} font-mono`} value={f.target} onChange={set("target")} placeholder="optional" /></label>
          <label className={row ? "col-span-2 sm:col-span-1" : "col-span-2"}><span className={lbl}>Setup</span><input className={field} value={f.setup} onChange={set("setup")} placeholder="e.g. VCP breakout, 21 EMA pullback" /></label>
          <label className="col-span-2"><span className={lbl}>Why I bought it</span><textarea className={`${field} min-h-[56px]`} value={f.notes} onChange={set("notes")} placeholder="The thesis, in a sentence or two" /></label>
          {risk && <p className="col-span-2 rounded-md bg-muted/40 px-3 py-2 text-xs">Risk to stop: <b className="font-mono">${risk.total.toLocaleString("en-US", { maximumFractionDigits: 0 })}</b> ({risk.pct.toFixed(1)}% below the price{amount ? `, ${((risk.total / amount) * 100).toFixed(1)}% of the amount` : ""}).</p>}
          <div className="col-span-2 flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => onOpenChange(false)} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>
            <button type="submit" disabled={!valid || busy} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40">{busy ? "Saving…" : row ? "Save" : "Add position"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Sell part or all of one buy, by dollar amount or a share of it. Defaults to everything at the live price, today. */
export function SellDialog({ open, onOpenChange, row, price, onSell }: {
  open: boolean; onOpenChange: (o: boolean) => void; row: PositionRow | null; price: number | null;
  onSell: (row: PositionRow, shares: number, price: number, date: string, note: string | null) => Promise<boolean>;
}) {
  const today = nyNow().date;
  const lastSession = isTradingDay(today) ? today : prevTradingDay(today);
  const [f, setF] = useState({ part: 100, price: "", date: lastSession, note: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && row) setF({ part: 100, price: price != null ? price.toFixed(2) : "", date: lastSession, note: "" }); }, [open, row, price, lastSession]);
  if (!row) return null;
  const px = numOrNull(f.price), sh = Number(row.shares) * (f.part / 100);
  const value = px ? sh * px : null, cost = sh * Number(row.entry_price);
  const valid = f.part > 0 && f.part <= 100 && !!px && px > 0 && f.date >= row.entry_date;
  const pnl = value != null ? value - cost : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Close {row.symbol}</DialogTitle>
          <DialogDescription>Bought ${cost.toLocaleString("en-US", { maximumFractionDigits: 0 })} at {row.entry_price} on {row.entry_date}. The sale is recorded in your record; a partial sale keeps the rest open.</DialogDescription>
        </DialogHeader>
        <form className="grid grid-cols-2 gap-3" onSubmit={async (e) => { e.preventDefault(); if (!valid) return; setBusy(true); const ok = await onSell(row, +sh.toFixed(6), px!, f.date, f.note.trim() || null); setBusy(false); if (ok) onOpenChange(false); }}>
          <div className="col-span-2"><span className={lbl}>How much</span>
            <div className="flex flex-wrap gap-1">
              {[25, 33, 50, 100].map((k) => <button key={k} type="button" onClick={() => setF({ ...f, part: k })} className={`rounded-md border px-2.5 py-1 font-mono text-xs ${f.part === k ? "border-primary/60 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>{k === 100 ? "All" : `${k}%`}</button>)}
              <input type="number" min={1} max={100} value={f.part} onChange={(e) => setF({ ...f, part: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} className={`${field} w-20 font-mono`} aria-label="Percent to sell" />
              <span className="self-center text-xs text-muted-foreground">%</span>
            </div></div>
          <label><span className={lbl}>Price</span><input inputMode="decimal" className={`${field} font-mono`} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
          <div><span className={lbl}>Date sold</span><TradingDatePicker value={f.date} onChange={(d) => setF({ ...f, date: d })} min={row.entry_date} /></div>
          <label className="col-span-2"><span className={lbl}>Why I sold (for the record)</span><input className={field} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. before earnings, stop hit, trimmed into strength" /></label>
          {pnl != null && <p className="col-span-2 text-sm">Sells <b className="font-mono">${value!.toLocaleString("en-US", { maximumFractionDigits: 0 })}</b> worth · result <b className="font-mono" style={{ color: pnl >= 0 ? "hsl(var(--up))" : "hsl(var(--down))" }}>{pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toLocaleString("en-US", { maximumFractionDigits: 0 })} ({((px! / row.entry_price - 1) * 100).toFixed(1)}%)</b></p>}
          <div className="col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>
            <button type="submit" disabled={!valid || busy} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40">{busy ? "Saving…" : f.part >= 100 ? "Close and record" : "Record partial sale"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Close a whole position (every buy of the symbol) at one price and date — it goes into your record. */
export function CloseAllDialog({ open, onOpenChange, symbol, lots, price, onClose }: {
  open: boolean; onOpenChange: (o: boolean) => void; symbol: string | null; lots: PositionRow[]; price: number | null;
  onClose: (symbol: string, price: number, date: string, note: string | null) => Promise<boolean>;
}) {
  const today = nyNow().date;
  const lastSession = isTradingDay(today) ? today : prevTradingDay(today);
  const [f, setF] = useState({ price: "", date: lastSession, note: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF({ price: price != null ? price.toFixed(2) : "", date: lastSession, note: "" }); }, [open, price, lastSession]);
  if (!symbol) return null;
  const px = numOrNull(f.price), shares = lots.reduce((a, l) => a + Number(l.shares), 0), cost = lots.reduce((a, l) => a + Number(l.shares) * Number(l.entry_price), 0);
  const first = lots.map((l) => l.entry_date).sort()[0] ?? lastSession;
  const pnl = px ? shares * px - cost : null;
  const valid = !!px && px > 0 && f.date >= first;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Close the {symbol} position</DialogTitle>
          <DialogDescription>Sells all {lots.length > 1 ? `${lots.length} buys` : "of it"} (${cost.toLocaleString("en-US", { maximumFractionDigits: 0 })} invested) and adds the result to your record.</DialogDescription>
        </DialogHeader>
        <form className="grid grid-cols-2 gap-3" onSubmit={async (e) => { e.preventDefault(); if (!valid) return; setBusy(true); const ok = await onClose(symbol, px!, f.date, f.note.trim() || null); setBusy(false); if (ok) onOpenChange(false); }}>
          <label><span className={lbl}>Price</span><input inputMode="decimal" className={`${field} font-mono`} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
          <div><span className={lbl}>Date sold</span><TradingDatePicker value={f.date} onChange={(d) => setF({ ...f, date: d })} min={first} /></div>
          <label className="col-span-2"><span className={lbl}>Why I sold (for the record)</span><input className={field} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. before earnings, stop hit, target reached" /></label>
          {pnl != null && <p className="col-span-2 text-sm">Result <b className="font-mono" style={{ color: pnl >= 0 ? "hsl(var(--up))" : "hsl(var(--down))" }}>{pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toLocaleString("en-US", { maximumFractionDigits: 0 })} ({((pnl / cost) * 100).toFixed(1)}%)</b></p>}
          <div className="col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>
            <button type="submit" disabled={!valid || busy} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40">{busy ? "Saving…" : "Close and record"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
