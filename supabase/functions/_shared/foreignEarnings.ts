import { SEC_UA } from "./secFundamentals.ts";
import type { StatementPeriod } from "./financialStatements.ts";
import type { QuarterRow } from "./lensMetrics.ts";

type Filing = { filed: string; url: string };
type ReleaseQuarter = StatementPeriod & {
  sourceUrl: string; filed: string; dilutedEPS: number | null; dilutedShares: number | null;
  pretax: number | null; inst: QuarterRow["inst"];
};
const days = 86400000;

export function foreignReleaseCandidates(cik: number, recent: Record<string, string[]>): Filing[] {
  const cutoff = new Date(Date.now() - 550 * days).toISOString().slice(0, 10);
  return (recent.form ?? []).flatMap((form, i) => {
    const filed = recent.filingDate?.[i] ?? "";
    const accession = recent.accessionNumber?.[i] ?? "";
    const document = recent.primaryDocument?.[i] ?? "";
    return form === "6-K" && /^\d{4}-\d{2}-\d{2}$/.test(filed) && filed >= cutoff
      && /^\d{10}-\d{2}-\d{6}$/.test(accession) && /^[\w.-]+\.html?$/i.test(document)
      ? [{ filed, url: "https://www.sec.gov/Archives/edgar/data/" + cik + "/" + accession.replace(/-/g, "") + "/" + document }]
      : [];
  }).slice(0, 14);
}

