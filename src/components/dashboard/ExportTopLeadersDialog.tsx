import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ThemeData } from "@/data/themeData";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Copy, Download, Check, Trophy, Settings2, RotateCcw } from "lucide-react";
import { useStockStages } from "@/hooks/useStockStages";
import type { StockStage } from "@/lib/stageAnalysis";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  themes: ThemeData[];
  timeframe: string;
}

type RankBy = "perf" | "breadth";
type PickBy = "move" | "rs" | "high";
type StageF = "any" | "s2" | "s1s2" | "not34";
type Format = "comma" | "lines" | "sections";
interface Settings {
  groups: number;          // 0 = all
  perGroup: number;
  rankBy: RankBy;
  pickBy: PickBy;
  stage: StageF;
  upOnly: boolean;         // only stocks up on the timeframe
  nearHigh: number;        // 0 = off; max % below the 52-week high
  minRs: number;           // 0 = off; minimum RS rank 1–99 (52-week Mansfield, ranked across the stage scan)
  minGroupStocks: number;  // groups need at least this many stocks with data
  format: Format;
}
const DEFAULTS: Settings = { groups: 10, perGroup: 3, rankBy: "perf", pickBy: "move", stage: "any", upOnly: false, nearHigh: 0, minRs: 0, minGroupStocks: 1, format: "comma" };
const KEY = "export_top_leaders_v2";

const RANK_LABEL: Record<RankBy, string> = { perf: "Average move", breadth: "Breadth (% of stocks up)" };
const PICK_LABEL: Record<PickBy, string> = { move: "Biggest move", rs: "Highest RS rank", high: "Closest to 52-week high" };
const STAGE_LABEL: Record<StageF, string> = { any: "Any stage", s2: "Stage 2 only", s1s2: "Stage 1 or 2", not34: "Not Stage 3 or 4" };
const FORMAT_LABEL: Record<Format, string> = { comma: "Comma-separated", lines: "One per line", sections: "TradingView sections" };

const fmtPct = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;

