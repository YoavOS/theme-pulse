import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useThemeNews, type NewsArticle } from "@/hooks/useThemeNews";
import { useIndexBreadth } from "@/components/dashboard/IndexBreadthStrip";

/**
 * Data behind the dashboard Brief panel (formerly the Morning Brief page):
 * US economic events, today's earnings, the AI news digest, today's index
 * breadth, and the cached AI brief. Every loader is cached in localStorage so
 * opening/closing the panel never refetches.
 */

export interface EconEvent {
  date: string;
  country: string;
  event: string;
  impact: "High" | "Medium" | "Low" | "None";
  actual: number | string | null;
  estimate: number | string | null;
  previous: number | string | null;
  unit: string | null;
  currency: string | null;
}
export interface DigestBullet { text: string; impact: "Bullish" | "Bearish" | "Neutral" }
export interface DigestGroup { theme: string; impact: "High" | "Medium" | "Low"; bullets: DigestBullet[] }
export interface EarningsRow {
  symbol: string;
  company: string | null;
  marketCap: number | null;
  reportTime: "BMO" | "AMC" | "DMH" | null;
  gapPct: number | null;
}
export interface ExplainResult { what: string; expected: string; impact_level: "High" | "Medium" | "Low"; impact_text: string; generatedAt: string }
export type ExplainTarget = { kind: "event" | "news"; title: string; payload: Record<string, unknown> };

const EVENTS_KEY = "brief_events_v3";
const UPCOMING_KEY = "morning_brief_events_upcoming_v1";
const DIGEST_KEY = "morning_brief_digest_v1";
const EARNINGS_KEY = "brief_earnings_v1";
const AI_KEY = "brief_ai_v3";
const EXPLAIN_KEY = "morning_brief_explain_v1";

const HOUR = 3_600_000;

function read<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
}
function write(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
}
const age = (iso: string | null | undefined) => (iso ? Date.now() - new Date(iso).getTime() : Infinity);

/** "YYYY-MM-DD" for the current New York trading day. */
export function etDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

/** Where the US session is right now, in plain words. */
export function sessionState(now = new Date()): { label: string; tone: "open" | "pre" | "after" | "closed" } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  const weekday = !["Sat", "Sun"].includes(get("weekday"));
  const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
  if (!weekday) return { label: "Market closed", tone: "closed" };
  if (mins >= 570 && mins < 960) return { label: `Market open · ${fmt(mins - 570)}`, tone: "open" };
  if (mins >= 240 && mins < 570) return { label: `Pre-market · opens in ${fmt(570 - mins)}`, tone: "pre" };
  if (mins >= 960 && mins < 1200) return { label: "After hours", tone: "after" };
  return { label: "Market closed", tone: "closed" };
}

/** Re-render every `ms` (for countdowns). */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

