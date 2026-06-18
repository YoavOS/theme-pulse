// Economic calendar — high-impact macro events for today (and optionally tomorrow).
// Primary: Forex Factory weekly XML (free, reliable). Fallback: Finnhub / FMP.
// Lightweight; no DB writes. The frontend caches results for 6h.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") || "";
const FMP_KEY = Deno.env.get("FMP_API_KEY") || "";

interface EconEvent {
  date: string;          // ISO datetime
  country: string;
  event: string;
  impact: "High" | "Medium" | "Low" | "None";
  actual: number | string | null;
  estimate: number | string | null;
  previous: number | string | null;
  unit: string | null;
  currency: string | null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().split("T")[0];
}

function normalizeImpact(raw: any): EconEvent["impact"] {
  const s = String(raw || "").toLowerCase();
  if (s.includes("high")) return "High";
  if (s.includes("medium") || s.includes("moderate")) return "Medium";
  if (s.includes("low")) return "Low";
  return "None";
}

// Currency → country code map (Forex Factory uses currency codes)
const CCY_TO_COUNTRY: Record<string, string> = {
  USD: "US", EUR: "EU", GBP: "GB", JPY: "JP", CNY: "CN",
  AUD: "AU", CAD: "CA", NZD: "NZ", CHF: "CH",
};

const HIGH_IMPACT_KEYWORDS = [
  "fomc", "fed ", "federal reserve", "interest rate", "rate decision",
  "powell", "cpi", "ppi", "pce", "non-farm", "nonfarm", "unemployment",
  "jobs report", "payrolls", "gdp", "retail sales", "ism", "pmi",
];

function bumpImpact(ev: EconEvent): EconEvent {
  if (ev.impact === "High") return ev;
  const text = ev.event.toLowerCase();
  if (HIGH_IMPACT_KEYWORDS.some((k) => text.includes(k))) {
    return { ...ev, impact: "High" };
  }
  return ev;
}

// ----------- Forex Factory free XML -----------
function extractCdata(s: string): string {
  const m = s.match(/<!\[CDATA\[(.*?)\]\]>/s);
  return (m ? m[1] : s).trim();
}

function tagValue(block: string, tag: string): string {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  return extractCdata(m[1]).trim();
}

// Parse FF time "8:30am" + date "06-17-2026" → ISO (assumes US Eastern, the FF default)
function parseFFDateTime(dateStr: string, timeStr: string): string | null {
  if (!dateStr) return null;
  const [mm, dd, yyyy] = dateStr.split("-");
  if (!mm || !dd || !yyyy) return null;
  // Default to noon ET if time is "All Day" / missing
  let hh = 12, mi = 0;
  const tm = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (tm) {
    hh = parseInt(tm[1], 10);
    mi = parseInt(tm[2], 10);
    if (/pm/i.test(tm[3]) && hh !== 12) hh += 12;
    if (/am/i.test(tm[3]) && hh === 12) hh = 0;
  }
  // FF times are US Eastern. Approx ET→UTC: ET is UTC-5 (EST) or UTC-4 (EDT).
  // Use a rough offset: between mid-March and early Nov use -4, else -5.
  const month = parseInt(mm, 10);
  const offset = (month >= 3 && month <= 11) ? 4 : 5;
  const utcHour = hh + offset;
  // Build ISO; handle day rollover via Date math
  const base = new Date(Date.UTC(parseInt(yyyy, 10), month - 1, parseInt(dd, 10), utcHour, mi));
  return base.toISOString();
}

async function fromForexFactory(): Promise<EconEvent[]> {
  try {
    const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.xml", {
      headers: { "User-Agent": "Mozilla/5.0 LovableMarketBrief/1.0" },
    });
    if (!res.ok) {
      console.log("ForexFactory XML failed", res.status);
      return [];
    }
    const xml = await res.text();
    const blocks = xml.match(/<event>[\s\S]*?<\/event>/g) || [];
    const out: EconEvent[] = [];
    for (const b of blocks) {
      const title = tagValue(b, "title");
      const ccy = tagValue(b, "country");
      const date = tagValue(b, "date");
      const time = tagValue(b, "time");
      const impact = tagValue(b, "impact");
      const forecast = tagValue(b, "forecast");
      const previous = tagValue(b, "previous");
      const iso = parseFFDateTime(date, time);
      if (!iso || !title) continue;
      out.push({
        date: iso,
        country: CCY_TO_COUNTRY[ccy] || ccy || "",
        event: title,
        impact: normalizeImpact(impact),
        actual: null,
        estimate: forecast || null,
        previous: previous || null,
        unit: null,
        currency: ccy || null,
      });
    }
    return out;
  } catch (e) {
    console.error("ForexFactory parse failed:", e);
    return [];
  }
}

