import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CHART } from "@/components/lens/QuarterlyChart";
import { NYSE_HOLIDAYS, isTradingDay, nyNow, prevTradingDay, type Bars } from "@/lib/portfolio/engine";

/**
 * Trading-day date picker: a Mon–Fri grid (weekends aren't sessions), holidays and future days off,
 * quick picks, and — when the stock's daily prices are known — each day's move, plus that day's
 * open/high/low/close with buttons to use it as the price.
 */
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const long = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
function back(d: string, sessions: number) { let x = d; for (let i = 0; i < sessions; i++) x = prevTradingDay(x); return x; }

export function TradingDatePicker({ value, onChange, bars, onUsePrice, min }: {
  value: string; onChange: (d: string) => void; bars?: Bars | null; onUsePrice?: (p: number) => void; min?: string;
}) {
  const today = nyNow().date;
  const lastSession = isTradingDay(today) ? today : prevTradingDay(today);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => ({ y: +value.slice(0, 4), m: +value.slice(5, 7) - 1 }));
  const byDate = useMemo(() => {
    const m = new Map<string, { o: number; h: number; l: number; c: number; chg: number | null }>();
    if (bars) bars.d.forEach((d, i) => m.set(d, { o: bars.o[i], h: bars.h[i], l: bars.l[i], c: bars.c[i], chg: i > 0 ? (bars.c[i] / bars.c[i - 1] - 1) * 100 : null }));
    return m;
  }, [bars]);

  const cells = useMemo(() => {
    const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
    const out: (string | null)[] = [];
    for (let d = 1; d <= days; d++) {
      const s = iso(view.y, view.m, d), w = new Date(`${s}T12:00:00Z`).getUTCDay();
      if (w === 0 || w === 6) continue;
      if (!out.length) for (let k = 1; k < w; k++) out.push(null); // Monday-first offset
      out.push(s);
    }
    return out;
  }, [view]);
  const pick = (d: string) => { onChange(d); setOpen(false); };
  const disabled = (d: string) => d > today || NYSE_HOLIDAYS.has(d) || (!!min && d < min);
  const quick = [["Today", lastSession], ["Previous session", prevTradingDay(lastSession)], ["1 week ago", back(lastSession, 5)], ["1 month ago", back(lastSession, 21)]] as const;
  const sel = byDate.get(value);
  const sessionsAgo = (() => { let n = 0, d = lastSession; while (d > value && n < 400) { d = prevTradingDay(d); n++; } return n; })();
  const shift = (k: number) => setView((v) => { const t = new Date(Date.UTC(v.y, v.m + k, 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() }; });

  return (
    <div>
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setView({ y: +value.slice(0, 4), m: +value.slice(5, 7) - 1 }); }}>
        <PopoverTrigger asChild>
          <button type="button" className="flex w-full items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-start text-sm hover:border-primary/60 focus:border-primary focus:outline-none">
            <CalendarDays size={14} className="text-primary" />
            <span className="font-mono">{long(value)}</span>
            <span className="ms-auto text-[11px] text-muted-foreground">{value === lastSession ? "today" : sessionsAgo ? `${sessionsAgo} session${sessionsAgo === 1 ? "" : "s"} ago` : ""}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[300px] p-3">
          <div className="mb-3 flex flex-wrap gap-1">
            {quick.map(([label, d]) => (
              <button key={label} type="button" disabled={disabled(d)} onClick={() => pick(d)}
                className={`rounded-md border px-2 py-0.5 text-[11px] disabled:opacity-30 ${value === d ? "border-primary/60 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>{label}</button>
            ))}
          </div>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => shift(-1)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Previous month"><ChevronLeft size={15} /></button>
            <span className="text-sm font-semibold">{new Date(Date.UTC(view.y, view.m, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</span>
            <button type="button" onClick={() => shift(1)} disabled={iso(view.y, view.m, 1) > today} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30" aria-label="Next month"><ChevronRight size={15} /></button>
          </div>
          <div className="grid grid-cols-5 gap-1 text-center">
            {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => <span key={d} className="pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{d}</span>)}
            {cells.map((d, k) => {
              if (!d) return <span key={`e${k}`} />;
              const off = disabled(d), b = byDate.get(d), holiday = NYSE_HOLIDAYS.has(d);
              return (
                <button key={d} type="button" disabled={off} onClick={() => pick(d)} title={holiday ? "Market closed" : b ? `Close ${b.c.toFixed(2)}${b.chg != null ? ` (${b.chg >= 0 ? "+" : ""}${b.chg.toFixed(2)}%)` : ""}` : undefined}
                  className={`flex h-10 flex-col items-center justify-center rounded-md text-sm transition-colors disabled:cursor-not-allowed ${value === d ? "bg-primary text-primary-foreground" : off ? "text-muted-foreground/35" : "hover:bg-muted"} ${d === lastSession && value !== d ? "ring-1 ring-primary/50" : ""} ${holiday ? "line-through" : ""}`}>
                  <span className="font-mono leading-none">{+d.slice(8)}</span>
                  {b?.chg != null && !off && <span className="mt-0.5 font-mono text-[9px] leading-none" style={{ color: value === d ? undefined : b.chg >= 0 ? CHART.positive : CHART.negative }}>{b.chg >= 0 ? "+" : ""}{b.chg.toFixed(1)}</span>}
                </button>
              );
            })}
          </div>
          {bars && <p className="mt-2 text-[10.5px] text-muted-foreground">Small numbers: the stock's move that day (%).</p>}
        </PopoverContent>
      </Popover>
      {sel && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>That day:</span>
          {([["Open", sel.o], ["Low", sel.l], ["High", sel.h], ["Close", sel.c]] as const).map(([k, v]) => (
            onUsePrice
              ? <button key={k} type="button" onClick={() => onUsePrice(+v.toFixed(2))} title={`Use ${k.toLowerCase()} as the price`} className="rounded border border-border px-1.5 py-0.5 font-mono hover:border-primary/60 hover:text-foreground">{k} {v.toFixed(2)}</button>
              : <span key={k} className="font-mono">{k} {v.toFixed(2)}</span>
          ))}
        </div>
      )}
    </div>
  );
}
