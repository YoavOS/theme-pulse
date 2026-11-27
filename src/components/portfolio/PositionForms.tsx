import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { nyNow, type PositionRow } from "@/lib/portfolio/engine";
import type { NewPosition } from "@/hooks/usePortfolio";

const field = "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary";
const lbl = "mb-1 block text-xs text-muted-foreground";
const numOrNull = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

/** Add a position, or edit one lot (`row`). Only symbol, shares, price and date are required. */
export function PositionDialog({ open, onOpenChange, row, onSave, prefill }: {
  open: boolean; onOpenChange: (o: boolean) => void; row?: PositionRow | null;
  onSave: (p: NewPosition, stop: number | null) => Promise<boolean>; prefill?: Partial<NewPosition>;
}) {
  const today = nyNow().date;
  const [f, setF] = useState({ symbol: "", shares: "", price: "", date: today, stop: "", initialStop: "", target: "", setup: "", notes: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF(row ? {
      symbol: row.symbol, shares: String(row.shares), price: String(row.entry_price), date: row.entry_date,
      stop: row.stop != null ? String(row.stop) : "", initialStop: row.initial_stop != null ? String(row.initial_stop) : "",
      target: row.target != null ? String(row.target) : "", setup: row.setup ?? "", notes: row.notes ?? "",
    } : { symbol: prefill?.symbol ?? "", shares: "", price: "", date: today, stop: "", initialStop: "", target: "", setup: "", notes: "" });
  }, [open, row, prefill?.symbol, today]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const shares = numOrNull(f.shares), price = numOrNull(f.price), stopN = numOrNull(row ? f.stop : f.initialStop), target = numOrNull(f.target);
  const valid = /^[A-Za-z][A-Za-z0-9.-]{0,9}$/.test(f.symbol.trim()) && !!shares && shares > 0 && !!price && price > 0 && /^\d{4}-\d{2}-\d{2}$/.test(f.date);
  const risk = shares && price && stopN != null && stopN < price ? { per: price - stopN, total: (price - stopN) * shares, pct: (1 - stopN / price) * 100 } : null;
  const save = async () => {
    if (!valid) return;
    setBusy(true);
    const ok = await onSave({
      symbol: f.symbol.trim().toUpperCase(), shares: shares!, entry_price: price!, entry_date: f.date,
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
          <DialogDescription>{row ? "Change this buy. The stop can move as the trade works; the first stop stays for R." : "What you bought. Stop and target are optional but unlock risk, R and alerts."}</DialogDescription>
        </DialogHeader>
        <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="col-span-2 sm:col-span-1"><span className={lbl}>Symbol</span>
            <input className={`${field} font-mono uppercase`} value={f.symbol} onChange={set("symbol")} disabled={!!row} autoFocus={!row} placeholder="NVDA" /></label>
          <label className="col-span-2 sm:col-span-1"><span className={lbl}>Date bought</span>
            <input type="date" className={field} value={f.date} max={today} onChange={set("date")} /></label>
          <label><span className={lbl}>Shares</span><input inputMode="decimal" className={`${field} font-mono`} value={f.shares} onChange={set("shares")} placeholder="100" /></label>
          <label><span className={lbl}>Price paid</span><input inputMode="decimal" className={`${field} font-mono`} value={f.price} onChange={set("price")} placeholder="125.40" /></label>
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
          <label className="col-span-2"><span className={lbl}>Why I bought it</span><textarea className={`${field} min-h-[64px]`} value={f.notes} onChange={set("notes")} placeholder="The thesis, in a sentence or two" /></label>
          {risk && <p className="col-span-2 rounded-md bg-muted/40 px-3 py-2 text-xs">Risk to stop: <b className="font-mono">${risk.total.toLocaleString("en-US", { maximumFractionDigits: 0 })}</b> (${risk.per.toFixed(2)} a share, {risk.pct.toFixed(1)}% below the price).</p>}
          <div className="col-span-2 flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => onOpenChange(false)} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>
            <button type="submit" disabled={!valid || busy} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40">{busy ? "Saving…" : row ? "Save" : "Add position"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Sell part or all of one lot. Defaults to all shares at the live price, today. */
export function SellDialog({ open, onOpenChange, row, price, onSell }: {
  open: boolean; onOpenChange: (o: boolean) => void; row: PositionRow | null; price: number | null;
  onSell: (row: PositionRow, shares: number, price: number, date: string, note: string | null) => Promise<boolean>;
}) {
  const today = nyNow().date;
  const [f, setF] = useState({ shares: "", price: "", date: today, note: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && row) setF({ shares: String(row.shares), price: price != null ? price.toFixed(2) : "", date: today, note: "" }); }, [open, row, price, today]);
  if (!row) return null;
  const sh = numOrNull(f.shares), px = numOrNull(f.price);
  const valid = !!sh && sh > 0 && sh <= Number(row.shares) + 1e-9 && !!px && px > 0 && f.date >= row.entry_date;
  const pnl = sh && px ? (px - row.entry_price) * sh : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sell {row.symbol}</DialogTitle>
          <DialogDescription>Bought {row.shares} at {row.entry_price} on {row.entry_date}. Selling part keeps the rest open.</DialogDescription>
        </DialogHeader>
        <form className="grid grid-cols-2 gap-3" onSubmit={async (e) => { e.preventDefault(); if (!valid) return; setBusy(true); const ok = await onSell(row, sh!, px!, f.date, f.note.trim() || null); setBusy(false); if (ok) onOpenChange(false); }}>
          <label><span className={lbl}>Shares sold</span><input inputMode="decimal" className={`${field} font-mono`} value={f.shares} onChange={(e) => setF({ ...f, shares: e.target.value })} /></label>
          <label><span className={lbl}>Price</span><input inputMode="decimal" className={`${field} font-mono`} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
          <label className="col-span-2"><span className={lbl}>Date</span><input type="date" className={field} min={row.entry_date} max={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label className="col-span-2"><span className={lbl}>Why I sold (for the journal)</span><input className={field} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. before earnings, stop hit, trimmed into strength" /></label>
          {pnl != null && <p className="col-span-2 font-mono text-sm" style={{ color: pnl >= 0 ? "hsl(var(--up))" : "hsl(var(--down))" }}>{pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toLocaleString("en-US", { maximumFractionDigits: 0 })} on these shares</p>}
          <div className="col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>
            <button type="submit" disabled={!valid || busy} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40">{busy ? "Saving…" : "Record sale"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
