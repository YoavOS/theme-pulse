// Economic calendar — high-impact macro events for today (and optionally tomorrow).
// Primary: Finnhub /calendar/economic (US events). Fallback: FMP economic_calendar.
// Lightweight; no DB writes. The frontend caches results for 6h.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") || "";
const FMP_KEY = Deno.env.get("FMP_API_KEY") || "";

interface EconEvent {
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
  if (s === "high" || s === "3" || s.includes("high")) return "High";
  if (s === "medium" || s === "2" || s.includes("medium") || s.includes("moderate")) return "Medium";
  if (s === "low" || s === "1" || s.includes("low")) return "Low";
  return "None";
}

const HIGH_IMPACT_KEYWORDS = [
  "fomc", "fed ", "federal reserve", "interest rate", "rate decision",
  "powell", "cpi", "ppi", "pce", "non-farm", "nonfarm", "unemployment",
  "jobs report", "payrolls", "gdp", "retail sales", "ism", "pmi",
  "consumer confidence", "michigan", "fed chair", "jackson hole",
  "initial jobless", "continuing claims", "housing starts", "durable goods",
];

function bumpImpact(ev: EconEvent): EconEvent {
  if (ev.impact === "High") return ev;
  const text = ev.event.toLowerCase();
  if (HIGH_IMPACT_KEYWORDS.some((k) => text.includes(k))) {
    return { ...ev, impact: "High" };
  }
  return ev;
}

// ----------- Finnhub -----------
async function fromFinnhub(from: string, to: string): Promise<EconEvent[]> {
  if (!FINNHUB_KEY) return [];
  const url = `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${FINNHUB_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error("Finnhub economic error", res.status);
      return [];
    }
    const data = await res.json();
    const list: any[] = data?.economicCalendar || data?.calendar || [];
    if (!Array.isArray(list)) return [];
    return list.map((e: any): EconEvent => {
      // Finnhub provides "time" as "YYYY-MM-DD HH:MM:SS" UTC
      const iso = e.time
        ? new Date(e.time.replace(" ", "T") + "Z").toISOString()
        : (e.date ? new Date(e.date + "T13:30:00Z").toISOString() : new Date().toISOString());
      return {
        date: iso,
        country: String(e.country || "US"),
        event: String(e.event || ""),
        impact: normalizeImpact(e.impact),
        actual: e.actual ?? null,
        estimate: e.estimate ?? null,
        previous: e.prev ?? e.previous ?? null,
        unit: e.unit || null,
        currency: null,
      };
    });
  } catch (e) {
    console.error("Finnhub economic fetch failed:", e);
    return [];
  }
}

// ----------- FMP fallback (tries both legacy v3 and new "stable" endpoint) -----------
async function fromFMP(from: string, to: string): Promise<EconEvent[]> {
  if (!FMP_KEY) return [];
  const urls = [
    `https://financialmodelingprep.com/stable/economic-calendar?from=${from}&to=${to}&apikey=${FMP_KEY}`,
    `https://financialmodelingprep.com/api/v3/economic_calendar?from=${from}&to=${to}&apikey=${FMP_KEY}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.log("FMP econ endpoint failed", res.status, url.split("?")[0]);
        continue;
      }
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
    } catch (err) {
      console.log("FMP econ fetch error", err);
    }
  }
  return [];
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    let body: any = {};
    try { body = await req.json(); } catch {}
    const includeTomorrow = !!body.includeTomorrow;

    const from = todayISO(0);
    const to = todayISO(includeTomorrow ? 1 : 0);

    let events = await fromFinnhub(from, to);
    let source = "finnhub";
    if (events.length === 0) {
      events = await fromFMP(from, to);
      source = "fmp";
    }

    const RELEVANT = new Set(["US", "EU", "GB", "CN", "JP", "DE"]);

    events = events
      .map(bumpImpact)
      .filter((e) => e.event && (RELEVANT.has(e.country) || e.impact === "High"))
      .filter((e) => e.impact === "High" || e.impact === "Medium");

    // Dedupe by event + country
    const seen = new Set<string>();
    events = events.filter((e) => {
      const k = `${e.country}|${e.event}|${e.date.slice(0, 13)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const impactRank = { High: 0, Medium: 1, Low: 2, None: 3 } as const;
    events.sort((a, b) => {
      const r = impactRank[a.impact] - impactRank[b.impact];
      if (r !== 0) return r;
      return a.date.localeCompare(b.date);
    });

    return jsonResponse({
      events: events.slice(0, 25),
      fetchedAt: new Date().toISOString(),
      window: { from, to },
      source,
    });
  } catch (e) {
    console.error("economic-calendar error:", e);
    return jsonResponse({ events: [], error: e instanceof Error ? e.message : "unknown" });
  }
});
