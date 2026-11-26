import { SEC_UA } from "./secFundamentals.ts";

export interface EarningsRelease {
  filed: string;
  url: string;
  quarter: { end: string; revenue: number; operatingIncome: number | null; netIncome: number; priorRevenue: number | null; dilutedEPS?: number | null } | null;
}

const day = 86400000;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const monthDate = /^[A-Za-z]+ \d{1,2}, \d{4}$/;

// Quarterly results commonly arrive a few weeks after the next period ends.
export function reportingWindow(asOf: string | null, now = Date.now()) {
  return !!asOf && now - Date.parse(asOf) >= 90 * day;
}

function plain(html: string) {
  return html.replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|#160|#8194);/gi, " ")
    .replace(/&(?:mdash|ndash|#8212|#8211);/gi, "—")
    .replace(/\s+/g, " ").trim();
}

function tableRows(table: string) {
  return Array.from(table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi), row =>
    Array.from(row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi), cell => plain(cell[1])).filter(Boolean));
}

function values(row: string[], count: number, units: number) {
  const cells = row.slice(1).filter(cell => cell !== "$").join(" ").replace(/\(\s*([\d,.]+)\s*\)/g, "-$1").split(/\s+/);
  if (cells.length !== count) return null;
  return cells.map(cell => {
    if (!/^-?\d[\d,]*(?:\.\d+)?$/.test(cell)) return null;
    const value = Number(cell.replace(/,/g, "")) * units;
    return Number.isFinite(value) ? value : null;
  });
}

// Accept only explicitly dated USD quarterly statement columns with clear GAAP row labels.
export function parseReleaseQuarter(html: string, asOf: string, filed: string): EarningsRelease["quarter"] {
  const candidates: NonNullable<EarningsRelease["quarter"]>[] = [];
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = tableRows(table[1]);
    const heading = rows.findIndex(row => /^(?:three|3) months ended\b/i.test(row[0] ?? ""));
    if (heading < 0) continue;
    const header = rows.slice(heading, heading + 4).find(row => row.some(cell => monthDate.test(cell)));
    if (!header) continue;
    const dates = header.filter(cell => monthDate.test(cell));
    const unitLabel = rows.slice(0, heading + 4).flat().find(cell => /\b(?:dollars|usd|u\.s\. dollars|\$)\s+in\s+(?:millions|thousands)\b/i.test(cell));
    if (!unitLabel || dates.length < 2) continue;
    const units = /millions/i.test(unitLabel) ? 1e6 : 1e3;
    const timestamp = Date.parse(dates[0] + " UTC");
    const yearGap = (timestamp - Date.parse(dates[1] + " UTC")) / day;
    const periodGap = (timestamp - Date.parse(asOf)) / day;
    const releaseGap = (Date.parse(filed) - timestamp) / day;
    if (!(yearGap >= 350 && yearGap <= 380 && periodGap >= 75 && periodGap <= 105 && releaseGap >= 0 && releaseGap <= 90)) continue;
    const end = new Date(timestamp).toISOString().slice(0, 10);
    const find = (label: RegExp) => {
      const matching = rows.filter(row => label.test(row[0] ?? ""));
      return matching.length === 1 ? values(matching[0], dates.length, units) : null;
    };
    const revenue = find(/^(?:total (?:net )?revenues?|net revenues?|revenues?)$/i);
    const net = find(/^net (?:income|loss|earnings)(?: \((?:loss|income)\))?$/i);
    const operating = find(/^(?:income from operations|operating (?:income|loss|profit))(?: \(loss\))?$/i);
    if (revenue?.[0] != null && net?.[0] != null) {
      candidates.push({ end, revenue: revenue[0], priorRevenue: revenue[1], netIncome: net[0], operatingIncome: operating?.[0] ?? null });
    }
  }
  return candidates.length === 1 ? candidates[0] : null;
}

type RecentFilings = Record<string, string[]>;

export function findEarningsFiling(cik: string | number, recent: RecentFilings, asOf: string, lastFiled: string | null) {
  const index = recent.form?.findIndex((form, i) => {
    const filed = recent.filingDate?.[i] ?? "";
    return form === "8-K" && recent.items?.[i]?.split(",").some(item => item.trim() === "2.02")
      && datePattern.test(filed) && filed > (lastFiled ?? asOf) && Date.parse(filed) - Date.parse(asOf) >= 75 * day;
  });
  if (index == null || index < 0) return null;
  const filed = recent.filingDate[index];
  const accession = recent.accessionNumber?.[index] ?? "";
  const document = recent.primaryDocument?.[index] ?? "";
  if (!/^\d{10}-\d{2}-\d{6}$/.test(accession) || !/^[\w.-]+\.html?$/i.test(document)) return null;
  const base = "https://www.sec.gov/Archives/edgar/data/" + Number(cik) + "/" + accession.replace(/-/g, "") + "/";
  return { filed, url: base + document };
}

export async function readEarningsRelease(source: { filed: string; url: string }, asOf: string): Promise<EarningsRelease> {
  const filing = { ...source, quarter: null };
  const read = async (url: string) => {
    const r = await fetch(url, { headers: { "User-Agent": SEC_UA }, signal: AbortSignal.timeout(5000) });
    if (r.ok) return r.text();
    await r.body?.cancel();
    return "";
  };
  try {
    const html = await read(filing.url);
    const link = tableRows(html).find(row => /^(?:99|99\.1|99\.01)$/.test(row[0] ?? "")
      && /(?:press|earnings|news) release/i.test(row[1] ?? ""));
    if (!link) return filing;
    const exhibit = Array.from(html.matchAll(/<a\b[^>]*\bhref=["']([\w.-]+\.html?)["'][^>]*>([\s\S]*?)<\/a>/gi))
      .find(match => [link[0], link[1]].includes(plain(match[2])));
    if (!exhibit) return filing;
    const url = new URL(exhibit[1], source.url).href;
    return { filed: source.filed, url, quarter: parseReleaseQuarter(await read(url), asOf, source.filed) };
  } catch {
    return filing;
  }
}

