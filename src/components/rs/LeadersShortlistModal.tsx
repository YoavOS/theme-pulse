import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Copy, Crown, Download, ListTree, Settings2, Trophy } from "lucide-react";
import { toast } from "sonner";
import type { RsStock } from "@/hooks/useRsAlpha";
import { useSuperperformance } from "@/hooks/useSuperperformance";
import { loadStages, STAGE_COLORS, type StockStage } from "@/lib/stageAnalysis";
import { groupKeyForIndustry } from "@/lib/groupColors";
import { tvSectionsText } from "@/lib/tvSections";
import {
  FUNDAMENTAL_KEYS, PROFILE_BY_KEY, breakoutSetup, savedScore, shortTermMomentum,
  type ProfileKey,
} from "@/lib/superperfProfiles";

/**
 * Leaders shortlist: the few stocks that are strong on every front at once —
 * earnings (Superperformance profiles), relative strength, a Stage 2 uptrend,
 * a tight base near the high — ranked by one combined score and ready to export.
 */

type SortKey = "composite" | "rs" | "fund" | "momentum" | "setup";

interface Settings {
  profiles: ProfileKey[];
  match: "any" | "all";
  minRs: number;
  stage2Only: boolean;
  includeLateBase: boolean;
  maxFromHigh: number;       // %, 0 = off
  maxTight: number;          // × ADR, 0 = off
  notExtended: boolean;      // within 3 ADRs of the 21-day EMA
  minMomentum: number;       // 0 = off
  minSetup: number;          // 0 = off
  earningsBuffer: number;    // days, 0 = off
  maxPerGroup: number;       // 0 = no cap
  maxSize: number;
  sort: SortKey;
  weights: { fund: number; rs: number; momentum: number; setup: number };
}

const KEY = "leaders_shortlist_v1";
const DEFAULTS: Settings = {
  profiles: ["current", "minervini", "momentum"], match: "any",
  minRs: 85, stage2Only: true, includeLateBase: false,
  maxFromHigh: 15, maxTight: 0, notExtended: true,
  minMomentum: 0, minSetup: 0, earningsBuffer: 5,
  maxPerGroup: 3, maxSize: 25, sort: "composite",
  weights: { fund: 35, rs: 25, momentum: 20, setup: 20 },
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS, weights: { ...DEFAULTS.weights } };
    const p = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULTS, ...p, weights: { ...DEFAULTS.weights, ...(p.weights ?? {}) }, profiles: (p.profiles ?? DEFAULTS.profiles).filter((k) => FUNDAMENTAL_KEYS.includes(k)) };
  } catch { return { ...DEFAULTS, weights: { ...DEFAULTS.weights } }; }
}

interface Row {
  s: RsStock; stage: StockStage | null; group: string;
  rs: number | null; fund: number | null; fundKey: ProfileKey | null; momentum: number | null; setup: number | null;
  composite: number; fromHigh: number | null; erDays: number | null;
}

const daysUntil = (iso: string) => Math.ceil((new Date(iso + "T12:00:00Z").getTime() - Date.now()) / 86_400_000);

function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return <label className="flex cursor-pointer items-center gap-2 text-xs"><Checkbox checked={on} onCheckedChange={(v) => onChange(v === true)} />{children}</label>;
}

function Range({ label, value, min, max, step = 1, off, fmt, onChange }: { label: string; value: number; min: number; max: number; step?: number; off?: boolean; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs"><span>{label}</span><span className="font-mono text-[hsl(40,90%,60%)]">{off && value === 0 ? "off" : fmt(value)}</span></div>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} />
    </div>
  );
}