function plain(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&(?:nbsp|#160|#8194);/gi, " ")
    .replace(/&(?:minus|mdash|ndash|#8212|#8211);/gi, "-").replace(/\s+/g, " ").trim();
}

function readRows(html: string) {
  return Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi), row => {
    let col = 0;
    return Array.from(row[1].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi), cell => {
      const start = col;
      col += Number(cell[1].match(/\bcolspan\s*=\s*["']?(\d+)/i)?.[1] ?? 1);
      return { start, end: col, text: plain(cell[2]) };
    });
  });
}

function parseCell(text: string) {
  const value = text.replace(/[$,\s]/g, "").replace(/^\(([\d.]+)\)$/, "-$1");
  return /^-?\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : null;
}

type Table = RegExpMatchArray;
type Rows = ReturnType<typeof readRows>;
const isUsd = (text: string) => /^(?:U\.?S\.? dollars|USD)$/i.test(text);

function tableAmount(rows: Rows, label: RegExp, from: number, to: number, units: number) {
  const matches = rows.filter(row => label.test(row[0]?.text ?? ""));
  if (matches.length !== 1) return null;
  const cells = matches[0];
  let text = cells.filter(cell => cell.start >= from && cell.start < to).map(cell => cell.text).join("");
  if (text.trim().startsWith("(") && !text.includes(")") && cells.some(cell => cell.start === to && cell.text === ")")) text += ")";
  const value = parseCell(text);
  return value === null ? null : value * units;
}

function balanceSnapshots(html: string, tables: Table[]) {
  const snapshots = new Map<string, QuarterRow["inst"]>();
  const candidates = tables.flatMap(table => {
    const prefix = plain(html.slice(Math.max(0, table.index! - 1800), table.index));
    const title = prefix.match(/balance sheets?\s*\(unaudited\)\s*\(in (thousands|millions)\)\s*$/i);
    return title ? [{ rows: readRows(table[1]), scale: title[1].toLowerCase() === "millions" ? 1e6 : 1e3 }] : [];
  });
  if (candidates.length !== 1) return snapshots;
  const { rows, scale } = candidates[0];
  const dates = rows[0]?.filter(cell => /^[a-z]+ \d{1,2},?$/i.test(cell.text)) ?? [];
  if (dates.length !== 2 || !rows[2]?.some(cell => cell.start === dates[0].start && cell.end >= dates[1].end && isUsd(cell.text))) return snapshots;
  for (const [i, date] of dates.entries()) {
    const year = rows[1]?.find(cell => cell.start === date.start && /^20\d{2}$/.test(cell.text));
    const timestamp = Date.parse(date.text.replace(/,$/, "") + " " + year?.text + " UTC");
    if (!Number.isFinite(timestamp)) continue;
    const read = (label: RegExp) => tableAmount(rows, label, date.start, dates[i + 1]?.start ?? Infinity, scale);
    const assets = read(/^total assets$/i);
    const liabilities = read(/^total liabilities$/i);
    const equity = read(/^total shareholders['’] equity$/i);
    const currentAssets = read(/^total current assets$/i);
    const currentLiabilities = read(/^total current liabilities$/i);
    if (assets === null || liabilities === null || equity === null || Math.abs(assets - liabilities - equity) > scale * 2
      || currentAssets === null || currentLiabilities === null || currentAssets < 0 || currentAssets > assets
      || currentLiabilities < 0 || currentLiabilities > liabilities) continue;
    const cash = read(/^cash and cash equivalents$/i);
    snapshots.set(new Date(timestamp).toISOString().slice(0, 10), {
      cash, cashOnly: cash, assets, equity, currentAssets, currentLiabilities,
      receivables: read(/^trade accounts receivable, net$/i),
    });
  }
  return snapshots;
}

// Read only a clearly identified USD income statement. Column spans link the
// quarterly heading and year to the actual values, including signed losses.
export function parseForeignRelease(html: string, source: Filing): ReleaseQuarter[] {
  const candidates: ReleaseQuarter[][] = [];
  const tables = Array.from(html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi));
  const balances = balanceSnapshots(html, tables);
  for (const [tableIndex, table] of tables.entries()) {
    const prefix = plain(html.slice(Math.max(0, table.index! - 1800), table.index));
    const title = prefix.match(/(?:statement[s]? of (?:income|operations)|income statement)[^(]{0,75}\((?:unaudited)\)\s*\((?:[a-z.$ ]+\s)?in (thousands|millions)(?:[^)]*)\)\s*$/i);
    if (!title) continue;
    const scale = title[1].toLowerCase() === "millions" ? 1e6 : 1e3;
    const rows = readRows(table[1]);
    const heading = rows.findIndex(row => row.some(cell => /^(?:three|3) months ended [a-z]+ \d{1,2},?$/i.test(cell.text)));
    if (heading < 0) continue;
    const span = rows[heading].find(cell => /^(?:three|3) months ended /i.test(cell.text))!;
    if (!rows[heading + 2]?.some(cell => cell.start === span.start && /^(?:U\.?S\.? dollars|USD)$/i.test(cell.text))) continue;
    const years = (rows[heading + 1] ?? []).filter(cell => cell.start >= span.start && cell.start < span.end && /^20\d{2}$/.test(cell.text));
    if (years.length !== 2 || Number(years[0].text) - Number(years[1].text) !== 1) continue;
    const date = span.text.replace(/^(?:three|3) months ended /i, "").replace(/,$/, "");
    const latest = Date.parse(date + " " + years[0].text + " UTC");
    const lag = (Date.parse(source.filed) - latest) / days;
    if (!(lag >= 0 && lag <= 100)) continue;
    const epsLabel = /^diluted (?:net )?(?:earnings|income|loss)(?: \((?:earnings|income|loss)\))? per share(?: \([^)]*\))?$/i;
    const following = tables[tableIndex + 1];
    const epsRows = following ? readRows(following[1]) : [];
    const hasSameHeader = epsRows[0]?.[0]?.text.match(/^earnings.*per share/i)
      && epsRows[0].some(cell => cell.start === span.start && cell.end === span.end && cell.text === span.text)
      && years.every(year => epsRows[1]?.some(cell => cell.start === year.start && cell.text === year.text));
    const periods: ReleaseQuarter[] = [];
    for (const [i, year] of years.entries()) {
      const from = year.start;
      const to = years[i + 1]?.start ?? span.end;
      const read = (label: RegExp, units = scale, sourceRows = rows) => tableAmount(sourceRows, label, from, to, units);
      const revenue = read(/^(?:total )?(?:net )?revenues?$/i);
      const gross = read(/^gross profit$/i);
      const cost = read(/^cost of (?:net )?(?:revenues?|sales)$/i);
      const net = read(/^net (?:income|loss)(?: \((?:income|loss)\))?$/i);
      if (revenue === null || gross === null || cost === null || net === null || Math.abs(revenue - cost - gross) > scale * 2) break;
      const end = new Date(date + " " + year.text + " UTC").toISOString().slice(0, 10);
      const pretax = read(/^income \(loss\) before income taxes$/i);
      const taxBenefit = read(/^income tax benefit \(expense\)$/i);
      const tax = pretax !== null && taxBenefit !== null && Math.abs(pretax + taxBenefit - net) <= scale * 2 ? -taxBenefit : null;
      const shareRows = hasSameHeader ? epsRows : rows;
      const shareHeading = shareRows.findIndex(row => /^ordinary shares outstanding:$/i.test(row[0]?.text ?? ""));
      const dilutedShares = shareHeading >= 0 ? read(/^diluted$/i, scale, shareRows.slice(shareHeading + 1)) : null;
      periods.push({ id: "quarter:" + end, kind: "quarter", end, revenue, gross, cost, net,
        operating: read(/^(?:operating (?:income|profit|loss)(?: \((?:income|loss)\))?|income from operations)$/i),
        dilutedEPS: read(epsLabel, 1) ?? (hasSameHeader ? read(epsLabel, 1, epsRows) : null),
        rnd: read(/^research and development(?: expenses?)?$/i),
        sga: read(/^selling, general,? and administrative(?: expenses?)?$/i),
        tax, pretax, ocf: null, capex: null, sbc: null, shares: null, dilutedShares, inst: balances.get(end) ?? {}, sourceUrl: source.url, filed: source.filed });
    }
    if (periods.length) candidates.push(periods);
  }
  return candidates.length === 1 ? candidates[0] : [];
}

/** Convert verified release figures to the same inputs used for structured filing metrics. */
export function foreignQuarterHistory(periods: ReleaseQuarter[]): QuarterRow[] {
  return periods.map(p => ({
    end: p.end, filed: p.filed, sourceUrl: p.sourceUrl, shares: p.shares, dilutedEPS: p.dilutedEPS, dilutedShares: p.dilutedShares,
    flow: {
      revenue: p.revenue, costOfRevenue: p.cost, grossProfit: p.gross, operatingIncome: p.operating,
      netIncome: p.net, rnd: p.rnd, sga: p.sga, tax: p.tax, pretax: p.pretax,
    },
    inst: p.inst, fallback: [],
  }));
}

async function readForeignReport(filing: Filing) {
  const read = async (url: string) => {
    const r = await fetch(url, { headers: { "User-Agent": SEC_UA }, signal: AbortSignal.timeout(4000) });
    if (r.ok) return r.text();
    await r.body?.cancel();
    return "";
  };
  try {
    const html = await read(filing.url);
    const direct = parseForeignRelease(html, filing);
    if (direct.length) return direct;
    const exhibit = Array.from(html.matchAll(/<a\b[^>]*\bhref=["']([\w.-]+\.html?)["'][^>]*>([\s\S]*?)<\/a>/gi))
      .find(match => /\b(?:press release|earnings release|financial results)\b/i.test(plain(match[2])));
    if (!exhibit) return [];
    const url = new URL(exhibit[1], filing.url).href;
    return parseForeignRelease(await read(url), { ...filing, url });
  } catch {
    return [];
  }
}

export async function foreignQuarterlyReports(filings: Filing[]) {
  const reports: { filed: string; periods: ReleaseQuarter[] }[] = [];
  // Requests are limited to the recent SEC 6-K list and used only when the
  // structured quarterly history is empty. Keep SEC request concurrency low.
  for (let offset = 0; offset < filings.length; offset += 3) {
    const batch = filings.slice(offset, offset + 3);
    reports.push(...await Promise.all(batch.map(async filing => ({ filed: filing.filed, periods: await readForeignReport(filing) }))));
  }
  const periods = new Map<string, ReleaseQuarter>();
  for (const report of reports) for (const quarter of report.periods) {
    const existing = periods.get(quarter.end);
    if (!existing) periods.set(quarter.end, quarter);
    else if (!Object.keys(existing.inst).length) existing.inst = quarter.inst;
  }
  const sorted = [...periods.values()].sort((a, b) => b.end.localeCompare(a.end));
  const latest = sorted[0];
  const latestReport = reports.find(report => report.periods[0] === latest);
  return {
    quarters: foreignQuarterHistory(sorted),
    earningsRelease: latest && latestReport ? {
      filed: latestReport.filed, url: latest.sourceUrl,
      quarter: { end: latest.end, revenue: latest.revenue!, netIncome: latest.net!, operatingIncome: latest.operating,
        priorRevenue: latestReport.periods[1]?.revenue ?? null, dilutedEPS: latest.dilutedEPS },
    } : null,
  };
}

