// Economic calendar — fetches today's (and optionally tomorrow's) high-impact
// macro events from Financial Modeling Prep. Filtered to market-moving items
// and ranked by impact. Lightweight; no DB writes.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

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

// Keywords that bump an event's importance regardless of FMP's tag.
const HIGH_IMPACT_KEYWORDS = [
  "fomc", "fed ", "federal reserve", "interest rate", "rate decision",
  "powell", "cpi", "ppi", "pce", "non-farm", "nonfarm", "unemployment",
  "jobs report", "payrolls", "gdp", "retail sales", "ism", "pmi",
  "consumer confidence", "michigan", "fed chair", "jackson hole",
];

function isImportant(ev: EconEvent): boolean {
  if (ev.impact === "High") return true;
  const text = ev.event.toLowerCase();
  return HIGH_IMPACT_KEYWORDS.some((k) => text.includes(k));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!FMP_KEY) {
      return jsonResponse({ events: [], error: "FMP_API_KEY not configured" });
    }

    let body: any = {};
    try { body = await req.json(); } catch {}
    const includeTomorrow = !!body.includeTomorrow;

    const from = todayISO(0);
    const to = todayISO(includeTomorrow ? 1 : 0);

    const url = `https://financialmodelingprep.com/api/v3/economic_calendar?from=${from}&to=${to}&apikey=${FMP_KEY}`;
    const res = await fetch(url);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("FMP economic_calendar error", res.status, txt.slice(0, 200));
      return jsonResponse({ events: [], error: `FMP ${res.status}` });
    }

    const raw = await res.json();
    if (!Array.isArray(raw)) {
      return jsonResponse({ events: [] });
    }

    // Focus on US + global market-moving regions.
    const RELEVANT_COUNTRIES = new Set(["US", "EU", "GB", "CN", "JP", "DE"]);

    const events: EconEvent[] = raw
      .map((e: any): EconEvent => ({
        date: e.date,
        country: String(e.country || ""),
        event: String(e.event || ""),
        impact: normalizeImpact(e.impact),
        actual: e.actual ?? null,
        estimate: e.estimate ?? null,
        previous: e.previous ?? null,
        unit: e.unit || null,
        currency: e.currency || null,
      }))
      .filter((e) => e.event && (RELEVANT_COUNTRIES.has(e.country) || isImportant(e)))
      .filter((e) => isImportant(e) || e.impact === "Medium");

    // Sort by impact, then by time
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
    });
  } catch (e) {
    console.error("economic-calendar error:", e);
    return jsonResponse({ events: [], error: e instanceof Error ? e.message : "unknown" });
  }
});
