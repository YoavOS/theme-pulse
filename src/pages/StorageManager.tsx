import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase as _supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
  Database, Trash2, AlertTriangle, RefreshCw, Loader2, ArrowLeft, ShieldAlert,
  HardDrive, Activity, TrendingUp, Lightbulb, CheckCircle2, ShieldCheck, Clock, Layers,
} from "lucide-react";

const supabase: any = _supabase;

interface TableStat {
  table_name: string;
  row_count: number;
  size_bytes: number;
  last_updated: string | null;
}

interface TableMeta {
  table: string;
  label: string;
  description: string;
  protected?: boolean;
  rescanRoute?: string;
  trimRpc?: string; // optional dedupe/trim RPC name
}

interface SectionMeta {
  id: string;
  title: string;
  icon: typeof Database;
  route: string;
  tables: TableMeta[];
}

const SECTIONS: SectionMeta[] = [
  {
    id: "rs-alpha",
    title: "RS Alpha",
    icon: TrendingUp,
    route: "/rs-alpha",
    tables: [
      { table: "qualified_rs_universe", label: "Live universe", description: "Active qualified stocks shown on RS Alpha.", protected: true, rescanRoute: "/rs-alpha" },
      { table: "qualified_rs_universe_staging", label: "Staging universe", description: "Temporary buffer used while a universe scan is running." },
      { table: "stock_scan_queue", label: "Scan queue", description: "Per-ticker queue for the universe scan." },
      { table: "rs_scan_progress", label: "Scan progress", description: "Status row for the most recent RS scan.", protected: true },
      { table: "stock_fundamentals", label: "Stock fundamentals", description: "Cached fundamentals per stock — EPS, revenue, ratios.", protected: true, rescanRoute: "/rs-alpha" },
      { table: "fundamentals_scan_queue", label: "Fundamentals queue", description: "Per-ticker queue for the fundamentals re-scan." },
      { table: "fundamentals_scan_progress", label: "Fundamentals progress", description: "Status row for the fundamentals scan.", protected: true },
      { table: "fundamentals_cache", label: "Fundamentals cache", description: "Short-lived cached fundamentals (used by Live Execution too)." },
      { table: "full_update_progress", label: "Full-update progress", description: "Tracks the overall full update routine." },
    ],
  },
  {
    id: "theme-intelligence",
    title: "Theme Intelligence",
    icon: Layers,
    route: "/intelligence",
    tables: [
      { table: "themes", label: "Themes", description: "Theme definitions.", protected: true },
      { table: "theme_tickers", label: "Theme tickers", description: "Symbols mapped to each theme.", protected: true },
      { table: "ticker_performance", label: "Performance snapshot", description: "Latest 1D/1W/1M/3M/YTD per ticker — what the Dashboard scan writes.", rescanRoute: "/" },
      { table: "ticker_volume_cache", label: "Volume cache", description: "Per-ticker volume averages used for Rel Vol / dry-up signals.", rescanRoute: "/intelligence" },
      { table: "yahoo_history_cache", label: "Yahoo history cache", description: "Cached historical OHLC pulled from Yahoo Finance." },
    ],
  },
  {
    id: "live-and-other",
    title: "Live Execution / Market Drivers / Earnings",
    icon: Activity,
    route: "/live",
    tables: [
      { table: "fundamentals_cache", label: "Fundamentals cache (shared)", description: "Same cache shown above — used by Live Execution snapshots." },
    ],
  },
];

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtAgo(ts: string | null): string {
  if (!ts) return "—";
  const ms = Date.now() - new Date(ts).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

type SizeTier = "small" | "medium" | "large";

function sizeTier(rows: number, bytes: number): SizeTier {
  const mb = bytes / 1024 / 1024;
  if (rows >= 5000 || mb >= 50) return "large";
  if (rows >= 200 || mb >= 5) return "medium";
  return "small";
}

const TIER_BADGE: Record<SizeTier, string> = {
  small:  "bg-[hsl(152_60%_45%/0.12)] text-[hsl(152_80%_55%)] border-[hsl(152_60%_45%/0.3)]",
  medium: "bg-[hsl(40_80%_50%/0.12)] text-[hsl(40_90%_60%)] border-[hsl(40_80%_50%/0.3)]",
  large:  "bg-destructive/15 text-destructive border-destructive/30",
};
const TIER_LABEL: Record<SizeTier, string> = { small: "Small", medium: "Medium", large: "Large" };
const TIER_BAR: Record<SizeTier, string> = {
  small: "bg-[hsl(152_80%_55%)]",
  medium: "bg-[hsl(40_90%_60%)]",
  large: "bg-destructive",
};

export default function StorageManager() {
  const { toast } = useToast();
  const [stats, setStats] = useState<Record<string, TableStat>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ table: string; label: string; force: boolean } | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_storage_stats");
      if (error) throw error;
      const map: Record<string, TableStat> = {};
      for (const r of (data || []) as TableStat[]) map[r.table_name] = r;
      setStats(map);
    } catch (e) {
      toast({ title: "Failed to load storage stats", description: String((e as Error).message || e), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const truncate = async (table: string, force: boolean) => {
    setWorking(table);
    try {
      const { data, error } = await supabase.rpc("truncate_storage_table", { p_table: table, p_force: force });
      if (error) throw error;
      toast({ title: `Cleared ${table}`, description: `${data ?? 0} rows removed` });
      await load();
    } catch (e) {
      toast({ title: `Failed to clear ${table}`, description: String((e as Error).message || e), variant: "destructive" });
    } finally {
      setWorking(null);
      setConfirm(null);
    }
  };

  const clearGroup = async (tables: { table: string; force: boolean }[], label: string) => {
    setWorking(label);
    try {
      let total = 0;
      for (const t of tables) {
        const { data, error } = await supabase.rpc("truncate_storage_table", { p_table: t.table, p_force: t.force });
        if (error) throw error;
        total += Number(data ?? 0);
      }
      toast({ title: label, description: `${total} rows removed across ${tables.length} tables` });
      await load();
    } catch (e) {
      toast({ title: `${label} failed`, description: String((e as Error).message || e), variant: "destructive" });
    } finally {
      setWorking(null);
    }
  };

  const { totalBytes, totalRows, top3, health, recommendations } = useMemo(() => {
    const all = Object.values(stats);
    const totalBytes = all.reduce((s, r) => s + (r.size_bytes || 0), 0);
    const totalRows = all.reduce((s, r) => s + (r.row_count || 0), 0);

    // Top 3 biggest consumers (by bytes, fallback to rows)
    const top3 = [...all]
      .sort((a, b) => (b.size_bytes || 0) - (a.size_bytes || 0) || (b.row_count || 0) - (a.row_count || 0))
      .slice(0, 3);

    const totalMb = totalBytes / 1024 / 1024;
    const largeCount = all.filter(r => sizeTier(r.row_count, r.size_bytes) === "large").length;
    let health: { label: "Good" | "Warning" | "Critical"; cls: string; icon: typeof CheckCircle2 };
    if (largeCount >= 3 || totalMb > 500) health = { label: "Critical", cls: "text-destructive", icon: AlertTriangle };
    else if (largeCount >= 1 || totalMb > 100) health = { label: "Warning", cls: "text-[hsl(40_90%_60%)]", icon: AlertTriangle };
    else health = { label: "Good", cls: "text-[hsl(152_80%_55%)]", icon: CheckCircle2 };

    // Smart recommendations
    const recs: { id: string; icon: typeof Trash2; text: string; action?: () => void; freeMb: number }[] = [];
    const yahoo = stats["yahoo_history_cache"];
    if (yahoo && yahoo.size_bytes > 5 * 1024 * 1024) {
      recs.push({
        id: "yahoo",
        icon: Trash2,
        text: `Clear Yahoo cache — would free ~${(yahoo.size_bytes / 1024 / 1024).toFixed(1)} MB`,
        action: () => clearGroup([{ table: "yahoo_history_cache", force: false }], "Clear Yahoo cache"),
        freeMb: yahoo.size_bytes / 1024 / 1024,
      });
    }
    const staging = stats["qualified_rs_universe_staging"];
    if (staging && staging.row_count > 0) {
      recs.push({
        id: "staging",
        icon: Trash2,
        text: `Clear ${staging.row_count.toLocaleString()} stale staging rows — would free ${fmtBytes(staging.size_bytes)}`,
        action: () => clearGroup([{ table: "qualified_rs_universe_staging", force: false }], "Clear staging universe"),
        freeMb: staging.size_bytes / 1024 / 1024,
      });
    }
    const queues = ["stock_scan_queue", "fundamentals_scan_queue"]
      .map(t => stats[t]).filter(r => r && r.row_count > 100);
    if (queues.length > 0) {
      const sumBytes = queues.reduce((s, r) => s + r!.size_bytes, 0);
      recs.push({
        id: "queues",
        icon: Trash2,
        text: `Drain completed scan queues — would free ${fmtBytes(sumBytes)}`,
        action: () => clearGroup(
          queues.map(q => ({ table: q!.table_name, force: false })),
          "Clear scan queues"
        ),
        freeMb: sumBytes / 1024 / 1024,
      });
    }
    const oldYahoo = yahoo?.last_updated ? (Date.now() - new Date(yahoo.last_updated).getTime()) > 7 * 86400_000 : false;
    if (oldYahoo) {
      recs.push({
        id: "stale-yahoo",
        icon: Clock,
        text: "Yahoo cache hasn't been refreshed in over a week — consider clearing it.",
        freeMb: 0,
      });
    }

    return { totalBytes, totalRows, top3, health, recommendations: recs };
  }, [stats]);

  const totalMb = totalBytes / 1024 / 1024;
  const HealthIcon = health.icon;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container py-3 flex items-center gap-3">
          <Link to="/" className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
            <ArrowLeft size={14} />
          </Link>
          <Database size={18} className="text-primary" />
          <h1 className="font-['Syne',sans-serif] text-xl font-bold">Storage Manager</h1>
          <Button size="sm" variant="outline" className="ml-auto" onClick={load} disabled={isLoading}>
            {isLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Refresh
          </Button>
        </div>
      </header>

      <main className="container py-6 space-y-6">
        {/* ===== Summary Dashboard ===== */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Card className="p-4 border-border">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <HardDrive size={12} /> Total Size
            </div>
            <div className="mt-1 text-2xl font-bold font-['DM_Mono',monospace]">{totalMb.toFixed(1)} <span className="text-sm font-normal text-muted-foreground">MB</span></div>
            <div className="text-[11px] text-muted-foreground mt-1">{Object.keys(stats).length} tables tracked</div>
          </Card>
          <Card className="p-4 border-border">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <Database size={12} /> Total Rows
            </div>
            <div className="mt-1 text-2xl font-bold font-['DM_Mono',monospace]">{totalRows.toLocaleString()}</div>
            <div className="text-[11px] text-muted-foreground mt-1">across all tracked tables</div>
          </Card>
          <Card className={`p-4 border-border`}>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <ShieldCheck size={12} /> Health
            </div>
            <div className={`mt-1 flex items-center gap-2 text-2xl font-bold ${health.cls}`}>
              <HealthIcon size={20} />{health.label}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              {health.label === "Good" && "All tables within normal bounds"}
              {health.label === "Warning" && "Some tables are getting large"}
              {health.label === "Critical" && "Several tables need attention"}
            </div>
          </Card>
          <Card className="p-4 border-border">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <TrendingUp size={12} /> Top Consumers
            </div>
            <div className="mt-2 space-y-1">
              {top3.length === 0 && <div className="text-xs text-muted-foreground">—</div>}
              {top3.map(t => {
                const tier = sizeTier(t.row_count, t.size_bytes);
                return (
                  <div key={t.table_name} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate font-mono">{t.table_name}</span>
                    <span className={`shrink-0 font-mono ${tier === "large" ? "text-destructive" : tier === "medium" ? "text-[hsl(40_90%_60%)]" : "text-muted-foreground"}`}>
                      {fmtBytes(t.size_bytes)}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* ===== Free Tier Capacity ===== */}
        {(() => {
          const FREE_LIMIT_MB = 500; // Lovable Cloud / Supabase free tier DB cap
          const usedPct = Math.min(100, (totalMb / FREE_LIMIT_MB) * 100);
          let zone: { label: string; cls: string; bar: string; note: string };
          if (usedPct >= 85) zone = { label: "Danger Zone", cls: "text-destructive border-destructive/40 bg-destructive/5", bar: "bg-destructive", note: "Approaching the 500 MB free-tier cap — clear caches or upgrade soon." };
          else if (usedPct >= 60) zone = { label: "Caution Zone", cls: "text-[hsl(40_90%_60%)] border-[hsl(40_90%_60%)]/30 bg-[hsl(40_90%_60%)]/5", bar: "bg-[hsl(40_90%_60%)]", note: "Headroom is shrinking — consider clearing Yahoo cache and old queues." };
          else zone = { label: "Safe Zone", cls: "text-[hsl(152_80%_55%)] border-[hsl(152_80%_55%)]/30 bg-[hsl(152_80%_55%)]/5", bar: "bg-[hsl(152_80%_55%)]", note: "Well within the 500 MB free-tier database limit." };
          return (
            <Card className={`p-4 border ${zone.cls}`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                  <ShieldCheck size={12} /> Free Tier Capacity
                </div>
                <div className={`text-sm font-bold ${zone.cls.split(" ")[0]}`}>{zone.label}</div>
              </div>
              <div className="mt-2 flex items-baseline gap-2 font-['DM_Mono',monospace]">
                <span className="text-2xl font-bold text-foreground">{totalMb.toFixed(1)} MB</span>
                <span className="text-xs text-muted-foreground">/ {FREE_LIMIT_MB} MB used ({usedPct.toFixed(1)}%)</span>
              </div>
              <div className="mt-2 h-2 w-full rounded-full bg-muted overflow-hidden">
                <div className={`h-full ${zone.bar} transition-all`} style={{ width: `${usedPct}%` }} />
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground">{zone.note}</div>
            </Card>
          );
        })()}

        {/* ===== Smart Recommendations ===== */}
        {recommendations.length > 0 && (
          <Card className="p-4 border-[hsl(152_60%_45%/0.3)] bg-[hsl(152_60%_45%/0.04)]">
            <div className="flex items-center gap-2 mb-2">
              <Lightbulb size={14} className="text-[hsl(152_80%_55%)]" />
              <span className="text-sm font-semibold">Smart recommendations</span>
            </div>
            <div className="space-y-1.5">
              {recommendations.map(r => {
                const Icon = r.icon;
                return (
                  <div key={r.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/40 px-3 py-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Icon size={13} className="text-muted-foreground" />
                      <span>{r.text}</span>
                    </div>
                    {r.action && (
                      <Button size="sm" variant="outline" disabled={!!working} onClick={r.action}>
                        Apply
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* ===== Quick actions ===== */}
        <Card className="p-4 border-border">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium mr-2">Quick actions:</span>
            <Button size="sm" variant="outline" disabled={!!working}
              onClick={() => clearGroup([{ table: "qualified_rs_universe_staging", force: false }], "Clear staging universe")}>
              <Trash2 /> Clear Old Universes
            </Button>
            <Button size="sm" variant="outline" disabled={!!working}
              onClick={() => clearGroup([{ table: "fundamentals_cache", force: false }], "Clear News & Temporary Data")}>
              <Trash2 /> Clear News & Temporary Data
            </Button>
            <Button size="sm" variant="outline" disabled={!!working}
              onClick={() => clearGroup([{ table: "yahoo_history_cache", force: false }], "Clear Yahoo cache")}>
              <Trash2 /> Clear All Yahoo Cache
            </Button>
            <Button size="sm" variant="destructive" disabled={!!working} onClick={() => setResetOpen(true)}>
              <ShieldAlert /> Full Memory Reset
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Full reset wipes every cache and snapshot. Live universe, themes, and stored fundamentals are protected and require typing <span className="font-mono">RESET</span> to confirm.
          </p>
        </Card>

        {/* ===== Per-section / per-table cards ===== */}
        {SECTIONS.map((section) => {
          const SectionIcon = section.icon;
          const sectionRows = section.tables.reduce((s, t) => s + (stats[t.table]?.row_count || 0), 0);
          const sectionBytes = section.tables.reduce((s, t) => s + (stats[t.table]?.size_bytes || 0), 0);
          return (
            <section key={section.id}>
              <div className="mb-3 flex items-baseline justify-between border-b border-border pb-2">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <SectionIcon size={16} className="text-primary" />
                  <Link to={section.route} className="hover:text-primary transition-colors">{section.title}</Link>
                </h2>
                <span className="text-xs text-muted-foreground font-mono">
                  {sectionRows.toLocaleString()} rows · {fmtBytes(sectionBytes)}
                </span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {section.tables.map((t) => {
                  const s = stats[t.table];
                  const rows = s?.row_count ?? 0;
                  const bytes = s?.size_bytes ?? 0;
                  const tier = sizeTier(rows, bytes);
                  const busy = working === t.table;
                  // Fill bar proportional to share of total (capped)
                  const sharePct = totalBytes > 0 ? Math.min(100, (bytes / totalBytes) * 100) : 0;
                  return (
                    <Card key={`${section.id}-${t.table}`} className="p-3 border-border">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-semibold">{t.label}</h3>
                            <code className="text-[10px] text-muted-foreground">{t.table}</code>
                            {t.protected && (
                              <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground flex items-center gap-1">
                                <ShieldCheck size={9} />protected
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
                        </div>
                        <span className={`shrink-0 rounded border px-2 py-0.5 text-[10px] font-medium flex items-center gap-1 ${TIER_BADGE[tier]}`}>
                          {tier === "large" && <AlertTriangle size={10} />}
                          {TIER_LABEL[tier]}
                        </span>
                      </div>

                      {/* Stats row */}
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Rows</div>
                          <div className="font-mono font-semibold">{rows.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Size</div>
                          <div className="font-mono font-semibold">{fmtBytes(bytes)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Updated</div>
                          <div className="font-mono">{fmtAgo(s?.last_updated ?? null)}</div>
                        </div>
                      </div>

                      {/* Size share bar */}
                      <div className="mt-2 h-1 w-full rounded-full bg-muted overflow-hidden">
                        <div className={`h-full ${TIER_BAR[tier]} transition-all`} style={{ width: `${sharePct}%` }} />
                      </div>

                      {/* Actions */}
                      <div className="mt-2 flex items-center justify-end gap-1.5">
                        {t.rescanRoute && (
                          <Button asChild size="sm" variant="ghost">
                            <Link to={t.rescanRoute}><RefreshCw />Re-scan</Link>
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || !!working}
                          onClick={() => setConfirm({ table: t.table, label: t.label, force: !!t.protected })}
                        >
                          {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
                          Clear
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>

      {/* Per-table confirm */}
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear {confirm?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently empties <code className="font-mono">{confirm?.table}</code>.
              {confirm?.force && " This is protected live data — re-scanning will be required to rebuild it."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirm && truncate(confirm.table, confirm.force)}
            >
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Full reset — typed confirmation */}
      <AlertDialog open={resetOpen} onOpenChange={(o) => { if (!o) { setResetOpen(false); setResetText(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Full Memory Reset</AlertDialogTitle>
            <AlertDialogDescription>
              This wipes every cache and snapshot in the app (performance snapshot, volume cache, Yahoo cache, queues, staging universe, fundamentals cache). The live universe, themes, and stored fundamentals are kept.
              <br /><br />
              Type <span className="font-mono font-bold">RESET</span> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={resetText} onChange={(e) => setResetText(e.target.value)} placeholder="Type RESET" autoFocus />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={resetText !== "RESET"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                setResetOpen(false);
                setResetText("");
                await clearGroup([
                  { table: "ticker_performance", force: false },
                  { table: "ticker_volume_cache", force: false },
                  { table: "yahoo_history_cache", force: false },
                  { table: "fundamentals_cache", force: false },
                  { table: "qualified_rs_universe_staging", force: false },
                  { table: "stock_scan_queue", force: false },
                  { table: "fundamentals_scan_queue", force: false },
                  { table: "full_update_progress", force: false },
                ], "Full Memory Reset");
              }}
            >
              Wipe all caches
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