export function useBriefData(enabled: boolean) {
  const [events, setEvents] = useState<EconEvent[]>(() => {
    const c = read<{ day: string; at: string; events: EconEvent[] }>(EVENTS_KEY);
    return c && c.day === etDay() ? c.events : [];
  });
  const [eventsLoading, setEventsLoading] = useState(false);
  const [upcoming, setUpcoming] = useState<EconEvent[]>(() => {
    const c = read<{ fetchedAt: string; events: EconEvent[] }>(UPCOMING_KEY);
    return c && age(c.fetchedAt) < 12 * HOUR ? c.events : [];
  });
  const [upcomingLoading, setUpcomingLoading] = useState(false);
  const [digest, setDigest] = useState<DigestGroup[]>(() => {
    const c = read<{ fetchedAt: string; groups: DigestGroup[] }>(DIGEST_KEY);
    return c && age(c.fetchedAt) < 2 * HOUR ? c.groups : [];
  });
  const [digestAt, setDigestAt] = useState<string | null>(() => read<{ fetchedAt: string }>(DIGEST_KEY)?.fetchedAt ?? null);
  const [digestLoading, setDigestLoading] = useState(false);
  const [earnings, setEarnings] = useState<EarningsRow[]>(() => {
    const c = read<{ day: string; at: string; rows: EarningsRow[] }>(EARNINGS_KEY);
    return c && c.day === etDay() ? c.rows : [];
  });
  const [earningsLoading, setEarningsLoading] = useState(false);

  const { marketNews, fetchMarketNews } = useThemeNews();
  const breadth = useIndexBreadth(enabled ? "today" : undefined);

  const loadEvents = useCallback(async (force = false) => {
    const c = read<{ day: string; at: string }>(EVENTS_KEY);
    // Today's events: refresh every 30 min so actual prints show up.
    if (!force && c && c.day === etDay() && age(c.at) < 0.5 * HOUR) return;
    setEventsLoading(true);
    try {
      const { data } = await supabase.functions.invoke("economic-calendar", { body: { includeTomorrow: false, usOnly: true } });
      const list: EconEvent[] = data?.events || [];
      setEvents(list);
      write(EVENTS_KEY, { day: etDay(), at: new Date().toISOString(), events: list });
    } catch (e) { console.warn("events failed", e); } finally { setEventsLoading(false); }
  }, []);

  const loadUpcoming = useCallback(async (force = false) => {
    const c = read<{ fetchedAt: string }>(UPCOMING_KEY);
    if (!force && c && age(c.fetchedAt) < 12 * HOUR) return;
    setUpcomingLoading(true);
    try {
      const { data } = await supabase.functions.invoke("economic-calendar", { body: { daysAhead: 7, usOnly: true } });
      const list: EconEvent[] = data?.events || [];
      const fetchedAt = data?.fetchedAt || new Date().toISOString();
      setUpcoming(list);
      write(UPCOMING_KEY, { events: list, fetchedAt });
    } catch (e) { console.warn("upcoming events failed", e); } finally { setUpcomingLoading(false); }
  }, []);

  const loadDigest = useCallback(async (articles: NewsArticle[] | null | undefined, force = false) => {
    const c = read<{ fetchedAt: string }>(DIGEST_KEY);
    if (!force && c && age(c.fetchedAt) < 2 * HOUR) return;
    if (!articles || articles.length === 0) return;
    setDigestLoading(true);
    try {
      const { data } = await supabase.functions.invoke("news-digest", { body: { articles } });
      const groups: DigestGroup[] = data?.groups || [];
      const fetchedAt = data?.generatedAt || new Date().toISOString();
      setDigest(groups); setDigestAt(fetchedAt);
      write(DIGEST_KEY, { groups, fetchedAt });
    } catch (e) { console.warn("digest failed", e); } finally { setDigestLoading(false); }
  }, []);

  const loadEarnings = useCallback(async (force = false) => {
    const c = read<{ day: string; at: string }>(EARNINGS_KEY);
    if (!force && c && c.day === etDay() && age(c.at) < HOUR) return;
    setEarningsLoading(true);
    try {
      const { data } = await supabase.functions.invoke("earnings-calendar", { body: { date: etDay() } });
      const rows: EarningsRow[] = (Array.isArray(data?.rows) ? data.rows : []).map((r: EarningsRow) => ({
        symbol: r.symbol, company: r.company ?? null, marketCap: r.marketCap ?? null, reportTime: r.reportTime ?? null, gapPct: r.gapPct ?? null,
      }));
      setEarnings(rows);
      write(EARNINGS_KEY, { day: etDay(), at: new Date().toISOString(), rows });
    } catch (e) { console.warn("earnings failed", e); } finally { setEarningsLoading(false); }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void loadEvents(false);
    void loadEarnings(false);
    fetchMarketNews();
  }, [enabled, loadEvents, loadEarnings, fetchMarketNews]);

  useEffect(() => {
    if (enabled && marketNews && marketNews.length > 0) void loadDigest(marketNews, false);
  }, [enabled, marketNews, loadDigest]);

  const refreshAll = useCallback(() => {
    void loadEvents(true);
    void loadEarnings(true);
    void breadth.refresh();
    fetchMarketNews();
    if (marketNews && marketNews.length) void loadDigest(marketNews, true);
  }, [loadEvents, loadEarnings, breadth, fetchMarketNews, marketNews, loadDigest]);

  return {
    events, eventsLoading, upcoming, upcomingLoading, loadUpcoming,
    digest, digestAt, digestLoading, marketNews,
    earnings, earningsLoading,
    spy: breadth.spy, qqq: breadth.qqq, breadthLoading: breadth.loading,
    refreshAll,
  };
}
export type BriefData = ReturnType<typeof useBriefData>;

/** The AI brief: written on demand, kept for the trading day. */
export function useAiBrief() {
  const [state, setState] = useState<{ brief: string | null; at: string | null }>(() => {
    const c = read<{ day: string; brief: string; at: string }>(AI_KEY);
    return c && c.day === etDay() ? { brief: c.brief, at: c.at } : { brief: null, at: null };
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (payload: Record<string, unknown>) => {
    setLoading(true); setError(null);
    try {
      const { data, error: err } = await supabase.functions.invoke("morning-brief", { body: payload });
      if (err || !data?.brief) throw new Error(err?.message || data?.error || "No brief returned");
      const at = data.generatedAt || new Date().toISOString();
      setState({ brief: data.brief, at });
      write(AI_KEY, { day: etDay(), brief: data.brief, at });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to write the brief");
    } finally { setLoading(false); }
  }, []);

  return { ...state, loading, error, generate };
}

function hashKey(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return `k${Math.abs(h)}`;
}

/** "Explain this event / headline" — cached answers. */
export function useExplain() {
  const [target, setTarget] = useState<ExplainTarget | null>(null);
  const [result, setResult] = useState<ExplainResult | null>(null);
  const [loading, setLoading] = useState(false);

  const open = useCallback(async (t: ExplainTarget) => {
    setTarget(t); setResult(null);
    const key = hashKey(t.kind + "|" + t.title);
    const cache = read<Record<string, ExplainResult>>(EXPLAIN_KEY) ?? {};
    if (cache[key]) { setResult(cache[key]); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("explain-item", { body: { kind: t.kind, payload: t.payload } });
      if (error) throw error;
      const r: ExplainResult = {
        what: data?.what || "", expected: data?.expected || "",
        impact_level: data?.impact_level || "Medium", impact_text: data?.impact_text || "",
        generatedAt: data?.generatedAt || new Date().toISOString(),
      };
      setResult(r);
      cache[key] = r;
      const entries = Object.entries(cache).sort((a, b) => b[1].generatedAt.localeCompare(a[1].generatedAt)).slice(0, 200);
      write(EXPLAIN_KEY, Object.fromEntries(entries));
    } catch (e) {
      console.error("explain failed", e);
      setTarget(null);
    } finally { setLoading(false); }
  }, []);

  return { target, result, loading, open, close: () => setTarget(null) };
}
