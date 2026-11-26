// Compact shared SEC cache: both Lens and Proven consume the same parsed filing snapshot.
import { SEC_UA, secCik } from "./secFundamentals.ts";
import { parseLensHistory } from "./lensMetrics.ts";
import { parseAnnualPanel } from "./provenEngine.ts";
import { classifyLabel } from "./gicsTaxonomy.ts";
import { findEarningsFiling, reportingWindow } from "./earningsRelease.ts";
import { foreignReleaseCandidates } from "./foreignEarnings.ts";
const VERSION = 6;   // 6: bank income lines (net interest income, provisions, non-interest expense)
export async function companyFinancials(sb: any, symbol: string, refresh = false) {
  const { data: hit } = await sb.from("company_financial_cache").select("payload, fetched_at").eq("symbol", symbol).maybeSingle();
  const cacheHours = reportingWindow(hit?.payload?.history?.quarters?.[0]?.end ?? null) ? 1 : 12;
  if (!refresh && hit?.payload?.version === VERSION && Date.now() - Date.parse(hit.fetched_at) < cacheHours * 3600000) return hit.payload;
  const cik = await secCik(symbol);
  if (!cik) throw new Error("Company identity not found in SEC data. Check the ticker; foreign issuers may not have supported US-GAAP statements.");
  const url = "https://data.sec.gov/api/xbrl/companyfacts/CIK" + String(cik).padStart(10, "0") + ".json";
  const res = await fetch(url, { headers: { "User-Agent": SEC_UA }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) { await res.body?.cancel(); throw new Error("SEC temporarily unavailable (HTTP " + res.status + "). Retry later."); }
  const facts = await res.json();
  const history = parseLensHistory(facts);
  const annual = parseAnnualPanel(facts);
  let sic: number | null = null;
  let secBusiness: { industry: string | null; annualUrl: string | null; annualFiled: string | null } | null = null;
  let earningsFiling: ReturnType<typeof findEarningsFiling> = null;
  let foreignFilings: ReturnType<typeof foreignReleaseCandidates> = [];
  try {
    const r = await fetch("https://data.sec.gov/submissions/CIK" + String(cik).padStart(10, "0") + ".json", { headers: { "User-Agent": SEC_UA }, signal: AbortSignal.timeout(10000) });
    if (r.ok) {
      const submission = await r.json();
      sic = Number(submission.sic) || null;
      const recent = submission.filings?.recent;
      const annualIndex = recent?.form?.findIndex((form: string) => /^(?:10-K|20-F|40-F)$/.test(form)) ?? -1;
      const accession = recent?.accessionNumber?.[annualIndex] ?? "";
      const doc = recent?.primaryDocument?.[annualIndex] ?? "";
      secBusiness = {
        industry: typeof submission.sicDescription === "string" ? submission.sicDescription : null,
        annualUrl: /^\d{10}-\d{2}-\d{6}$/.test(accession) && /^[\w.-]+\.html?$/i.test(doc)
          ? `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/${doc}` : null,
        annualFiled: annualIndex < 0 ? null : recent.filingDate?.[annualIndex] ?? null,
      };
      const latest = history.quarters[0];
      if (latest && submission.filings?.recent) {
        earningsFiling = findEarningsFiling(cik, submission.filings.recent, latest.end, latest.filed);
      } else if (submission.filings?.recent) {
        foreignFilings = foreignReleaseCandidates(cik, submission.filings.recent);
      }
    } else await r.body?.cancel();
  } catch { /* Classification remains explicitly unknown when SEC metadata is unavailable. */ }
  const payload = { version: VERSION, cik, company: facts.entityName ?? null, sic, secBusiness, history, annual, earningsFiling, foreignFilings, fetchedAt: new Date().toISOString(), source: url };
  await sb.from("company_financial_cache").upsert({ symbol, payload, fetched_at: payload.fetchedAt });
  return payload;
}
export function companyClassification(label: string | null, sic: number | null) {
  const known = classifyLabel(label);
  if (known.sector !== "Unknown" && known.sector !== "Other") return known;
  // SEC SIC identifies the economic model, not the company's investment quality.
  const sub = sic && sic >= 6000 && sic < 6100 ? "Diversified Banks"
    : sic && sic >= 6100 && sic < 6200 ? "Consumer Finance"
    : sic && sic >= 6200 && sic < 6300 ? "Investment Banking & Brokerage"
    : sic && sic >= 6300 && sic < 6400 ? "Multi-line Insurance" : null;
  return sub ? classifyLabel(sub) : known;
}
