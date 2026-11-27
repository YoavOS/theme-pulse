import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Briefcase, Loader2, Plus, RefreshCw, Settings2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Hero, SectionHead, Watch, type Kpi } from "@/components/lens/LensUI";
import { AutoTerms } from "@/components/lens/Term";
import { GlossaryProvider } from "@/components/lens/GlossaryBrowser";
import { TvExportButton } from "@/components/ai/TvExportButton";
import { usePortfolio } from "@/hooks/usePortfolio";
import { headline, marketOpen, type PositionRow } from "@/lib/portfolio/engine";
import { AttentionPanel, ClosedPanel, EarningsPanel, ExposurePanel, HoldingsTable, NewsFeed, PositionSheet, dayLabel, pctS, usd, usdSigned } from "@/components/portfolio/PortfolioViews";
import { PositionDialog, SellDialog } from "@/components/portfolio/PositionForms";

/**
 * Portfolio — the positions you type in, with everything the app knows about each one:
 * live P&L and risk, when it reports (and the last full session before that), technicals, RS and
 * stage, news, exposure, and your closed-trade record. Same design as the Fundamentals tab.
 */
export default function Portfolio() {
  const p = usePortfolio();
  const [open, setOpen] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [prefill, setPrefill] = useState<string | null>(null);
  const [edit, setEdit] = useState<PositionRow | null>(null);
  const [selling, setSelling] = useState<PositionRow | null>(null);
  const [deleting, setDeleting] = useState<PositionRow | null>(null);
  useEffect(() => { document.title = "Portfolio"; }, []);

  const s = p.summary, warn = p.settings.warnSessions;
  const soon = s.reportsSoon.filter((r) => r.plan.sessionsLeft <= warn);
  const kpis: Kpi[] = [
    { label: "Market value", value: usd(s.marketValue), caption: s.invested != null ? `${s.invested.toFixed(0)}% of the account invested` : `${s.positions} position${s.positions === 1 ? "" : "s"}`, tone: "neutral" },
    { label: "Today", value: usdSigned(s.dayPnl), caption: pctS(s.dayPct, 2) },
    { label: "Open P&L", value: usdSigned(s.openPnl), caption: `${pctS(s.openPct)} on ${usd(s.cost)} cost` },
    { label: "Open risk", value: s.openRisk != null ? usd(s.openRisk) : "—", caption: s.openRiskPct != null ? `${s.openRiskPct.toFixed(2)}% of the account if every stop is hit` : "if every stop is hit", tone: "warn" },
  ];
  const paras: string[] = [];
  if (s.positions) {
    if (soon.length) paras.push(soon.map((r) => `${r.symbol} reports ${dayLabel(r.plan.date)} (${r.plan.bell === "before" ? "before the open" : r.plan.bell === "after" ? "after the close" : "time not announced"}) — last full session ${dayLabel(r.plan.lastSession)}`).join("; ") + ".");
    const hi = p.alerts.filter((a) => a.level === "high" && a.kind !== "earnings");
    if (hi.length) paras.push(hi.map((a) => `${a.symbol}: ${a.text.toLowerCase()}`).join("; ") + ".");
    const best = [...p.holdings].sort((a, b) => (b.openPct ?? -1e9) - (a.openPct ?? -1e9))[0], worst = [...p.holdings].sort((a, b) => (a.openPct ?? 1e9) - (b.openPct ?? 1e9))[0];
    if (p.holdings.length > 1 && best && worst) paras.push(`Best: ${best.symbol} ${pctS(best.openPct)}. Weakest: ${worst.symbol} ${pctS(worst.openPct)}.${s.exposure[0] ? ` Largest group: ${s.exposure[0].name} (${s.exposure[0].weight.toFixed(0)}%).` : ""}`);
  }
  const tvSyms = p.holdings.map((h) => h.symbol);

  return (
    <GlossaryProvider>
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={15} /> Dashboard</Link>
          <h1 className="inline-flex items-center gap-2 text-lg font-semibold"><Briefcase size={17} className="text-primary" /> Portfolio</h1>
          <span className="text-[11px] text-muted-foreground">{marketOpen() ? "Market open · prices refresh every minute" : "Market closed"}{p.updatedAt ? ` · updated ${p.updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
          <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
            {tvSyms.length > 0 && <TvExportButton fileName="Portfolio" options={[{ label: "Holdings", sections: [{ name: "Portfolio", symbols: tvSyms }] }]} />}
            <Popover>
              <PopoverTrigger asChild><button className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground"><Settings2 size={13} />Settings</button></PopoverTrigger>
              <PopoverContent align="end" className="w-72 space-y-3 text-sm">
                <label className="block"><span className="mb-1 block text-xs text-muted-foreground">Account size (optional) — for cash, % invested and risk as % of the account</span>
                  <input inputMode="decimal" defaultValue={p.settings.accountSize ?? ""} onBlur={(e) => { const v = e.target.value.trim(); void p.setSettings({ accountSize: v === "" ? null : Number(v) || null }); }}
                    className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono" placeholder="100000" /></label>
                <label className="block"><span className="mb-1 block text-xs text-muted-foreground">Warn about earnings this many sessions ahead</span>
                  <input type="number" min={1} max={20} defaultValue={p.settings.warnSessions} onBlur={(e) => void p.setSettings({ warnSessions: Math.max(1, Math.min(20, Number(e.target.value) || 5)) })}
                    className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono" /></label>
              </PopoverContent>
            </Popover>
            <button onClick={() => void p.refresh()} disabled={p.liveLoading} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-50">
              {p.liveLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}Refresh</button>
            <button onClick={() => { setPrefill(null); setAddOpen(true); }} className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground"><Plus size={13} />Add position</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-5 px-4 py-5">
        {p.error && <Watch>{p.error}</Watch>}
        {p.loading ? <p className="py-20 text-center text-sm text-muted-foreground">Loading…</p> : (
          <>
            <Hero eyebrow={`Portfolio · ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}`} title={headline(s, warn)}
              meta={s.positions ? `${s.positions} holding${s.positions === 1 ? "" : "s"} · ${p.closed.length} closed trade${p.closed.length === 1 ? "" : "s"}${s.cash != null ? ` · cash ${usd(s.cash)}` : ""}` : undefined}
              aside={s.positions ? { title: "The account right now", subtitle: "Live quotes; daily closes when the market is shut", items: kpis } : undefined}
              steps={s.positions ? [
                { label: "01 · Positions", question: "What do I hold, and how is each doing?", target: "pf-holdings" },
                { label: "02 · Earnings", question: "When does each one report?", target: "pf-earnings" },
                { label: "03 · News", question: "What's being said about them?", target: "pf-news" },
              ] : undefined}>
              {s.positions ? paras.map((t, i) => <p key={i} className={i === paras.length - 1 && paras.length > 1 ? "text-muted-foreground" : ""}><AutoTerms text={t} /></p>)
                : <>
                  <p>Type in what you bought: symbol, shares, price and date. A stop and target are optional.</p>
                  <p className="text-muted-foreground">Each holding then gets its live P&amp;L, risk to the stop, RS rating and stage, distance from the 21-day EMA and 50-day average, the next earnings date with the last full session before it, the last reports and how the stock reacted, and its news.</p>
                  <button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"><Plus size={14} />Add your first position</button>
                </>}
            </Hero>

            {s.positions > 0 && (
              <>
                <AttentionPanel alerts={p.alerts} onOpen={setOpen} />
                <SectionHead id="pf-holdings" title="Positions" subtitle="Click a row for the chart, earnings history, your buys and news. Sort by any column." />
                <HoldingsTable p={p} onOpen={setOpen} />
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                  <EarningsPanel p={p} onOpen={setOpen} />
                  <ExposurePanel s={s} groupBy={p.settings.groupBy} onGroupBy={(g) => void p.setSettings({ groupBy: g })} />
                </div>
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                  <NewsFeed p={p} onOpen={setOpen} />
                  <ClosedPanel p={p} onEdit={setEdit} onDelete={setDeleting} />
                </div>
              </>
            )}
            {s.positions === 0 && p.closed.length > 0 && <ClosedPanel p={p} onEdit={setEdit} onDelete={setDeleting} />}
          </>
        )}
      </main>

      <PositionSheet symbol={open} p={p} onClose={() => setOpen(null)} onEdit={setEdit} onSell={setSelling} onDelete={setDeleting}
        onAddMore={(sym) => { setPrefill(sym); setAddOpen(true); }} />
      <PositionDialog open={addOpen} onOpenChange={setAddOpen} prefill={prefill ? { symbol: prefill } : undefined} onSave={(np) => p.add(np)} />
      <PositionDialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} row={edit}
        onSave={(np, stop) => p.update(edit!.id, { entry_price: np.entry_price, shares: np.shares, entry_date: np.entry_date, initial_stop: np.initial_stop, stop, target: np.target, setup: np.setup, notes: np.notes })} />
      <SellDialog open={!!selling} onOpenChange={(o) => !o && setSelling(null)} row={selling} price={selling ? p.holdings.find((h) => h.symbol === selling.symbol)?.price ?? null : null} onSell={p.sell} />
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this {deleting?.status === "closed" ? "trade" : "buy"}?</AlertDialogTitle>
            <AlertDialogDescription>{deleting ? `${deleting.symbol}: ${deleting.shares} shares at ${deleting.entry_price} on ${deleting.entry_date}.` : ""} This removes it for good — to record a sale, use Sell instead.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={async () => { if (deleting) { await p.remove(deleting.id); setDeleting(null); } }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </GlossaryProvider>
  );
}