export default function ExportTopLeadersDialog({ open, onOpenChange, themes, timeframe }: Props) {
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [s, setS] = useState<Settings>(() => {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return DEFAULTS; }
  });
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }, [s]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));

  // Stage data is only needed for the stage / RS / 52-week-high options.
  const needStages = open && (s.stage !== "any" || s.pickBy !== "move" || s.nearHigh > 0 || s.minRs > 0);
  const { rows: stageRows, bySymbol: stageBy, loading: stagesLoading } = useStockStages(needStages);
  const rsRank = useMemo(() => {
    const vals = stageRows.filter((r) => typeof r.features?.mrs52 === "number").sort((a, b) => (a.features!.mrs52 as number) - (b.features!.mrs52 as number));
    const m = new Map<string, number>();
    vals.forEach((r, i) => m.set(r.symbol.toUpperCase(), Math.max(1, Math.round(((i + 1) / vals.length) * 99))));
    return m;
  }, [stageRows]);

  const { tickers, breakdown, dropped } = useMemo(() => {
    const stageOk = (st: StockStage | undefined) => {
      if (s.stage === "any") return true;
      if (!st) return false;
      if (s.stage === "s2") return st.stage === 2;
      if (s.stage === "s1s2") return st.stage === 1 || st.stage === 2;
      return st.stage !== 3 && st.stage !== 4;
    };
    const groups = themes
      .map((t) => {
        const valid = t.tickers.filter((tk) => !tk.skipped);
        return { t, valid, breadth: valid.length ? valid.filter((x) => x.pct > 0).length / valid.length : 0 };
      })
      .filter((g) => g.valid.length >= Math.max(1, s.minGroupStocks))
      .sort((a, b) => (s.rankBy === "breadth" ? b.breadth - a.breadth || b.t.performance_pct - a.t.performance_pct : b.t.performance_pct - a.t.performance_pct));
    const chosen = s.groups > 0 ? groups.slice(0, s.groups) : groups;

    const seen = new Set<string>();
    const out: string[] = [];
    const breakdown: { theme: string; perf: number; breadth: number; picks: { sym: string; pct: number; note: string | null }[]; short: number }[] = [];
    let dropped = 0;
    for (const g of chosen) {
      const cands = g.valid.filter((tk) => {
        const sym = tk.symbol.toUpperCase(), st = stageBy.get(sym);
        if (s.upOnly && !(tk.pct > 0)) return false;
        if (!stageOk(st)) return false;
        if (s.nearHigh > 0 && !((st?.features?.pctFrom52wHigh ?? -999) >= -s.nearHigh)) return false;
        if (s.minRs > 0 && !((rsRank.get(sym) ?? 0) >= s.minRs)) return false;
        return true;
      });
      dropped += g.valid.length - cands.length;
      const key = (tk: { symbol: string; pct: number }) => {
        const sym = tk.symbol.toUpperCase();
        if (s.pickBy === "rs") return rsRank.get(sym) ?? -1;
        if (s.pickBy === "high") return stageBy.get(sym)?.features?.pctFrom52wHigh ?? -999;
        return tk.pct;
      };
      const picks: { sym: string; pct: number; note: string | null }[] = [];
      for (const tk of [...cands].sort((a, b) => key(b) - key(a))) {
        if (picks.length >= s.perGroup) break;
        const sym = tk.symbol.toUpperCase();
        if (seen.has(sym)) continue; // already listed under a stronger group
        seen.add(sym);
        out.push(sym);
        const st = stageBy.get(sym);
        const note = s.pickBy === "rs" ? (rsRank.has(sym) ? `RS ${rsRank.get(sym)}` : null)
          : s.pickBy === "high" && typeof st?.features?.pctFrom52wHigh === "number" ? `${st.features.pctFrom52wHigh.toFixed(0)}% from high` : null;
        picks.push({ sym, pct: tk.pct, note });
      }
      breakdown.push({ theme: g.t.theme_name, perf: g.t.performance_pct, breadth: g.breadth, picks, short: Math.max(0, s.perGroup - picks.length) });
    }
    return { tickers: out, breakdown, dropped };
  }, [themes, s, stageBy, rsRank]);

  const text = s.format === "comma"
    ? tickers.join(",")
    : s.format === "lines"
      ? tickers.join("\n")
      : breakdown.filter((b) => b.picks.length).map((b) => `###${b.theme.replace(/[,\n]/g, " ")}\n${b.picks.map((p) => p.sym).join("\n")}`).join("\n");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };
  const handleDownload = () => {
    const blob = new Blob([s.format === "comma" ? tickers.join("\n") : text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `top_leaders_${timeframe}_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const summary = `${s.perGroup} stock${s.perGroup === 1 ? "" : "s"} from each of the ${s.groups > 0 ? `top ${s.groups}` : "all"} groups by ${RANK_LABEL[s.rankBy].toLowerCase()}, picked by ${PICK_LABEL[s.pickBy].toLowerCase()}`;
  const activeFilters = [
    s.stage !== "any" && STAGE_LABEL[s.stage],
    s.upOnly && "up only",
    s.nearHigh > 0 && `within ${s.nearHigh}% of high`,
    s.minRs > 0 && `RS ${s.minRs}+`,
    s.minGroupStocks > 1 && `groups with ${s.minGroupStocks}+ stocks`,
  ].filter(Boolean) as string[];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy size={18} className="text-primary" />
            Top leaders — {timeframe}
          </DialogTitle>
          <DialogDescription>
            {summary}. <b className="text-foreground">{tickers.length} unique tickers</b>
            {activeFilters.length ? ` · ${activeFilters.join(" · ")}` : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border">
          <button onClick={() => setShowSettings((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-accent/40">
            <Settings2 size={13} className="text-muted-foreground" /> Settings
            <span className="ml-auto text-[11px] font-normal text-muted-foreground">{showSettings ? "Hide" : "Change"}</span>
          </button>
          {showSettings && (
            <div className="space-y-3 border-t border-border px-3 py-3 text-xs">
              <Row label="Groups" hint="How many of the strongest groups to take stocks from.">
                <Chips value={s.groups} onChange={(v) => set("groups", v)} options={[[5, "5"], [10, "10"], [15, "15"], [20, "20"], [30, "30"], [0, "All"]]} />
              </Row>
              <Row label="Stocks per group" hint="Stocks already listed under a stronger group are skipped.">
                <span className="flex items-center gap-2">
                  <input type="range" min={1} max={10} value={s.perGroup} onChange={(e) => set("perGroup", Number(e.target.value))} className="w-36 accent-[hsl(var(--primary))]" aria-label="Stocks per group" />
                  <span className="w-5 font-mono">{s.perGroup}</span>
                </span>
              </Row>
              <Row label="Rank groups by">
                <Chips value={s.rankBy} onChange={(v) => set("rankBy", v)} options={(Object.keys(RANK_LABEL) as RankBy[]).map((k) => [k, RANK_LABEL[k]])} />
              </Row>
              <Row label="Pick stocks by" hint="RS rank and 52-week high come from the last Stage scan.">
                <Chips value={s.pickBy} onChange={(v) => set("pickBy", v)} options={(Object.keys(PICK_LABEL) as PickBy[]).map((k) => [k, PICK_LABEL[k]])} />
              </Row>
              <div className="border-t border-border/60 pt-3 text-[11px] font-medium text-muted-foreground">Filters</div>
              <Row label="Stage">
                <Chips value={s.stage} onChange={(v) => set("stage", v)} options={(Object.keys(STAGE_LABEL) as StageF[]).map((k) => [k, STAGE_LABEL[k]])} />
              </Row>
              <Row label="Minimum RS rank">
                <Chips value={s.minRs} onChange={(v) => set("minRs", v)} options={[[0, "Off"], [50, "50+"], [70, "70+"], [80, "80+"], [90, "90+"]]} />
              </Row>
              <Row label="Near the 52-week high">
                <Chips value={s.nearHigh} onChange={(v) => set("nearHigh", v)} options={[[0, "Off"], [5, "≤5%"], [15, "≤15%"], [25, "≤25%"]]} />
              </Row>
              <Row label="Only stocks up">
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={s.upOnly} onChange={(e) => set("upOnly", e.target.checked)} /> <span className="text-muted-foreground">on the {timeframe} timeframe</span></label>
              </Row>
              <Row label="Smallest group" hint="Skip groups with fewer stocks — tiny groups swing the most.">
                <Chips value={s.minGroupStocks} onChange={(v) => set("minGroupStocks", v)} options={[[1, "Any"], [3, "3+"], [5, "5+"], [10, "10+"]]} />
              </Row>
              <div className="border-t border-border/60 pt-3" />
              <Row label="Format" hint="TradingView sections put each group under its own heading when imported.">
                <Chips value={s.format} onChange={(v) => set("format", v)} options={(Object.keys(FORMAT_LABEL) as Format[]).map((k) => [k, FORMAT_LABEL[k]])} />
              </Row>
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-muted-foreground">
                  {needStages && stagesLoading ? "Loading stage data…" : dropped ? `${dropped} stocks removed by the filters.` : ""}
                </span>
                <button onClick={() => setS(DEFAULTS)} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"><RotateCcw size={11} /> Reset</button>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            disabled={!tickers.length}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={handleDownload}
            disabled={!tickers.length}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent disabled:opacity-40"
          >
            <Download size={12} />
            Download .txt
          </button>
        </div>

        <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded-md border border-border bg-secondary/30 p-3 font-mono text-xs text-foreground">
          {text || <span className="text-muted-foreground">No tickers match these settings.</span>}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Breakdown</p>
          {breakdown.map((b, i) => (
            <div key={b.theme} className="rounded-md border border-border bg-card/50 p-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">#{i + 1} {b.theme}</span>
                <span className="flex items-center gap-2 font-mono text-xs">
                  <span className="text-muted-foreground">{Math.round(b.breadth * 100)}% up</span>
                  <span className={b.perf >= 0 ? "text-gain-medium" : "text-destructive"}>{fmtPct(b.perf)}</span>
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {b.picks.map((p) => (
                  <span
                    key={p.sym}
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                      p.pct >= 0 ? "border-gain-medium/30 bg-gain-medium/10 text-gain-medium" : "border-destructive/30 bg-destructive/10 text-destructive"
                    }`}
                  >
                    {p.sym} {fmtPct(p.pct)}{p.note ? <span className="text-muted-foreground"> · {p.note}</span> : null}
                  </span>
                ))}
                {!b.picks.length && <span className="text-[11px] text-muted-foreground">No stock passes the filters.</span>}
                {b.picks.length > 0 && b.short > 0 && <span className="text-[11px] text-muted-foreground">only {b.picks.length} passed</span>}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[160px_1fr] sm:items-start">
      <span className="pt-0.5">
        <span className="block text-[11.5px] font-medium">{label}</span>
        {hint && <span className="block text-[10.5px] leading-snug text-muted-foreground">{hint}</span>}
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Chips<T extends string | number>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {options.map(([v, l]) => (
        <button
          key={String(v)}
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${value === v ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
        >
          {l}
        </button>
      ))}
    </span>
  );
}
