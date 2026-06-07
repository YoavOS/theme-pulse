import { useEffect, useState, useCallback } from "react";
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
} from "lucide-react";

const supabase: any = _supabase;

type SizeBadge = "Small" | "Medium" | "Large";

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
}

interface SectionMeta {
  id: string;
  title: string;
  route: string;
  tables: TableMeta[];
}

const SECTIONS: SectionMeta[] = [
  {
    id: "rs-alpha",
    title: "RS Alpha",
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
    title: "Live Execution / Market Drivers / Morning Brief / Earnings",
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

function sizeBadge(rows: number, bytes: number): { label: SizeBadge; cls: string; warn: boolean } {
  const mb = bytes / 1024 / 1024;
  if (rows >= 5000 || mb >= 50) return { label: "Large", cls: "bg-destructive/15 text-destructive border-destructive/30", warn: true };
  if (rows >= 200 || mb >= 5) return { label: "Medium", cls: "bg-[hsl(40,80%,50%)]/15 text-[hsl(40,90%,60%)] border-[hsl(40,80%,50%)]/30", warn: false };
  return { label: "Small", cls: "bg-muted text-muted-foreground border-border", warn: false };
}

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

  const totalBytes = Object.values(stats).reduce((s, r) => s + (r.size_bytes || 0), 0);
  const totalRows = Object.values(stats).reduce((s, r) => s + (r.row_count || 0), 0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container py-3 flex items-center gap-3">
          <Link to="/" className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
            <ArrowLeft size={14} />
          </Link>
          <Database size={18} className="text-primary" />
          <h1 className="font-['Syne',sans-serif] text-xl font-bold">Storage Manager</h1>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span>{totalRows.toLocaleString()} rows</span>
            <span>·</span>
            <span>{fmtBytes(totalBytes)} total</span>
            <Button size="sm" variant="outline" onClick={load} disabled={isLoading}>
              {isLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-6 space-y-6">
        {/* Global actions */}
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
            Full reset wipes all caches and snapshots. Live universe, themes, and stored fundamentals are protected and require typing <span className="font-mono">RESET</span> to confirm.
          </p>
        </Card>

        {SECTIONS.map((section) => {
          const sectionRows = section.tables.reduce((s, t) => s + (stats[t.table]?.row_count || 0), 0);
          const sectionBytes = section.tables.reduce((s, t) => s + (stats[t.table]?.size_bytes || 0), 0);
          return (
            <section key={section.id}>
              <div className="mb-2 flex items-baseline justify-between border-b border-border pb-1">
                <h2 className="text-lg font-semibold">
                  <Link to={section.route} className="hover:text-primary transition-colors">{section.title}</Link>
                </h2>
                <span className="text-xs text-muted-foreground">
                  {sectionRows.toLocaleString()} rows · {fmtBytes(sectionBytes)}
                </span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {section.tables.map((t) => {
                  const s = stats[t.table];
                  const rows = s?.row_count ?? 0;
                  const bytes = s?.size_bytes ?? 0;
                  const badge = sizeBadge(rows, bytes);
                  const busy = working === t.table;
                  return (
                    <Card key={`${section.id}-${t.table}`} className="p-3 border-border">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-semibold">{t.label}</h3>
                            <code className="text-[10px] text-muted-foreground">{t.table}</code>
                            {t.protected && (
                              <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">protected</span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
                        </div>
                        <span className={`shrink-0 rounded border px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}>
                          {badge.warn && <AlertTriangle size={10} className="inline mr-1" />}
                          {badge.label}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <div className="flex gap-3 font-mono">
                          <span>{rows.toLocaleString()} rows</span>
                          <span className="text-muted-foreground">{fmtBytes(bytes)}</span>
                          <span className="text-muted-foreground">{fmtAgo(s?.last_updated ?? null)}</span>
                        </div>
                        <div className="flex gap-1.5">
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
