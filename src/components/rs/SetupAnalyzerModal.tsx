import { useMemo, useState, useCallback, useRef } from "react";
import { Target, Loader2, Copy, X, Sparkles, TrendingUp, Newspaper, Calendar, Award, Upload, FileText, Download } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RsStock } from "@/hooks/useRsAlpha";
import { useCuratedThemes } from "@/hooks/useCuratedThemes";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  universe: RsStock[];
}

interface CatalystRow {
  symbol: string;
  newsCount7d: number;
  upgradeSignal: number;
  earningsInDays: number | null;
  sentiment: number | null;
  topHeadline: string | null;
}

interface ScoredRow {
  symbol: string;
  stock: RsStock | null;
  themeName: string | null;
  themeScore: number;        // 0-100
  rsScore: number;           // 0-100
  rsNhScore: number;         // 0-100
  catalystScore: number;     // 0-100
  composite: number;         // 0-100
  catalyst: CatalystRow | null;
  rsNhDaysAgo: number | null;
  rsNhWindow: "20D" | "6M" | null;
}

const WEIGHTS = { theme: 0.30, rs: 0.35, rsnh: 0.15, catalyst: 0.20 };

function parseTickers(raw: string): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of raw.split(/[\s,;|]+/)) {
    let t = tok.trim().toUpperCase();
    const colon = t.indexOf(":");
    if (colon >= 0) t = t.slice(colon + 1);
    t = t.replace(/[^A-Z0-9.\-]/g, "");
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function clamp(n: number, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, n)); }

function percentileRank(value: number | null, sortedDesc: number[]): number {
  if (value === null || !Number.isFinite(value) || sortedDesc.length === 0) return 50;
  // Higher value = higher percentile (100 = best)
  let countBelow = 0;
  for (const v of sortedDesc) if (v < value) countBelow++;
  return clamp((countBelow / sortedDesc.length) * 100);
}

function tierBadge(score: number): { label: string; color: string } {
  if (score >= 75) return { label: "A", color: "bg-[hsl(140,70%,45%)] text-white" };
  if (score >= 55) return { label: "B", color: "bg-[hsl(45,90%,55%)] text-black" };
  return { label: "C", color: "bg-muted text-muted-foreground" };
}

function scoreColor(score: number): string {
  if (score >= 75) return "text-[hsl(140,70%,60%)]";
  if (score >= 55) return "text-[hsl(45,90%,60%)]";
  if (score >= 35) return "text-foreground";
  return "text-muted-foreground";
}

function MiniBar({ value, label }: { value: number; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary/80"
              style={{ width: `${clamp(value)}%` }}
            />
          </div>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{Math.round(value)}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">{label}: {Math.round(value)} / 100</TooltipContent>
    </Tooltip>
  );
}

