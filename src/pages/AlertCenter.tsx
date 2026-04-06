import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Bell, Filter, X, ChevronDown, ExternalLink, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import HelpButton from "@/components/HelpButton";

// ── Types ──

interface AlertRow {
  id: string;
  triggered_at: string;
  date: string;
  theme_name: string;
  alert_type: string;
  severity: string;
  title: string;
  description: string;
  value_before: number | null;
  value_after: number | null;
  threshold: number | null;
  ticker_symbol: string | null;
  metadata: Record<string, unknown> | null;
}

const ALERT_TYPE_OPTIONS = [
  { value: "all", label: "All Types" },
  { value: "breadth_surge", label: "📊 Breadth Surge" },
  { value: "breadth_collapse", label: "📊 Breadth Collapse" },
  { value: "volume_spike", label: "⚡ Volume Spike" },
  { value: "volume_dryup", label: "⚡ Volume Dry-Up" },
  { value: "momentum_breakout", label: "🚀 Momentum Breakout" },
  { value: "momentum_fade", label: "🚀 Momentum Fade" },
  { value: "new_5day_high", label: "📈 New 5-Day High" },
  { value: "new_5day_low", label: "📉 New 5-Day Low" },
  { value: "watchlist_perf", label: "👁 Watchlist Perf" },
  { value: "watchlist_relvol", label: "👁 Watchlist RelVol" },
  { value: "reversal", label: "🔄 Reversal" },
];

const DATE_RANGE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
];

const SEVERITY_OPTIONS = ["all", "high", "medium", "low"] as const;

const PAGE_SIZE = 50;

function getAlertEmoji(type: string): string {
  if (type.startsWith("breadth")) return "📊";
  if (type.startsWith("volume")) return "⚡";
  if (type.startsWith("momentum") || type.startsWith("new_5day")) return "🚀";
  if (type.startsWith("watchlist")) return "👁";
  if (type === "reversal") return "🔄";
  return "🔔";
}

function getAlertCategoryColor(type: string): string {
  if (type.startsWith("breadth")) return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  if (type.startsWith("volume")) return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  if (type.startsWith("momentum") || type.startsWith("new_5day") || type.startsWith("streak")) return "bg-teal-500/20 text-teal-400 border-teal-500/30";
  if (type.startsWith("watchlist")) return "bg-purple-500/20 text-purple-400 border-purple-500/30";
  if (type === "reversal") return "bg-orange-500/20 text-orange-400 border-orange-500/30";
  return "bg-muted text-muted-foreground";
}

function getSeverityDot(severity: string) {
  if (severity === "high") return "bg-red-500";
  if (severity === "medium") return "bg-yellow-500";
  return "bg-green-500";
}

function formatLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function getDateRangeFilter(range: string): string | null {
  const now = new Date();
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const et = new Date(etStr);
  if (range === "today") {
    return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
  }
  if (range === "7d") {
    et.setDate(et.getDate() - 7);
    return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
  }
  if (range === "30d") {
    et.setDate(et.getDate() - 30);
    return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
  }
  return null;
}

