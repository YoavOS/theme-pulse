import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Briefcase, ChevronDown, ChevronRight, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTradePositions } from "@/hooks/useTradePositions";
import { useUniverseSectors } from "@/hooks/useUniverseSectors";
import { groupKeyForIndustry } from "@/lib/groupColors";
import {
  TYPE_THROTTLE, analyzePosition, closedStats, effectiveN, streakProb,
  type Check, type Daily, type Position, type PositionView,
} from "@/lib/tradeDesk";
import { volTargetExposure } from "@/lib/marketPlaybook";

const SETTINGS_KEY = "trade_desk_settings_v1";
interface Settings { equity: number; riskPct: number; maxHeatPct: number; stressPct: number; groupHeatPct: number }
const DEFAULTS: Settings = { equity: 100000, riskPct: 0.5, maxHeatPct: 4, stressPct: 12, groupHeatPct: 1.5 };

const TONE: Record<Check["tone"], string> = {
  go: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  caution: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  stop: "border-pink-500/50 bg-pink-500/10 text-pink-200",
  info: "border-border bg-muted/30 text-muted-foreground",
};
const STRENGTH_CLS: Record<string, string> = {
  strong: "bg-emerald-500/15 text-emerald-400", moderate: "bg-sky-500/15 text-sky-300", weak: "bg-muted text-muted-foreground", "own data": "bg-amber-500/15 text-amber-300",
};
const money = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;
const rFmt = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}R`;

function readSettings(): Settings {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<Settings>) }; } catch { return DEFAULTS; }
}
function marketType(): { key: string; rv20: number | null } | null {
  try {
    const p = JSON.parse(localStorage.getItem("market_flag_cache_v2") ?? "null") as { payload?: { type?: { key: string }; metrics?: { spy?: { rv20?: number | null } } } } | null;
    const k = p?.payload?.type?.key;
    return k ? { key: k, rv20: p?.payload?.metrics?.spy?.rv20 ?? null } : null;
  } catch { return null; }
}

export default function TradeDesk() {
  const { rows, mode, error, signedIn, add, update, remove } = useTradePositions();
  const { rows: uni, extra, load: loadUni } = useUniverseSectors();
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [daily, setDaily] = useState<Record<string, Daily | null>>({});
  const [loadingBars, setLoadingBars] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState(() => {
    const q = new URLSearchParams(window.location.search);   // prefilled from the Minervini tab
    return { symbol: (q.get("symbol") ?? "").toUpperCase(), entry: q.get("entry") ?? "", stop: q.get("stop") ?? "", date: new Date().toISOString().slice(0, 10) };
  });

  useEffect(() => { loadUni(); }, [loadUni]);
  useEffect(() => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } }, [settings]);

  const open = useMemo(() => rows.filter((r) => r.status === "open"), [rows]);
  const closed = useMemo(() => rows.filter((r) => r.status === "closed"), [rows]);

  const fetchBars = useCallback(async (syms: string[]) => {
    if (!syms.length) return;
    setLoadingBars(true);
    try {
      const { data, error: e } = await supabase.functions.invoke("stage-scan", { body: { action: "positions", symbols: syms } });
      if (e) throw new Error(e.message);
      const r = data as { ok?: boolean; data?: Record<string, Daily | null>; error?: string };
      if (!r?.ok) throw new Error(r?.error ?? "Unknown action — deploy the updated stage-scan function");
      setDaily((prev) => ({ ...prev, ...(r.data ?? {}) }));
    } catch (err) {
      toast.error("Couldn't load prices", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoadingBars(false);
    }
  }, []);
  const openKey = open.map((p) => p.symbol).sort().join(",");
  useEffect(() => { void fetchBars([...new Set(open.map((p) => p.symbol))]); }, [openKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const views: PositionView[] = useMemo(
    () => open.map((p) => analyzePosition(p, daily[p.symbol], settings.equity, settings.riskPct, settings.stressPct)),
    [open, daily, settings],
  );

  const industryOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of [...extra, ...uni]) m.set(r.symbol.toUpperCase(), groupKeyForIndustry(r.sector ?? null, "industry"));
    return m;
  }, [uni, extra]);

  // ── throttle ──
  const mt = marketType();
  const stats = useMemo(() => closedStats(closed), [closed]);
  const typeMult = mt ? TYPE_THROTTLE[mt.key]?.mult ?? 1 : 1;
  const volExp = volTargetExposure(mt?.rv20 ?? null);
  const ddMult = stats && stats.ddR <= -10 ? 0.5 : stats && stats.ddR <= -6 ? 0.75 : 1;
  const mult = Math.min(typeMult, ddMult, volExp !== null ? volExp / 100 : 1);
  const riskNow = settings.riskPct * mult;

  // ── sizing calculator ──
  const entry = Number(form.entry), stop = Number(form.stop);
  const perShare = entry - stop;
  const valid = entry > 0 && stop > 0 && perShare > 0;
  const riskDollars = settings.equity * (riskNow / 100);
  const shares = valid ? Math.floor(riskDollars / perShare) : 0;
  const stopPct = valid ? (perShare / entry) * 100 : 0;
  const posPct = valid ? ((shares * entry) / settings.equity) * 100 : 0;

  // ── portfolio ──
  const heat = views.reduce((s, v) => s + v.capitalRisk, 0);
  const heatPct = (heat / settings.equity) * 100;
  const profitAtRisk = views.reduce((s, v) => s + Math.max(0, v.openRisk - v.capitalRisk), 0);
  const byGroup = new Map<string, number>();
  for (const v of views) { const g = industryOf.get(v.pos.symbol) ?? "Unknown"; byGroup.set(g, (byGroup.get(g) ?? 0) + v.capitalRisk); }
  const groupRows = [...byGroup.entries()].map(([g, r]) => ({ g, pct: (r / settings.equity) * 100 })).sort((a, b) => b.pct - a.pct);
  const eff = effectiveN(views.filter((v) => v.ok).map((v) => v.returns));
  const exposure = views.reduce((s, v) => s + v.value, 0);

  const addPosition = async () => {
    if (!valid || !form.symbol.trim()) { toast.error("Enter a ticker, an entry and a stop below the entry"); return; }
    try {
      await add({
        symbol: form.symbol.trim().toUpperCase(), entry_date: form.date, entry_price: entry, shares, initial_stop: stop, stop: null,
        status: "open", exit_date: null, exit_price: null, notes: null,
      });
      toast.success(`${form.symbol.toUpperCase()} added`);
      setForm({ ...form, symbol: "", entry: "", stop: "" });
    } catch (e) { toast.error("Couldn't save", { description: e instanceof Error ? e.message : String(e) }); }
  };

  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, [k]: Number(e.target.value) || 0 });
  const inputCls = "w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <Link to="/" className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><ArrowLeft size={14} /></Link>
          <Briefcase size={16} className="text-[hsl(200,80%,62%)]" />
          <h1 className="text-sm font-semibold tracking-wide">Trade Desk</h1>
          <span className="text-[11px] text-muted-foreground">· sizing, exits and portfolio risk</span>
          <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
            {mode === "db" ? "Saved to your account" : signedIn ? "Saved in this browser (server table not set up yet)" : <>Saved in this browser · <Link to="/login" className="underline">sign in</Link> to sync</>}
            <button onClick={() => fetchBars([...new Set(open.map((p) => p.symbol))])} disabled={loadingBars || !open.length}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50">
              {loadingBars ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Prices
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-4 py-5">
        {error && <div className="rounded-md border border-pink-500/40 bg-pink-500/10 px-3 py-2 text-xs">{error}</div>}

        {/* Settings + throttle */}
        <section className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Your risk budget</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <label className="text-[11px] text-muted-foreground">Account $<input className={inputCls} type="number" value={settings.equity} onChange={num("equity")} /></label>
              <label className="text-[11px] text-muted-foreground">Risk / trade %<input className={inputCls} type="number" step="0.05" value={settings.riskPct} onChange={num("riskPct")} /></label>
              <label className="text-[11px] text-muted-foreground">Max heat %<input className={inputCls} type="number" step="0.5" value={settings.maxHeatPct} onChange={num("maxHeatPct")} /></label>
              <label className="text-[11px] text-muted-foreground">Per group %<input className={inputCls} type="number" step="0.25" value={settings.groupHeatPct} onChange={num("groupHeatPct")} /></label>
              <label className="text-[11px] text-muted-foreground" title="Assumed overnight gap on earnings for sizing through a report">Earnings gap %<input className={inputCls} type="number" step="1" value={settings.stressPct} onChange={num("stressPct")} /></label>
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
              Research guardrails: 0.25–0.5% per trade until you have a long record; 1% is aggressive for correlated overnight stocks (10 straight losses ≈ −9.6%).
              Total open risk ("heat") 3–5%, one group 1–2%. These are starting values, not proven optima.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Risk right now</h2>
            <div className="flex items-end gap-3">
              <div className="text-3xl font-black" style={{ color: mult >= 0.95 ? "hsl(150,65%,50%)" : mult >= 0.7 ? "hsl(42,95%,60%)" : "hsl(0,80%,66%)" }}>{riskNow.toFixed(2)}%</div>
              <div className="pb-1 text-xs text-muted-foreground">per trade ({Math.round(mult * 100)}% of your {settings.riskPct}%) · {money(riskDollars)}</div>
            </div>
            <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
              <li>Market: {mt ? `${TYPE_THROTTLE[mt.key]?.why ?? mt.key} → ${Math.round(typeMult * 100)}%` : <>open <Link to="/market-flag" className="underline">Market Flag</Link> once to include it</>}</li>
              <li>Volatility targeting: {volExp !== null ? `${volExp}%` : "—"}</li>
              <li>Your drawdown: {stats ? `${stats.ddR.toFixed(1)}R from peak → ${Math.round(ddMult * 100)}%` : "no closed trades yet"}</li>
            </ul>
            <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
              A pre-committed throttle: cut size when the market, volatility or your drawdown leaves the normal range — not after an ordinary losing streak,
              which doesn't make the next trade worse. Step back up one notch at a time.
            </p>
          </div>
        </section>

        {/* Sizing */}
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Position size</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <label className="text-[11px] text-muted-foreground">Ticker<input className={inputCls} value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} placeholder="NVDA" /></label>
            <label className="text-[11px] text-muted-foreground">Entry<input className={inputCls} type="number" value={form.entry} onChange={(e) => setForm({ ...form, entry: e.target.value })} /></label>
            <label className="text-[11px] text-muted-foreground" title="Where the setup is proven wrong (handle low, breakout-day low, back inside the base) — capped near 7–8%">Stop<input className={inputCls} type="number" value={form.stop} onChange={(e) => setForm({ ...form, stop: e.target.value })} /></label>
            <label className="text-[11px] text-muted-foreground">Entry date<input className={inputCls} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
            <div className="flex items-end">
              <button onClick={addPosition} disabled={!valid || !form.symbol} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs text-primary hover:bg-primary/20 disabled:opacity-40">
                <Plus size={12} /> Add position
              </button>
            </div>
          </div>
          {valid && (
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div><div className="text-[10px] uppercase text-muted-foreground">Shares</div><div className="font-mono text-lg font-bold">{shares.toLocaleString("en-US")}</div></div>
              <div><div className="text-[10px] uppercase text-muted-foreground">Risk</div><div className="font-mono">{money(shares * perShare)} ({riskNow.toFixed(2)}%)</div></div>
              <div><div className="text-[10px] uppercase text-muted-foreground">Stop distance</div><div className={`font-mono ${stopPct > 8 ? "text-amber-300" : ""}`}>{stopPct.toFixed(1)}%</div></div>
              <div><div className="text-[10px] uppercase text-muted-foreground">Position</div><div className="font-mono">{money(shares * entry)} ({posPct.toFixed(0)}% of account)</div></div>
            </div>
          )}
          {valid && stopPct > 8 && <p className="mt-2 text-[11px] text-amber-200">Stop is more than 8% away. Keep the structural stop and take fewer shares (done above), or skip the trade — don't squeeze it into an arbitrary tighter stop.</p>}
          {valid && heatPct + riskNow > settings.maxHeatPct && <p className="mt-1 text-[11px] text-amber-200">Adding this takes open risk to {(heatPct + riskNow).toFixed(1)}% — above your {settings.maxHeatPct}% heat limit.</p>}
        </section>

        {/* Open positions */}
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Open positions</h2>
            <span className="text-[11px] text-muted-foreground">· {open.length} · exit checks update with daily closes</span>
          </div>
          {!open.length ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">No open positions. Size one above and press <b>Add position</b>.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border text-[10.5px] text-muted-foreground">
                    <th className="w-6" />
                    <th className="px-2 py-1.5 text-left font-medium">Ticker</th>
                    <th className="px-2 py-1.5 text-right font-medium">Days</th>
                    <th className="px-2 py-1.5 text-right font-medium">Entry → last</th>
                    <th className="px-2 py-1.5 text-right font-medium">Now</th>
                    <th className="px-2 py-1.5 text-right font-medium" title="Best close since entry">Best</th>
                    <th className="px-2 py-1.5 text-right font-medium">Stop</th>
                    <th className="px-2 py-1.5 text-right font-medium" title="Drop from the last close to the stop, in dollars">To stop</th>
                    <th className="px-2 py-1.5 text-left font-medium">Checks</th>
                  </tr>
                </thead>
                <tbody>
                  {views.map((v) => {
                    const p = v.pos, isOpen = expanded === p.id;
                    const worst = v.checks.find((c) => c.tone === "stop") ?? v.checks.find((c) => c.tone === "caution") ?? v.checks[0];
                    return (
                      <Fragment key={p.id}>
                        <tr className="cursor-pointer border-b border-border/30 hover:bg-accent/30" onClick={() => setExpanded(isOpen ? null : p.id)}>
                          <td className="pl-2 text-muted-foreground">{isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</td>
                          <td className="px-2 py-1.5 font-mono font-semibold">{p.symbol}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{v.ok ? v.sessions : "—"}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{p.entry_price.toFixed(2)} → {v.ok ? v.last.toFixed(2) : "…"}</td>
                          <td className={`px-2 py-1.5 text-right font-mono ${v.rNow >= 0 ? "text-emerald-400" : "text-pink-300"}`}>{v.ok ? rFmt(v.rNow) : "—"}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{v.ok ? rFmt(v.mfeR) : "—"}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{v.stopNow.toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{money(v.openRisk)}</td>
                          <td className="px-2 py-1.5">
                            {worst ? <span className={`rounded border px-1.5 py-[1px] text-[10.5px] ${TONE[worst.tone]}`}>{worst.title}{v.checks.length > 1 ? ` +${v.checks.length - 1}` : ""}</span>
                              : <span className="text-[10.5px] text-muted-foreground">{v.ok ? "on track" : loadingBars ? "loading…" : "no prices"}</span>}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-border/30 bg-muted/10">
                            <td colSpan={9} className="px-4 py-3">
                              <PositionDetail v={v} onUpdate={update} onRemove={remove} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Portfolio */}
        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-1 text-sm font-semibold">Portfolio heat</h2>
            <div className="text-3xl font-black" style={{ color: heatPct <= settings.maxHeatPct ? "hsl(150,65%,50%)" : "hsl(0,80%,66%)" }}>{heatPct.toFixed(1)}%</div>
            <div className="text-xs text-muted-foreground">capital at risk (entry → stop) · limit {settings.maxHeatPct}% · exposure {money(exposure)} ({((exposure / settings.equity) * 100).toFixed(0)}%)</div>
            <div className="text-xs text-muted-foreground">open profit given back if stops hit: {money(profitAtRisk)}</div>
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-muted"><div className="h-full rounded" style={{ width: `${Math.min(100, (heatPct / Math.max(0.1, settings.maxHeatPct)) * 100)}%`, background: heatPct <= settings.maxHeatPct ? "hsl(150,65%,45%)" : "hsl(0,72%,55%)" }} /></div>
            <p className="mt-2 text-[10.5px] text-muted-foreground">Stops are orders, not guarantees — gaps (especially earnings) can lose more than the planned risk.</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-1 text-sm font-semibold">By industry</h2>
            {!groupRows.length ? <p className="text-xs text-muted-foreground">—</p> : (
              <ul className="space-y-1 text-xs">
                {groupRows.map((r) => (
                  <li key={r.g} className="flex items-center gap-2">
                    <span className="flex-1 truncate" title={r.g}>{r.g}</span>
                    <span className={`font-mono ${r.pct > settings.groupHeatPct ? "text-amber-300" : ""}`}>{r.pct.toFixed(2)}%</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[10.5px] text-muted-foreground">Ten semiconductor stocks are one bet. Keep one group within {settings.groupHeatPct}% capital at risk.</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-1 text-sm font-semibold">Independent bets</h2>
            {eff.n >= 2 && eff.rho !== null ? (
              <>
                <div className="text-3xl font-black">{eff.eff.toFixed(1)}</div>
                <div className="text-xs text-muted-foreground">effective positions out of {eff.n} · average correlation {eff.rho.toFixed(2)} (60 days)</div>
              </>
            ) : <p className="text-xs text-muted-foreground">Needs 2+ open positions with prices.</p>}
            <p className="mt-2 text-[10.5px] text-muted-foreground">N ÷ (1 + (N−1)·ρ). Eight stocks at 0.5 correlation are less than two independent bets — and correlations jump in selloffs.</p>
          </div>
        </section>

        {/* Closed trades */}
        <ClosedTrades closed={closed} stats={stats} onRemove={remove} />

        <section className="rounded-lg border border-border bg-card p-4 text-[11px] leading-relaxed text-muted-foreground">
          <h2 className="mb-1 text-sm font-semibold text-foreground">How the exit checks were chosen</h2>
          <p>
            Tested on your list: 3,890 breakouts above a 40-day high in Stage-2-like trends (Oct 2024–Oct 2026), 8% initial stop, results in R.
            Average result by exit rule: 5× ATR trailing stop <b className="text-foreground">+0.50R</b> · 2 closes below the 50-day <b className="text-foreground">+0.40R</b> ·
            1 close below the 50-day +0.32R · half at +20%, rest on the 50-day +0.28R · fixed +20% target +0.23R · 3× ATR trail +0.22R · 21-day EMA +0.18R.
            Win rates were only 30–37% under every rule and the best 10% of trades made more than all the profit — so the checks protect against losses
            without cutting winners short. A 10-day stall rule didn't change returns but freed capital. Today's stocks only (survivorship), 2-year window.
          </p>
          <p className="mt-1">
            Research agrees (Han, Zhou &amp; Zhu on momentum stop-losses; Zarattini et al. 2026 on 66,000 all-time-high breakouts; Bessembinder 2018 on how few stocks create most gains):
            cut failed trades early, then use a wide trend exit; sell into extremes only partially; treat earnings as a sizing decision, not an automatic sale.
          </p>
        </section>
      </main>
    </div>
  );
}

function PositionDetail({ v, onUpdate, onRemove }: { v: PositionView; onUpdate: (id: string, p: Partial<Position>) => Promise<void>; onRemove: (id: string) => Promise<void> }) {
  const [stop, setStop] = useState(v.stopNow.toFixed(2));
  const [exitPx, setExitPx] = useState(v.last.toFixed(2));
  const p = v.pos;
  const save = async (patch: Partial<Position>, msg: string) => {
    try { await onUpdate(p.id, patch); toast.success(msg); } catch (e) { toast.error("Couldn't save", { description: e instanceof Error ? e.message : String(e) }); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-2">
        {v.checks.length === 0 && <p className="text-xs text-muted-foreground">No flags — the trade is behaving. Keep the stop where it is.</p>}
        {v.checks.map((c) => (
          <div key={c.title} className={`rounded-md border px-3 py-2 text-xs ${TONE[c.tone]}`}>
            <div className="flex items-center justify-between gap-2">
              <b>{c.title}</b>
              {c.strength && <span className={`rounded px-1.5 py-[1px] text-[10px] ${STRENGTH_CLS[c.strength]}`}>{c.strength}</span>}
            </div>
            <p className="mt-0.5 leading-relaxed opacity-90">{c.text}</p>
          </div>
        ))}
      </div>
      <div className="space-y-3 text-xs">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Stop levels</div>
          <ul className="space-y-1">
            {v.suggest.map((s) => (
              <li key={s.label} className="flex items-center gap-2">
                <button className="rounded border border-border px-1.5 font-mono hover:bg-accent" onClick={() => setStop(s.level.toFixed(2))}>{s.level.toFixed(2)}</button>
                <span className="text-muted-foreground">{s.label}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center gap-2">
            <input className="w-24 rounded-md border border-border bg-background px-2 py-1 font-mono" value={stop} onChange={(e) => setStop(e.target.value)} />
            <button className="rounded-md border border-border px-2 py-1 hover:bg-accent" onClick={() => {
              const s = Number(stop);
              if (!(s > 0)) return;
              if (s < v.stopNow) { toast.error("Never lower a stop — it only moves up"); return; }
              void save({ stop: s }, `${p.symbol} stop set to ${s.toFixed(2)}`);
            }}>Set stop</button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input className="w-24 rounded-md border border-border bg-background px-2 py-1 font-mono" value={exitPx} onChange={(e) => setExitPx(e.target.value)} />
          <button className="rounded-md border border-border px-2 py-1 hover:bg-accent" onClick={() => {
            const x = Number(exitPx);
            if (!(x > 0)) return;
            void save({ status: "closed", exit_price: x, exit_date: new Date().toISOString().slice(0, 10) }, `${p.symbol} closed`);
          }}>Close position</button>
          <button className="ml-auto flex items-center gap-1 rounded-md border border-border px-2 py-1 text-muted-foreground hover:bg-accent" onClick={() => { if (confirm(`Delete ${p.symbol}? This can't be undone.`)) void onRemove(p.id); }}>
            <Trash2 size={11} /> Delete
          </button>
        </div>
        <div className="font-mono text-[11px] text-muted-foreground">
          {p.shares.toLocaleString("en-US")} sh · entry {p.entry_price.toFixed(2)} on {p.entry_date} · initial stop {p.initial_stop.toFixed(2)} (1R = {v.R.toFixed(2)})
          {v.ema21 !== null && ` · 21EMA ${v.ema21.toFixed(2)}`}{v.sma50 !== null && ` · 50D ${v.sma50.toFixed(2)}`}{v.atr !== null && ` · ATR ${v.atr.toFixed(2)}`}
        </div>
      </div>
    </div>
  );
}