// ----------- Finnhub fallback -----------
async function fromFinnhub(from: string, to: string): Promise<EconEvent[]> {
  if (!FINNHUB_KEY) return [];
  try {
    const res = await fetch(`https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${FINNHUB_KEY}`);
    if (!res.ok) return [];
    const data = await res.json();
    const list: any[] = data?.economicCalendar || [];
    if (!Array.isArray(list)) return [];
    return list.map((e: any): EconEvent => ({
      date: e.time ? new Date(e.time.replace(" ", "T") + "Z").toISOString() : new Date().toISOString(),
      country: String(e.country || "US"),
      event: String(e.event || ""),
      impact: normalizeImpact(e.impact),
      actual: e.actual ?? null,
      estimate: e.estimate ?? null,
      previous: e.prev ?? null,
      unit: e.unit || null,
      currency: null,
    }));
  } catch { return []; }
}

// ----------- FMP fallback -----------
async function fromFMP(from: string, to: string): Promise<EconEvent[]> {
  if (!FMP_KEY) return [];
  const urls = [
    `https://financialmodelingprep.com/stable/economic-calendar?from=${from}&to=${to}&apikey=${FMP_KEY}`,
    `https://financialmodelingprep.com/api/v3/economic_calendar?from=${from}&to=${to}&apikey=${FMP_KEY}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const raw = await res.json();
      if (!Array.isArray(raw) || raw.length === 0) continue;
      return raw.map((e: any): EconEvent => ({
        date: e.date,
        country: String(e.country || ""),
        event: String(e.event || ""),
        impact: normalizeImpact(e.impact),
        actual: e.actual ?? null,
        estimate: e.estimate ?? null,
        previous: e.previous ?? null,
        unit: e.unit || null,
        currency: e.currency || null,
      }));
    } catch {}
  }
  return [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    let body: any = {};
    try { body = await req.json(); } catch {}
    const includeTomorrow = !!body.includeTomorrow;
    const daysAhead = Math.max(0, Math.min(14, Number(body.daysAhead) || 0));
    const usOnly = body.usOnly !== false; // default true

    const from = todayISO(0);
    const spanDays = daysAhead > 0 ? daysAhead : (includeTomorrow ? 1 : 0);
    const to = todayISO(spanDays);

    // Primary: Forex Factory (free, full week of events)
    let events = await fromForexFactory();
    let source = "forexfactory";

    if (events.length === 0) {
      events = await fromFinnhub(from, to);
      source = "finnhub";
    }
    if (events.length === 0) {
      events = await fromFMP(from, to);
      source = "fmp";
    }

    // Filter date range
    const targetDates = new Set<string>();
    for (let i = 0; i <= spanDays; i++) targetDates.add(todayISO(i));

    const impactRank = { High: 0, Medium: 1, Low: 2, None: 3 } as const;

    events = events
      .map(bumpImpact)
      .filter((e) => {
        const dStr = e.date.slice(0, 10);
        if (!targetDates.has(dStr)) return false;
        if (!e.event) return false;
        if (e.impact !== "High" && e.impact !== "Medium") return false;
        if (usOnly) return e.country === "US";
        return true;
      });

    // Dedupe
    const seen = new Set<string>();
    events = events.filter((e) => {
      const k = `${e.country}|${e.event}|${e.date.slice(0, 13)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    events.sort((a, b) => {
      const dc = a.date.localeCompare(b.date);
      if (dc !== 0) return dc;
      return impactRank[a.impact] - impactRank[b.impact];
    });

    return jsonResponse({
      events: events.slice(0, 80),
      fetchedAt: new Date().toISOString(),
      window: { from, to },
      source,
    });
  } catch (e) {
    console.error("economic-calendar error:", e);
    return jsonResponse({ events: [], error: e instanceof Error ? e.message : "unknown" });
  }
});