export default function AlertCenter() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [typeFilter, setTypeFilter] = useState("all");
  const [themeFilter, setThemeFilter] = useState("all");
  const [dateRange, setDateRange] = useState("all");
  const [severity, setSeverity] = useState<string>("all");

  // Theme list for filter
  const [themeNames, setThemeNames] = useState<string[]>([]);

  // Stats
  const [weekCount, setWeekCount] = useState(0);
  const [todayCount, setTodayCount] = useState(0);
  const [topTheme, setTopTheme] = useState<{ name: string; count: number } | null>(null);
  const [topType, setTopType] = useState<string | null>(null);

  // Mark as read
  useEffect(() => {
    localStorage.setItem("alertsLastRead", new Date().toISOString());
  }, []);

  // Fetch theme names
  useEffect(() => {
    supabase.from("themes").select("name").order("name").then(({ data }) => {
      if (data) setThemeNames(data.map(t => t.name));
    });
  }, []);

  // Fetch stats
  useEffect(() => {
    const now = new Date();
    const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
    const et = new Date(etStr);
    const todayStr = `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
    const weekAgo = new Date(et);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekStr = `${weekAgo.getFullYear()}-${String(weekAgo.getMonth() + 1).padStart(2, "0")}-${String(weekAgo.getDate()).padStart(2, "0")}`;

    // Week count
    supabase.from("alert_history" as any).select("id", { count: "exact", head: true }).gte("date", weekStr).then(({ count }) => {
      setWeekCount(count || 0);
    });

    // Today count
    supabase.from("alert_history" as any).select("id", { count: "exact", head: true }).eq("date", todayStr).then(({ count }) => {
      setTodayCount(count || 0);
    });

    // Top theme this week
    supabase.from("alert_history" as any).select("theme_name").gte("date", weekStr).then(({ data }: any) => {
      if (data && data.length > 0) {
        const counts: Record<string, number> = {};
        for (const r of data) {
          counts[r.theme_name] = (counts[r.theme_name] || 0) + 1;
        }
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        setTopTheme({ name: sorted[0][0], count: sorted[0][1] });
      }
    });

    // Top type this week
    supabase.from("alert_history" as any).select("alert_type").gte("date", weekStr).then(({ data }: any) => {
      if (data && data.length > 0) {
        const counts: Record<string, number> = {};
        for (const r of data) {
          counts[r.alert_type] = (counts[r.alert_type] || 0) + 1;
        }
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        setTopType(sorted[0][0]);
      }
    });
  }, []);

  const buildQuery = useCallback((countOnly = false) => {
    let q = supabase
      .from("alert_history" as any)
      .select(countOnly ? "id" : "id, triggered_at, date, theme_name, alert_type, severity, title, description, value_before, value_after, threshold, ticker_symbol, metadata", countOnly ? { count: "exact", head: true } : undefined);

    if (typeFilter !== "all") q = q.eq("alert_type", typeFilter);
    if (themeFilter !== "all") q = q.eq("theme_name", themeFilter);
    if (severity !== "all") q = q.eq("severity", severity);

    const dateMin = dateRange === "today" ? getDateRangeFilter("today") : getDateRangeFilter(dateRange);
    if (dateRange === "today" && dateMin) {
      q = q.eq("date", dateMin);
    } else if (dateMin) {
      q = q.gte("date", dateMin);
    }

    return q;
  }, [typeFilter, themeFilter, dateRange, severity]);

  // Fetch alerts
  const fetchAlerts = useCallback(async (reset = true) => {
    if (reset) setLoading(true);
    else setLoadingMore(true);

    const offset = reset ? 0 : alerts.length;

    // Count
    const countQ = buildQuery(true);
    const { count } = await countQ;
    setTotalCount(count || 0);

    // Data
    const dataQ = buildQuery()
      .order("triggered_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    const { data } = await dataQ;
    const rows = (data || []) as AlertRow[];

    if (reset) {
      setAlerts(rows);
    } else {
      setAlerts(prev => [...prev, ...rows]);
    }
    setHasMore(rows.length === PAGE_SIZE);
    setLoading(false);
    setLoadingMore(false);
  }, [buildQuery, alerts.length]);

  useEffect(() => {
    fetchAlerts(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, themeFilter, dateRange, severity]);

  const clearFilters = () => {
    setTypeFilter("all");
    setThemeFilter("all");
    setDateRange("all");
    setSeverity("all");
  };

  const hasActiveFilters = typeFilter !== "all" || themeFilter !== "all" || dateRange !== "all" || severity !== "all";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft size={16} />
            </Link>
            <Bell size={20} className="text-primary" />
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              Alert Center
            </h1>
            <span className="text-xs text-muted-foreground">
              {totalCount} total · {weekCount} this week · {todayCount} today
            </span>
          </div>
          <HelpButton />
        </div>
      </header>

      <div className="container py-6 space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-foreground">{weekCount}</div>
              <div className="text-xs text-muted-foreground">Alerts this week</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-foreground">{topTheme?.name || "—"}</div>
              <div className="text-xs text-muted-foreground">
                Most alerted theme {topTheme ? `(${topTheme.count})` : ""}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-foreground">{topType ? formatLabel(topType) : "—"}</div>
              <div className="text-xs text-muted-foreground">Most common type</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-foreground">{todayCount}</div>
              <div className="text-xs text-muted-foreground">Alerts today</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <Filter size={14} className="text-muted-foreground" />

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              {ALERT_TYPE_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={themeFilter} onValueChange={setThemeFilter}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder="Filter by theme" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Themes</SelectItem>
              {themeNames.map(n => (
                <SelectItem key={n} value={n} className="text-xs">{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[150px] h-8 text-xs">
              <SelectValue placeholder="Date range" />
            </SelectTrigger>
            <SelectContent>
              {DATE_RANGE_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center rounded-md border border-border bg-secondary/50">
            {SEVERITY_OPTIONS.map(s => (
              <button
                key={s}
                onClick={() => setSeverity(s)}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  severity === s
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs gap-1">
              <X size={12} /> Clear
            </Button>
          )}
        </div>

        {/* Alert Feed */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border p-4 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Bell size={40} className="mb-4 text-muted-foreground/30" />
              <p className="text-lg font-medium text-foreground">
                {hasActiveFilters
                  ? "No alerts match your filters"
                  : "No alerts yet"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {hasActiveFilters
                  ? "Try adjusting the date range or alert type"
                  : "Alerts will appear here after your first EOD Routine"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {alerts.map(alert => (
              <div
                key={alert.id}
                className="group rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/30"
              >
                <div className="flex items-start gap-3">
                  {/* Severity dot */}
                  <div className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${getSeverityDot(alert.severity)}`} />

                  <div className="flex-1 min-w-0">
                    {/* Title row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm">{getAlertEmoji(alert.alert_type)}</span>
                      <span className="font-semibold text-sm text-foreground">{alert.theme_name}</span>
                      <span className="text-muted-foreground text-sm">—</span>
                      <span className="text-sm text-foreground">{alert.title}</span>
                    </div>

                    {/* Description */}
                    <p className="mt-1 text-xs text-muted-foreground">{alert.description}</p>

                    {/* Meta row */}
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-muted-foreground">{timeAgo(alert.triggered_at)}</span>
                      <span className="text-[10px] text-muted-foreground">·</span>
                      <span className="text-[10px] text-muted-foreground">{alert.date}</span>
                      <Badge className={`text-[10px] px-1.5 py-0 border ${getAlertCategoryColor(alert.alert_type)}`}>
                        {formatLabel(alert.alert_type)}
                      </Badge>
                      {alert.ticker_symbol && (
                        <span className="text-[10px] font-mono text-muted-foreground">{alert.ticker_symbol}</span>
                      )}
                    </div>
                  </div>

                  {/* View Theme link */}
                  <Link
                    to={`/intelligence`}
                    className="hidden group-hover:flex items-center gap-1 shrink-0 text-xs text-primary hover:underline"
                  >
                    View <ExternalLink size={10} />
                  </Link>
                </div>
              </div>
            ))}

            {hasMore && (
              <div className="flex justify-center pt-4">
                <Button
                  variant="outline"
                  onClick={() => fetchAlerts(false)}
                  disabled={loadingMore}
                  className="gap-2"
                >
                  {loadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