export default function LeadersShortlistModal({ open, onOpenChange, stocks, isOtcSymbol }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  stocks: RsStock[];
  isOtcSymbol: (sym: string) => boolean;
}) {
  const { rows: saved, thresholds } = useSuperperformance();
  const [st, setSt] = useState<Settings>(() => loadSettings());
  const [showSettings, setShowSettings] = useState(true);
  const [stages, setStages] = useState<Map<string, StockStage>>(new Map());
  const [stagesState, setStagesState] = useState<"loading" | "ok" | "empty">("loading");

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ } }, [st]);
  useEffect(() => {
    if (!open) return;
    loadStages()
      .then((r) => { setStages(new Map(r.map((x) => [x.symbol.toUpperCase(), x]))); setStagesState(r.length ? "ok" : "empty"); })
      .catch(() => setStagesState("empty"));
  }, [open]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSt((p) => ({ ...p, [k]: v }));

  /** Overall RS rating 1–99: rank of rsOverall within the whole list. */
  const rating = useMemo(() => {
    const vals = stocks.filter((s) => typeof s.rsOverall === "number").sort((a, b) => (a.rsOverall as number) - (b.rsOverall as number));
    const m = new Map<string, number>();
    vals.forEach((s, i) => m.set(s.symbol, Math.max(1, Math.min(99, Math.round(((i + 1) / vals.length) * 99)))));
    return m;
  }, [stocks]);

  const savedBy = useMemo(() => new Map(saved.map((r) => [r.symbol.toUpperCase(), r])), [saved]);

  const { rows, counts } = useMemo(() => {
    const counts = { total: 0, fund: 0, rs: 0, stage: 0, price: 0, earnings: 0 };
    const out: Row[] = [];
    const w = st.weights;
    for (const s of stocks) {
      if (isOtcSymbol(s.symbol)) continue;
      counts.total++;
      const sym = s.symbol.toUpperCase();
      const row = savedBy.get(sym);
      // 1) Earnings: pass the chosen Superperformance profiles.
      const fs = st.profiles.map((k) => ({ k, v: savedScore(row, k) }));
      const pass = (x: { k: ProfileKey; v: number | null }) => x.v !== null && x.v >= thresholds[x.k];
      const fundOk = st.profiles.length === 0 ? true : st.match === "all" ? fs.every(pass) : fs.some(pass);
      if (!fundOk) continue;
      counts.fund++;
      // 2) Relative strength.
      const rs = rating.get(s.symbol) ?? null;
      if (rs === null || rs < st.minRs) continue;
      counts.rs++;
      // 3) Trend.
      const stage = stages.get(sym) ?? null;
      if (st.stage2Only) {
        const ok = stage && (stage.stage === 2 || (st.includeLateBase && stage.substage === "1B"));
        if (!ok) continue;
      }
      counts.stage++;
      // 4) Price position.
      const f = stage?.features, d = f?.dly;
      const fromHigh = typeof f?.pctFrom52wHigh === "number" ? Math.abs(f.pctFrom52wHigh) : null;
      if (st.maxFromHigh > 0 && (fromHigh === null || fromHigh > st.maxFromHigh)) continue;
      if (st.maxTight > 0 && (typeof d?.tight !== "number" || d.tight > st.maxTight)) continue;
      if (st.notExtended && d && typeof d.ema21Pct === "number" && d.ema21Pct > (d.adrPct > 0 ? d.adrPct : 4) * 3) continue;
      const inputs = { stage, rsRating: rs, rs1w: s.rs1w, rs1m: s.rs1m, rsNewHigh: s.rsNh20d };
      const momentum = shortTermMomentum(inputs).score;
      const setup = breakoutSetup(inputs).score;
      if (st.minMomentum > 0 && (momentum ?? 0) < st.minMomentum) continue;
      if (st.minSetup > 0 && (setup ?? 0) < st.minSetup) continue;
      counts.price++;
      // 5) Earnings date: skip stocks about to report.
      const erDays = row?.next_report ? daysUntil(row.next_report) : null;
      if (st.earningsBuffer > 0 && erDays !== null && erDays >= 0 && erDays <= st.earningsBuffer) continue;
      counts.earnings++;
      const best = fs.filter((x) => x.v !== null).sort((a, b) => (b.v as number) - (a.v as number))[0] ?? null;
      const fund = best?.v ?? null;
      const parts: [number | null, number][] = [[fund, w.fund], [rs, w.rs], [momentum, w.momentum], [setup, w.setup]];
      const den = parts.reduce((a, [v, wt]) => a + (v === null ? 0 : wt), 0);
      const composite = den > 0 ? Math.round(parts.reduce((a, [v, wt]) => a + (v ?? 0) * wt, 0) / den) : 0;
      out.push({ s, stage, group: groupKeyForIndustry(s.sector, "industry"), rs, fund, fundKey: best?.k ?? null, momentum, setup, composite, fromHigh, erDays });
    }
    const key = (r: Row) => st.sort === "rs" ? r.rs ?? 0 : st.sort === "fund" ? r.fund ?? 0 : st.sort === "momentum" ? r.momentum ?? 0 : st.sort === "setup" ? r.setup ?? 0 : r.composite;
    out.sort((a, b) => key(b) - key(a) || b.composite - a.composite);
    // Spread across industries, then cut to size.
    const perGroup = new Map<string, number>();
    const capped = out.filter((r) => {
      if (st.maxPerGroup <= 0) return true;
      const n = perGroup.get(r.group) ?? 0;
      if (n >= st.maxPerGroup) return false;
      perGroup.set(r.group, n + 1);
      return true;
    });
    return { rows: capped.slice(0, st.maxSize), counts };
  }, [stocks, isOtcSymbol, savedBy, st, thresholds, rating, stages]);

  const copy = async (text: string, msg: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(msg); } catch { toast.error("Copy failed"); }
  };
  const sectionsText = () => tvSectionsText(rows.map((r) => ({ symbol: r.s.symbol, group: r.group, score: r.composite })));
  const download = () => {
    const blob = new Blob([sectionsText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `Leaders_${rows.length}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const fundKeys = FUNDAMENTAL_KEYS as ProfileKey[];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-5xl flex-col gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Crown size={18} className="text-[hsl(40,90%,55%)]" /> Leaders shortlist</DialogTitle>
          <DialogDescription>
            Stocks that are strong on every front at once: earnings, relative strength, a Stage 2 uptrend and a good spot
            on the chart. Settings are saved on this device.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {stagesState === "empty" && (
            <div className="rounded-lg border border-[hsl(40,80%,50%)]/40 bg-[hsl(40,80%,50%)]/10 px-4 py-2.5 text-xs">
              No Stages data yet, so the trend and chart filters can't run. Run the Stages scan first.
            </div>
          )}

          <div className="rounded-lg border border-border bg-card">
            <button type="button" onClick={() => setShowSettings((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
              <span className="flex items-center gap-2 text-sm font-semibold"><Settings2 size={14} /> Settings</span>
              <span className="text-xs text-muted-foreground">
                {counts.total.toLocaleString()} stocks → {counts.fund} pass earnings → {counts.rs} RS → {counts.stage} trend → {counts.price} chart → {counts.earnings} no report soon
              </span>
            </button>
            {showSettings && (
              <div className="grid gap-5 border-t border-border p-4 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">1 · Earnings</div>
                  <div className="flex flex-wrap gap-1.5">
                    {fundKeys.map((k) => {
                      const on = st.profiles.includes(k);
                      return (
                        <button key={k} type="button" title={PROFILE_BY_KEY.get(k)?.help} aria-pressed={on}
                          onClick={() => set("profiles", on ? st.profiles.filter((x) => x !== k) : [...st.profiles, k])}
                          className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-[hsl(40,90%,55%)] bg-[hsl(40,90%,55%)]/15 text-[hsl(40,90%,70%)]" : "border-border text-muted-foreground hover:text-foreground"}`}>
                          {PROFILE_BY_KEY.get(k)?.short} ≥{thresholds[k]}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Must pass</span>
                    {(["any", "all"] as const).map((m) => (
                      <button key={m} type="button" aria-pressed={st.match === m} onClick={() => set("match", m)}
                        className={`rounded px-2 py-0.5 ${st.match === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{m === "any" ? "any" : "all"}</button>
                    ))}
                    <span className="text-muted-foreground">· thresholds come from the Superperformance window</span>
                  </div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">2 · Relative strength</div>
                  <Range label="Minimum RS rating (overall)" value={st.minRs} min={50} max={99} fmt={(v) => `${v}+`} onChange={(v) => set("minRs", v)} />
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">3 · Trend</div>
                  <Toggle on={st.stage2Only} onChange={(v) => set("stage2Only", v)}>Stage 2 only</Toggle>
                  {st.stage2Only && <Toggle on={st.includeLateBase} onChange={(v) => set("includeLateBase", v)}>Also late bases about to break out (1B)</Toggle>}
                </div>
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">4 · Chart</div>
                  <Range label="Max distance below the 52-week high" value={st.maxFromHigh} min={0} max={40} off fmt={(v) => `${v}%`} onChange={(v) => set("maxFromHigh", v)} />
                  <Range label="Max 10-day range (tightness)" value={st.maxTight} min={0} max={4} step={0.25} off fmt={(v) => `${v.toFixed(2)}× ADR`} onChange={(v) => set("maxTight", v)} />
                  <Toggle on={st.notExtended} onChange={(v) => set("notExtended", v)}>Skip stocks stretched far above the 21-day EMA (3+ ADRs)</Toggle>
                  <Range label="Min short-term momentum score" value={st.minMomentum} min={0} max={95} step={5} off fmt={(v) => `${v}+`} onChange={(v) => set("minMomentum", v)} />
                  <Range label="Min breakout setup score" value={st.minSetup} min={0} max={95} step={5} off fmt={(v) => `${v}+`} onChange={(v) => set("minSetup", v)} />
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">5 · Risk and size</div>
                  <Range label="Skip stocks reporting earnings within" value={st.earningsBuffer} min={0} max={21} off fmt={(v) => `${v} day${v === 1 ? "" : "s"}`} onChange={(v) => set("earningsBuffer", v)} />
                  <Range label="Max stocks per industry" value={st.maxPerGroup} min={0} max={10} off fmt={(v) => String(v)} onChange={(v) => set("maxPerGroup", v)} />
                  <Range label="List size" value={st.maxSize} min={5} max={100} step={5} fmt={(v) => String(v)} onChange={(v) => set("maxSize", v)} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Combined score weights</div>
                  <div className="grid gap-3 sm:grid-cols-4">
                    {(["fund", "rs", "momentum", "setup"] as const).map((k) => (
                      <Range key={k} label={{ fund: "Earnings", rs: "RS", momentum: "Momentum", setup: "Setup" }[k]} value={st.weights[k]} min={0} max={60} step={5}
                        fmt={(v) => String(v)} onChange={(v) => set("weights", { ...st.weights, [k]: v })} />
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <Button size="sm" variant="ghost" onClick={() => setSt({ ...DEFAULTS, weights: { ...DEFAULTS.weights } })}>Reset settings</Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                Shortlist <span className="font-normal text-muted-foreground">({rows.length})</span>
                <select value={st.sort} onChange={(e) => set("sort", e.target.value as SortKey)} aria-label="Sort by"
                  className="ml-2 h-7 rounded-md border border-border bg-background px-2 text-xs font-normal">
                  <option value="composite">Sort: combined score</option>
                  <option value="rs">Sort: RS rating</option>
                  <option value="fund">Sort: earnings score</option>
                  <option value="momentum">Sort: momentum</option>
                  <option value="setup">Sort: setup</option>
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" disabled={!rows.length} onClick={() => copy(rows.map((r) => r.s.symbol).join(","), `${rows.length} tickers copied`)}><Copy size={14} className="mr-1" /> Copy</Button>
                <Button size="sm" variant="outline" disabled={!rows.length} onClick={() => copy(sectionsText(), "Copied as TradingView sections, best industries first")}><ListTree size={14} className="mr-1" /> TradingView sections</Button>
                <Button size="sm" variant="outline" disabled={!rows.length} onClick={download}><Download size={14} className="mr-1" /> .txt</Button>
              </div>
            </div>
            {rows.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {saved.length === 0 ? "No earnings scores yet. Run the Superperformance scan first." : "Nothing passes every filter. Loosen a setting above; the counts show where stocks drop out."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-2 py-1.5 text-left font-medium">#</th>
                      <th className="px-2 py-1.5 text-left font-medium">Stock</th>
                      <th className="px-2 py-1.5 text-left font-medium">Industry</th>
                      <th className="px-2 py-1.5 text-left font-medium">Stage</th>
                      <th className="px-2 py-1.5 text-right font-medium">RS</th>
                      <th className="px-2 py-1.5 text-right font-medium" title="Best score among the chosen earnings profiles">Earnings</th>
                      <th className="px-2 py-1.5 text-right font-medium" title="Short-term momentum (live)">Mom.</th>
                      <th className="px-2 py-1.5 text-right font-medium" title="Breakout setup (live)">Setup</th>
                      <th className="px-2 py-1.5 text-right font-medium">From high</th>
                      <th className="px-2 py-1.5 text-right font-medium">Combined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.s.symbol} className="border-b border-border/40 hover:bg-muted/30">
                        <td className="px-2 py-1.5 font-mono text-xs text-muted-foreground">{i + 1}</td>
                        <td className="px-2 py-1.5">
                          <a href={`https://www.tradingview.com/symbols/${r.s.symbol}/`} target="_blank" rel="noopener noreferrer" className="group inline-flex items-baseline gap-2">
                            <span className="font-mono font-bold group-hover:text-primary">{r.s.symbol}</span>
                            {r.s.companyName && <span className="hidden max-w-[140px] truncate text-xs text-muted-foreground lg:inline">{r.s.companyName}</span>}
                          </a>
                          {r.erDays !== null && r.erDays >= 0 && r.erDays <= 21 && <span className="ml-1.5 rounded bg-[hsl(40,80%,50%)]/15 px-1 text-[10px] text-[hsl(40,90%,62%)]">ER {r.erDays}d</span>}
                        </td>
                        <td className="max-w-[160px] truncate px-2 py-1.5 text-xs text-muted-foreground" title={r.group}>{r.group}</td>
                        <td className="px-2 py-1.5 text-xs">
                          {r.stage ? <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: STAGE_COLORS[r.stage.stage] }} />{r.stage.substage || r.stage.stage}</span> : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-xs">{r.rs ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-xs" title={r.fundKey ? PROFILE_BY_KEY.get(r.fundKey)?.label : undefined}>
                          {r.fund ?? "—"}{r.fundKey && <span className="ml-1 text-[10px] text-muted-foreground">{PROFILE_BY_KEY.get(r.fundKey)?.short}</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-xs">{r.momentum ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-xs">{r.setup ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-xs">{r.fromHigh !== null ? `${r.fromHigh.toFixed(1)}%` : "—"}</td>
                        <td className="px-2 py-1.5 text-right"><span className="inline-flex items-center gap-1 font-mono font-bold text-[hsl(40,90%,60%)]">{i < 3 && <Trophy size={11} />}{r.composite}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