export default function SetupAnalyzerModal({ open, onOpenChange, universe }: Props) {
  const { themes } = useCuratedThemes();
  const [raw, setRaw] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ScoredRow[] | null>(null);
  const [unqualified, setUnqualified] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [lastFileName, setLastFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ingestFile = useCallback(async (file: File) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("File too large (max 5MB)."); return; }
    try {
      const text = await file.text();
      const parsed = parseTickers(text);
      if (parsed.length === 0) { toast.error("No tickers found in file."); return; }
      setRaw(parsed.join(", "));
      setLastFileName(file.name);
      toast.success(`Loaded ${parsed.length} tickers`, { description: file.name });
    } catch (e) {
      toast.error("Could not read file.", { description: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void ingestFile(f);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void ingestFile(f);
  };

  const universeMap = useMemo(() => {
    const m = new Map<string, RsStock>();
    for (const s of universe) m.set(s.symbol.toUpperCase(), s);
    return m;
  }, [universe]);

  // Theme strength map: for each theme, average rs_overall + 1W return of its qualified members.
  // Higher = stronger theme. Score 0-100 via rank across all themes.
  const themeStrengthMap = useMemo(() => {
    const themeRaw = new Map<string, { name: string; sumRs: number; sumR1w: number; n: number }>();
    for (const t of themes) {
      let sumRs = 0, sumR1w = 0, n = 0;
      for (const sym of t.symbols) {
        const s = universeMap.get(sym);
        if (!s) continue;
        if (s.rsOverall !== null) { sumRs += s.rsOverall; n++; }
        if (s.return1w !== null) { sumR1w += s.return1w; }
      }
      if (n > 0) themeRaw.set(t.id, { name: t.name, sumRs, sumR1w, n });
    }
    // Build composite "theme strength" = avg RS + 1W return weight
    const composite = new Map<string, { name: string; raw: number }>();
    for (const [id, v] of themeRaw) {
      const avgRs = v.sumRs / v.n;
      const avgR1w = v.sumR1w / v.n;
      // RS contributes 70%, 1W return 30% (scaled)
      const raw = avgRs * 0.7 + avgR1w * 3.0;
      composite.set(id, { name: v.name, raw });
    }
    // Convert raw → 0-100 percentile
    const vals = Array.from(composite.values()).map((x) => x.raw).sort((a, b) => a - b);
    const scored = new Map<string, { name: string; score: number }>();
    for (const [id, v] of composite) {
      const idx = vals.findIndex((x) => x >= v.raw);
      const pct = clamp((idx / Math.max(1, vals.length - 1)) * 100);
      scored.set(id, { name: v.name, score: pct });
    }
    return scored;
  }, [themes, universeMap]);

  // For each symbol → strongest theme it belongs to
  const tickerToTopTheme = useMemo(() => {
    const m = new Map<string, { name: string; score: number }>();
    for (const t of themes) {
      const ts = themeStrengthMap.get(t.id);
      if (!ts) continue;
      for (const sym of t.symbols) {
        const prev = m.get(sym);
        if (!prev || ts.score > prev.score) m.set(sym, ts);
      }
    }
    return m;
  }, [themes, themeStrengthMap]);

  const rsOverallSorted = useMemo(
    () => universe.map((s) => s.rsOverall).filter((x): x is number => x !== null).sort((a, b) => a - b),
    [universe],
  );

  const handleAnalyze = useCallback(async () => {
    const tickers = parseTickers(raw);
    if (tickers.length === 0) { toast.error("Paste at least one ticker."); return; }
    if (tickers.length > 100) { toast.error("Max 100 tickers per run."); return; }

    setRunning(true);
    setResults(null);

    const matched: string[] = [];
    const missing: string[] = [];
    for (const t of tickers) {
      if (universeMap.has(t)) matched.push(t);
      else missing.push(t);
    }
    setUnqualified(missing);

    // Fetch catalysts in one batched edge call
    let catalystMap = new Map<string, CatalystRow>();
    try {
      const { data, error } = await supabase.functions.invoke("analyze-setup-catalysts", {
        body: { symbols: tickers },
      });
      if (error) throw new Error(error.message);
      const rows = (data as { rows?: CatalystRow[] })?.rows ?? [];
      for (const r of rows) catalystMap.set(r.symbol.toUpperCase(), r);
    } catch (e) {
      toast.error("Catalyst fetch failed — continuing without it.", {
        description: e instanceof Error ? e.message : String(e),
      });
    }

    // Score each ticker
    const scored: ScoredRow[] = tickers.map((sym) => {
      const stock = universeMap.get(sym) ?? null;

      // Theme score
      const theme = tickerToTopTheme.get(sym) ?? null;
      const themeScore = theme?.score ?? 30; // unmapped → mild penalty

      // RS score: percentile of rs_overall + bonus for positive 1W RS momentum
      let rsScore = 50;
      if (stock) {
        const pct = percentileRank(stock.rsOverall, rsOverallSorted);
        let bonus = 0;
        if (stock.rs1w !== null) {
          if (stock.rs1w > 3) bonus = 10;
          else if (stock.rs1w > 0) bonus = 5;
          else if (stock.rs1w < -3) bonus = -10;
        }
        rsScore = clamp(pct + bonus);
      } else {
        rsScore = 0;
      }

      // RS NH score
      let rsNhScore = 0;
      let rsNhDaysAgo: number | null = null;
      let rsNhWindow: "20D" | "6M" | null = null;
      if (stock) {
        if (stock.rsNh20d) {
          rsNhWindow = "20D";
          rsNhDaysAgo = stock.rsNh20dDaysAgo;
          // Fresh (today/yesterday) = 100, decays
          const d = rsNhDaysAgo ?? 0;
          rsNhScore = clamp(100 - d * 12);
        } else if (stock.rsNh6m) {
          rsNhWindow = "6M";
          rsNhDaysAgo = stock.rsNh6mDaysAgo;
          const d = rsNhDaysAgo ?? 0;
          rsNhScore = clamp(70 - d * 6);
        }
      }

      // Catalyst score
      const cat = catalystMap.get(sym) ?? null;
      let catalystScore = 40; // neutral default
      if (cat) {
        let s = 40;
        if (cat.sentiment !== null) s = cat.sentiment;
        else if (cat.newsCount7d > 0) s = 50 + Math.min(15, cat.newsCount7d * 2);
        s += cat.upgradeSignal * 15;
        if (cat.earningsInDays !== null && cat.earningsInDays <= 14) s += 8;
        catalystScore = clamp(s);
      }

      const composite =
        themeScore * WEIGHTS.theme +
        rsScore * WEIGHTS.rs +
        rsNhScore * WEIGHTS.rsnh +
        catalystScore * WEIGHTS.catalyst;

      return {
        symbol: sym,
        stock,
        themeName: theme?.name ?? null,
        themeScore,
        rsScore,
        rsNhScore,
        catalystScore,
        composite,
        catalyst: cat,
        rsNhDaysAgo,
        rsNhWindow,
      };
    });

    scored.sort((a, b) => b.composite - a.composite);
    setResults(scored);
    setRunning(false);
  }, [raw, universeMap, tickerToTopTheme, rsOverallSorted]);

  const handleCopy = () => {
    if (!results) return;
    const text = results.map((r) => r.symbol).join(",");
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${results.length} symbols copied (ranked).`),
      () => toast.error("Copy failed"),
    );
  };

  const handleDownload = (format: "txt" | "csv") => {
    if (!results) return;
    let body: string;
    let filename: string;
    let mime: string;
    if (format === "txt") {
      body = results.map((r) => r.symbol).join("\n") + "\n";
      filename = `Setup_Ranked_${results.length}.txt`;
      mime = "text/plain;charset=utf-8";
    } else {
      const headers = ["Rank", "Symbol", "Tier", "Composite", "Theme", "ThemeScore", "RsScore", "RsNhScore", "RsNhWindow", "RsNhDaysAgo", "CatalystScore", "NewsCount7d", "EarningsInDays", "UpgradeSignal", "Sentiment", "TopHeadline"];
      const tierOf = (s: number) => (s >= 75 ? "A" : s >= 55 ? "B" : "C");
      const esc = (v: unknown) => {
        const s = v === null || v === undefined ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const rows = results.map((r, i) => [
        i + 1, r.symbol, tierOf(r.composite), r.composite.toFixed(2),
        r.themeName ?? "", r.themeScore.toFixed(1), r.rsScore.toFixed(1),
        r.rsNhScore.toFixed(1), r.rsNhWindow ?? "", r.rsNhDaysAgo ?? "",
        r.catalystScore.toFixed(1), r.catalyst?.newsCount7d ?? "",
        r.catalyst?.earningsInDays ?? "", r.catalyst?.upgradeSignal?.toFixed(2) ?? "",
        r.catalyst?.sentiment ?? "", r.catalyst?.topHeadline ?? "",
      ].map(esc).join(","));
      body = [headers.join(","), ...rows].join("\n") + "\n";
      filename = `Setup_Ranked_${results.length}.csv`;
      mime = "text/csv;charset=utf-8";
    }
    const blob = new Blob([body], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${filename}`);
  };

  const handleReset = () => { setResults(null); setUnqualified([]); };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) handleReset(); }}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target size={18} className="text-[hsl(280,80%,75%)]" /> Setup Strength Analyzer
          </DialogTitle>
          <DialogDescription>
            Paste a list of tickers you have setups on. Ranked top-down by composite setup strength:
            theme (30%) · stock RS (35%) · RS new high before price (15%) · catalysts (20%).
            On-demand, nothing is stored.
          </DialogDescription>
        </DialogHeader>

        <TooltipProvider delayDuration={200}>
        {!results ? (
          <div className="space-y-3">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2 text-xs transition-colors ${
                dragOver ? "border-[hsl(280,70%,60%)] bg-[hsl(280,70%,60%)]/10" : "border-border bg-muted/20"
              }`}
            >
              <div className="flex items-center gap-2 text-muted-foreground">
                <Upload size={14} />
                {lastFileName ? (
                  <span className="flex items-center gap-1"><FileText size={12} /> {lastFileName}</span>
                ) : (
                  <span>Drop a .txt / .csv file here, or</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.csv,text/plain,text/csv"
                  className="hidden"
                  onChange={handleFileInput}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-muted"
                >
                  Choose file
                </button>
                {(raw || lastFileName) && (
                  <button
                    type="button"
                    onClick={() => { setRaw(""); setLastFileName(null); }}
                    className="rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-muted"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            <Textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="Paste tickers — comma, space, or newline separated. Exchange prefixes (NYSE:, NASDAQ:) are stripped. Max 100."
              className="min-h-[180px] font-mono text-sm"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{parseTickers(raw).length} unique tickers detected</span>
              <button
                onClick={handleAnalyze}
                disabled={running || parseTickers(raw).length === 0}
                className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(280,70%,60%)]/60 bg-[hsl(280,70%,60%)]/20 px-4 py-2 text-sm font-semibold text-[hsl(280,80%,80%)] transition-colors hover:bg-[hsl(280,70%,60%)]/30 disabled:opacity-50"
              >
                {running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {running ? "Analyzing…" : "Rank My Setups"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                Ranked <span className="font-semibold text-foreground">{results.length}</span> setups · sorted strongest first
                {unqualified.length > 0 && <span className="ml-2 text-amber-400">· {unqualified.length} not in qualified universe</span>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted"
                >
                  <Copy size={12} /> Copy ranked list
                </button>
                <button
                  onClick={handleReset}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted"
                >
                  <X size={12} /> New list
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">Ticker</th>
                    <th className="px-3 py-2 text-left">Tier</th>
                    <th className="px-3 py-2 text-right">Score</th>
                    <th className="px-3 py-2 text-left">Top Theme</th>
                    <th className="px-3 py-2 text-left">Theme</th>
                    <th className="px-3 py-2 text-left">Stock RS</th>
                    <th className="px-3 py-2 text-left">RS NH</th>
                    <th className="px-3 py-2 text-left">Catalyst</th>
                    <th className="px-3 py-2 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => {
                    const tier = tierBadge(r.composite);
                    const inUniverse = r.stock !== null;
                    return (
                      <tr key={r.symbol} className="border-b border-border/40 hover:bg-muted/20">
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2 font-mono font-semibold">{r.symbol}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${tier.color}`}>
                            {tier.label}
                          </span>
                        </td>
                        <td className={`px-3 py-2 text-right font-mono font-bold tabular-nums ${scoreColor(r.composite)}`}>
                          {r.composite.toFixed(1)}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {r.themeName ? (
                            <span className="text-foreground">{r.themeName}</span>
                          ) : (
                            <span className="text-muted-foreground italic">unmapped</span>
                          )}
                        </td>
                        <td className="px-3 py-2"><MiniBar value={r.themeScore} label="Theme strength" /></td>
                        <td className="px-3 py-2"><MiniBar value={r.rsScore} label="Stock RS" /></td>
                        <td className="px-3 py-2">
                          {r.rsNhWindow ? (
                            <div className="flex items-center gap-1.5">
                              <span className="rounded bg-[hsl(140,70%,45%)]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[hsl(140,70%,60%)]">
                                {r.rsNhWindow} +{r.rsNhDaysAgo}d
                              </span>
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <MiniBar value={r.catalystScore} label="Catalyst" />
                            {r.catalyst?.earningsInDays !== null && r.catalyst?.earningsInDays !== undefined && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[10px] font-semibold text-amber-400">
                                    <Calendar size={10} className="inline" /> {r.catalyst.earningsInDays}d
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>Next earnings in {r.catalyst.earningsInDays} day(s)</TooltipContent>
                              </Tooltip>
                            )}
                            {r.catalyst && r.catalyst.upgradeSignal > 0.2 && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Award size={12} className="text-[hsl(140,70%,60%)]" />
                                </TooltipTrigger>
                                <TooltipContent>Net analyst upgrades vs prior month</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-[11px] text-muted-foreground">
                          {!inUniverse && <span className="text-amber-400">Not in qualified universe · </span>}
                          {r.catalyst?.topHeadline ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="line-clamp-1 max-w-[260px] cursor-help">
                                  <Newspaper size={10} className="mr-1 inline" />{r.catalyst.topHeadline}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-[400px]">{r.catalyst.topHeadline}</TooltipContent>
                            </Tooltip>
                          ) : (
                            r.catalyst?.newsCount7d ? `${r.catalyst.newsCount7d} headlines / 7d` : "no recent news"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {unqualified.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                <div className="mb-1 font-semibold text-amber-400">
                  {unqualified.length} ticker{unqualified.length === 1 ? "" : "s"} not in qualified universe (still ranked using catalysts only):
                </div>
                <div className="font-mono text-muted-foreground">{unqualified.join(", ")}</div>
              </div>
            )}

            <div className="rounded-md border border-border bg-card/50 p-3 text-[11px] text-muted-foreground">
              <div className="mb-1 flex items-center gap-1 font-semibold text-foreground">
                <TrendingUp size={12} /> Scoring weights
              </div>
              Composite = Theme Strength (30%) + Stock RS (35%) + RS New High Before Price (15%) + Catalysts (20%).
              All sub-scores are 0-100. Tier A ≥ 75, B ≥ 55, C below.
            </div>
          </div>
        )}
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}