function ClosedTrades({ closed, stats, onRemove }: { closed: Position[]; stats: ReturnType<typeof closedStats>; onRemove: (id: string) => Promise<void> }) {
  const win = stats?.win ?? 0.4;
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold">Closed trades</h2>
        {stats && <span className="text-[11px] text-muted-foreground">· {stats.n} trades · win {(stats.win * 100).toFixed(0)}% · average {rFmt(stats.avgR)} · total {rFmt(stats.sumR)} · longest losing streak {stats.maxStreak}</span>}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="max-h-56 overflow-auto">
          {!closed.length ? <p className="text-xs text-muted-foreground">Closed trades appear here with their result in R.</p> : (
            <table className="w-full text-xs">
              <tbody>
                {closed.map((p) => {
                  const r = p.exit_price !== null ? (p.exit_price - p.entry_price) / Math.max(1e-9, p.entry_price - p.initial_stop) : null;
                  return (
                    <tr key={p.id} className="border-b border-border/30">
                      <td className="py-1 font-mono font-semibold">{p.symbol}</td>
                      <td className="py-1 font-mono text-muted-foreground">{p.entry_date} → {p.exit_date ?? "—"}</td>
                      <td className={`py-1 text-right font-mono ${r !== null && r > 0 ? "text-emerald-400" : "text-pink-300"}`}>{r !== null ? rFmt(r) : "—"}</td>
                      <td className="w-6 text-right"><button className="text-muted-foreground hover:text-foreground" title="Delete" onClick={() => { if (confirm(`Delete ${p.symbol}?`)) void onRemove(p.id); }}><Trash2 size={11} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="text-xs">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Losing streaks are normal</div>
          <p className="text-muted-foreground">Chance of at least one streak in your next 100 trades at a {(win * 100).toFixed(0)}% win rate{stats ? "" : " (typical for breakouts)"}:</p>
          <ul className="mt-1 space-y-0.5 font-mono">
            {[5, 8, 10].map((L) => <li key={L}>{L}+ losses in a row: <b>{Math.round(streakProb(100, L, win) * 100)}%</b></li>)}
          </ul>
          <p className="mt-2 text-[10.5px] text-muted-foreground">An ordinary streak isn't evidence the method stopped working. Cut size when the drawdown leaves its normal range, the market turns hostile, or you stop following the plan — and never size up to win it back.</p>
        </div>
      </div>
    </section>
  );
}
