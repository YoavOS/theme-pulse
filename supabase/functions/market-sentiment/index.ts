import { corsHeaders } from "../_shared/cors.ts";

/** ---------------------------------------------------------------
 * market-sentiment — positioning and sentiment for the Market Flag page.
 *
 *   COT (CFTC Commitments of Traders, legacy futures report, weekly):
 *     E-mini S&P 500, Nasdaq-100 mini, Russell 2000 mini, Dow ($5).
 *     Speculators = non-commercials, hedgers = commercials. COT index = where this week's
 *     net position sits within its 3-year range (0 = most short, 100 = most long).
 *   AAII Sentiment Survey (weekly): % bullish / neutral / bearish individual investors.
 *
 * Both are public and need no key. Each source fails independently (null + an error note).
 * Cached per warm instance for 3 hours.
 * (NAAIM's exposure index went subscription-only in August 2026, so it is not included.)
 * --------------------------------------------------------------*/

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TTL = 3 * 60 * 60 * 1000;

const CONTRACTS: { code: string; key: string; name: string }[] = [
  { code: "13874A", key: "ES", name: "S&P 500" },
  { code: "209742", key: "NQ", name: "Nasdaq-100" },
  { code: "239742", key: "RTY", name: "Russell 2000" },
  { code: "124603", key: "YM", name: "Dow" },
];

export interface CotContract {
  key: string; name: string; date: string; oi: number;
  specNet: number; specNetPct: number; specIndex: number; specChg1w: number;
  commNet: number; commIndex: number;
  specIndexHist: number[];   // last 52 weeks, oldest → newest
  read: string;
}
export interface AaiiWeek { date: string; bull: number; neutral: number; bear: number }

let cache: { at: number; body: unknown } | null = null;

const rangeIndex = (v: number, arr: number[]) => {
  const lo = Math.min(...arr), hi = Math.max(...arr);
  return hi > lo ? Math.round(((v - lo) / (hi - lo)) * 100) : 50;
};

async function fetchCot(): Promise<CotContract[]> {
  const since = new Date(Date.now() - 3 * 365 * 86400_000).toISOString().slice(0, 10);
  const where = `cftc_contract_market_code in(${CONTRACTS.map((c) => `'${c.code}'`).join(",")}) AND report_date_as_yyyy_mm_dd >= '${since}'`;
  const url = `https://publicreporting.cftc.gov/resource/6dca-aqww.json?$select=report_date_as_yyyy_mm_dd,cftc_contract_market_code,open_interest_all,noncomm_positions_long_all,noncomm_positions_short_all,comm_positions_long_all,comm_positions_short_all&$where=${encodeURIComponent(where)}&$order=report_date_as_yyyy_mm_dd&$limit=5000`;
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`CFTC HTTP ${res.status}`);
  const rows = await res.json() as Record<string, string>[];
  const out: CotContract[] = [];
  for (const c of CONTRACTS) {
    const s = rows.filter((r) => r.cftc_contract_market_code === c.code)
      .map((r) => ({
        date: r.report_date_as_yyyy_mm_dd.slice(0, 10),
        oi: Number(r.open_interest_all),
        spec: Number(r.noncomm_positions_long_all) - Number(r.noncomm_positions_short_all),
        comm: Number(r.comm_positions_long_all) - Number(r.comm_positions_short_all),
      }))
      .filter((x) => Number.isFinite(x.spec) && Number.isFinite(x.comm) && x.oi > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (s.length < 30) continue;
    const specs = s.map((x) => x.spec), comms = s.map((x) => x.comm);
    const last = s[s.length - 1], prev = s[s.length - 2];
    const specIndex = rangeIndex(last.spec, specs), commIndex = rangeIndex(last.comm, comms);
    const hist = s.slice(-52).map((x, k, a) => rangeIndex(x.spec, specs.slice(0, s.length - a.length + k + 1)));
    const read = specIndex >= 80 ? "Speculators crowded long — risk if they unwind"
      : specIndex <= 20 ? "Speculators crowded short — squeeze risk to the upside"
      : commIndex >= 80 ? "Balanced — commercials (hedgers) unusually long, a constructive sign"
      : commIndex <= 20 ? "Balanced — commercials unusually short"
      : "Balanced";
    out.push({
      key: c.key, name: c.name, date: last.date, oi: last.oi,
      specNet: last.spec, specNetPct: Math.round((last.spec / last.oi) * 1000) / 10, specIndex, specChg1w: last.spec - prev.spec,
      commNet: last.comm, commIndex, specIndexHist: hist, read,
    });
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

async function fetchAaii(): Promise<AaiiWeek[]> {
  const res = await fetch("https://www.aaii.com/sentimentsurvey/sent_results", {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`AAII HTTP ${res.status}`);
  const html = await res.text();
  const re = /class="tableTxt">\s*([A-Z][a-z]{2}) (\d{1,2})\s*<\/td>\s*<td[^>]*>\s*([\d.]+)%\s*<\/td>\s*<td[^>]*>\s*([\d.]+)%\s*<\/td>\s*<td[^>]*>\s*([\d.]+)%/g;
  const out: AaiiWeek[] = [];
  const now = new Date();
  let year = now.getUTCFullYear(), lastMonth = 99;
  for (const m of html.matchAll(re)) {
    const mon = MONTHS.indexOf(m[1]);
    if (mon < 0) continue;
    // rows are newest first: when the month jumps up going back in time, we crossed into the prior year
    if (lastMonth !== 99 && mon > lastMonth) year--;
    if (lastMonth === 99 && mon > now.getUTCMonth()) year--;
    lastMonth = mon;
    out.push({ date: `${year}-${String(mon + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`, bull: Number(m[3]), neutral: Number(m[4]), bear: Number(m[5]) });
  }
  if (!out.length) throw new Error("AAII page format changed or blocked");
  return out.reverse(); // oldest → newest
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const body = await req.json().catch(() => ({})) as { force?: boolean };
  if (!body.force && cache && Date.now() - cache.at < TTL) return json(cache.body);

  const errors: string[] = [];
  const [cot, aaii] = await Promise.all([
    fetchCot().catch((e) => { errors.push(`COT: ${e instanceof Error ? e.message : e}`); return null; }),
    fetchAaii().catch((e) => { errors.push(`AAII: ${e instanceof Error ? e.message : e}`); return null; }),
  ]);
  const out = {
    generatedAt: new Date().toISOString(),
    cot,
    aaii: aaii ? { weeks: aaii, longRun: { bull: 37.5, neutral: 31.5, bear: 31.0 } } : null,
    errors,
  };
  if (cot || aaii) cache = { at: Date.now(), body: out };
  return json(out);
});
