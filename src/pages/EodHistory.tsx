import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";

// US market holidays (fixed dates + observed rules). Simplified set covering major closures.
function getUSMarketHolidays(year: number): Set<string> {
  const holidays = new Set<string>();
  const fmt = (m: number, d: number) => `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  // New Year's Day
  holidays.add(fmt(1, 1));
  // MLK Day - 3rd Monday of January
  holidays.add(fmt(1, nthWeekday(year, 1, 1, 3)));
  // Presidents' Day - 3rd Monday of February
  holidays.add(fmt(2, nthWeekday(year, 2, 1, 3)));
  // Good Friday - 2 days before Easter
  const easter = getEaster(year);
  const gf = new Date(easter);
  gf.setDate(gf.getDate() - 2);
  holidays.add(gf.toISOString().split("T")[0]);
  // Memorial Day - last Monday of May
  holidays.add(fmt(5, lastWeekday(year, 5, 1)));
  // Juneteenth
  holidays.add(fmt(6, 19));
  // Independence Day
  holidays.add(fmt(7, 4));
  // Labor Day - 1st Monday of September
  holidays.add(fmt(9, nthWeekday(year, 9, 1, 1)));
  // Thanksgiving - 4th Thursday of November
  holidays.add(fmt(11, nthWeekday(year, 11, 4, 4)));
  // Christmas
  holidays.add(fmt(12, 25));

  return holidays;
}

function nthWeekday(year: number, month: number, dow: number, n: number): number {
  // dow: 0=Sun,1=Mon,...  n: 1-based
  const first = new Date(year, month - 1, 1).getDay();
  let day = 1 + ((dow - first + 7) % 7) + (n - 1) * 7;
  return day;
}

function lastWeekday(year: number, month: number, dow: number): number {
  const last = new Date(year, month, 0); // last day of month
  const lastDow = last.getDay();
  let diff = (lastDow - dow + 7) % 7;
  return last.getDate() - diff;
}

function getEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function generateTradingDays(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const start = new Date(startDate + "T12:00:00");
  const end = new Date(endDate + "T12:00:00");

  // Collect holidays for all years in range
  const holidays = new Set<string>();
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
    getUSMarketHolidays(y).forEach((h) => holidays.add(h));
  }

  const current = new Date(start);
  while (current <= end) {
    const dow = current.getDay();
    const dateStr = current.toISOString().split("T")[0];
    if (dow !== 0 && dow !== 6 && !holidays.has(dateStr)) {
      days.push(dateStr);
    }
    current.setDate(current.getDate() + 1);
  }

  return days;
}

interface EodSession {
  date: string;
  completed_at: string | null;
  saved_count: number | null;
  failed_count: number | null;
  total_tickers: number | null;
  status: string | null;
}

interface DateCount {
  date: string;
  count: number;
}

export default function EodHistory() {
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<EodSession[]>([]);
  const [dateCounts, setDateCounts] = useState<DateCount[]>([]);
  const [totalTickers, setTotalTickers] = useState(0);

  useEffect(() => {
    async function load() {
      setLoading(true);

      // Fetch sessions and distinct dates in parallel
      const [sessionsRes, datesRes, tickerCountRes] = await Promise.all([
        supabase.from("eod_save_sessions").select("date, completed_at, saved_count, failed_count, total_tickers, status").order("date", { ascending: false }),
        supabase.from("eod_prices").select("date"),
        supabase.from("theme_tickers").select("id", { count: "exact", head: true }),
      ]);

      // Build date -> count map from eod_prices
      const countMap = new Map<string, number>();
      if (datesRes.data) {
        for (const row of datesRes.data) {
          const d = row.date;
          countMap.set(d, (countMap.get(d) || 0) + 1);
        }
      }

      const counts: DateCount[] = [];
      countMap.forEach((count, date) => counts.push({ date, count }));

      setSessions(sessionsRes.data || []);
      setDateCounts(counts);
      setTotalTickers(tickerCountRes.count || 0);
      setLoading(false);
    }

    load();
  }, []);

  const tableData = useMemo(() => {
    if (dateCounts.length === 0 && sessions.length === 0) return { rows: [], summary: { saved: 0, total: 0, missing: 0 } };

    // Find date range
    const allDates = [...dateCounts.map((d) => d.date), ...sessions.map((s) => s.date)];
    if (allDates.length === 0) return { rows: [], summary: { saved: 0, total: 0, missing: 0 } };

    allDates.sort();
    const earliest = allDates[0];
    const today = new Date().toISOString().split("T")[0];

    const tradingDays = generateTradingDays(earliest, today);

    // Build lookup maps
    const countMap = new Map<string, number>();
    for (const dc of dateCounts) countMap.set(dc.date, dc.count);

    const sessionMap = new Map<string, EodSession>();
    for (const s of sessions) sessionMap.set(s.date, s);

    // Unique ticker count (use max from any date or total_tickers from session)
    const maxTickers = totalTickers || Math.max(...dateCounts.map((d) => d.count), 0);

    const rows = tradingDays
      .sort((a, b) => b.localeCompare(a)) // descending
      .map((date) => {
        const count = countMap.get(date) || 0;
        const session = sessionMap.get(date);
        const hasSaved = count > 0;

        return {
          date,
          hasSaved,
          tickersSaved: count,
          totalTickers: maxTickers,
          savedAt: session?.completed_at || null,
          failedCount: session?.failed_count ?? null,
          sessionStatus: session?.status || null,
        };
      });

    const savedDays = rows.filter((r) => r.hasSaved).length;
    const missingDays = rows.filter((r) => !r.hasSaved).length;

    return {
      rows,
      summary: { saved: savedDays, total: tradingDays.length, missing: missingDays },
    };
  }, [dateCounts, sessions, totalTickers]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Back to Dashboard"
            >
              <ArrowLeft size={16} />
            </Link>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
                EOD History
              </h1>
              <p className="text-xs text-muted-foreground">
                End-of-day price data coverage
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-primary" />
            <span className="ml-3 text-sm text-muted-foreground">Loading EOD history…</span>
          </div>
        ) : tableData.rows.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">No EOD data saved yet. Use the "Save EOD" button on the dashboard after market close.</p>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="mb-4 rounded-lg border border-border bg-card px-4 py-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-primary">{tableData.summary.saved}</span>
                {" of "}
                <span className="font-semibold text-foreground">{tableData.summary.total}</span>
                {" trading days have data"}
                {tableData.summary.missing > 0 && (
                  <>
                    {" · "}
                    <span className="font-semibold text-destructive">{tableData.summary.missing} days missing</span>
                  </>
                )}
              </p>
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/50">
                      <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Date</th>
                      <th className="px-4 py-3 text-center font-semibold text-muted-foreground">Status</th>
                      <th className="px-4 py-3 text-center font-semibold text-muted-foreground">Tickers Saved</th>
                      <th className="px-4 py-3 text-center font-semibold text-muted-foreground">Saved At</th>
                      <th className="px-4 py-3 text-center font-semibold text-muted-foreground">Failures</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.rows.map((row) => (
                      <tr
                        key={row.date}
                        className={`border-b border-border/50 transition-colors ${
                          !row.hasSaved
                            ? "bg-destructive/5"
                            : "hover:bg-secondary/30"
                        }`}
                      >
                        {/* Date */}
                        <td className="px-4 py-2.5 font-mono text-xs text-foreground">
                          {formatDisplayDate(row.date)}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-2.5 text-center">
                          {row.hasSaved ? (
                            <span className="text-primary">✅</span>
                          ) : (
                            <span className="text-muted-foreground">✗</span>
                          )}
                        </td>

                        {/* Tickers Saved */}
                        <td className="px-4 py-2.5 text-center font-mono text-xs">
                          {row.hasSaved ? (
                            <span className={row.tickersSaved >= row.totalTickers ? "text-primary" : "text-foreground"}>
                              {row.tickersSaved} / {row.totalTickers}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">--</span>
                          )}
                        </td>

                        {/* Saved At */}
                        <td className="px-4 py-2.5 text-center text-xs text-muted-foreground">
                          {row.savedAt ? (
                            new Date(row.savedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                          ) : (
                            "--"
                          )}
                        </td>

                        {/* Failures */}
                        <td className="px-4 py-2.5 text-center font-mono text-xs">
                          {row.failedCount === null ? (
                            <span className="text-muted-foreground">--</span>
                          ) : row.failedCount > 0 ? (
                            <span className="font-semibold text-[hsl(var(--loss-mild))]">{row.failedCount}</span>
                          ) : (
                            <span className="text-primary">0</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function formatDisplayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
  return `${dayName} ${m}/${d}/${y}`;
}
