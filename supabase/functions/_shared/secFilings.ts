// ─────────────────────────────────────────────────────────────
// SEC EDGAR filing feed: daily form index + Form 4 (insider) parsing.
//
// Daily index:  https://www.sec.gov/Archives/edgar/daily-index/YYYY/QTRn/master.YYYYMMDD.idx
//   pipe-delimited "CIK|Company Name|Form Type|Date Filed|Filename", one row per filing per
//   related entity (a Form 4 is listed under both the issuer and the insider).
// Form 4:       the filing's full .txt holds an <ownershipDocument> XML.
//
// Research basis: opportunistic insider purchases predict returns (Cohen, Malloy & Pomorski 2012,
// ~0.8%/month); purchases by several insiders close together are the stronger signal. Sales are
// mostly for diversification/taxes and carry little information, so only open-market purchases (P)
// and sales (S) are stored, and the app highlights purchases.
// ─────────────────────────────────────────────────────────────

export const SEC_UA = "ThemePulse research app (contact: noreply@anthropic.com)";

/** Periodic reports: a new one means new quarterly numbers in SEC companyfacts → rescore. */
export const PERIODIC_FORMS = new Set(["10-Q", "10-K", "20-F", "40-F"]);
export const INSIDER_FORMS = new Set(["4"]);

export interface IndexRow { cik: number; company: string; form: string; filed: string; path: string; accession: string }

export function masterIndexUrl(day: string): string {
  const [y, m, d] = day.split("-");
  const q = Math.floor((Number(m) - 1) / 3) + 1;
  return `https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${q}/master.${y}${m}${d}.idx`;
}

/** Parse a master.idx file. Filed dates come as YYYYMMDD (or YYYY-MM-DD) and are returned as YYYY-MM-DD. */
export function parseMasterIndex(text: string, forms?: Set<string>): IndexRow[] {
  const out: IndexRow[] = [];
  let body = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!body) { if (/^-{5,}$/.test(line)) body = true; continue; }
    if (!line) continue;
    const p = line.split("|");
    if (p.length < 5) continue;
    const cik = Number(p[0]), form = p[2].trim(), path = p[4].trim();
    if (!Number.isFinite(cik) || !path) continue;
    if (forms && !forms.has(form)) continue;
    const fd = p[3].trim();
    const filed = /^\d{8}$/.test(fd) ? `${fd.slice(0, 4)}-${fd.slice(4, 6)}-${fd.slice(6, 8)}` : fd;
    const acc = path.split("/").pop()!.replace(/\.txt$/i, "");
    out.push({ cik, company: p[1].trim(), form, filed, path, accession: acc });
  }
  return out;
}

export interface InsiderTrade {
  line: number;
  owner: string;
  ownerCik: number | null;
  title: string | null;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPct: boolean;
  code: "P" | "S";
  tradeDate: string | null;
  shares: number | null;
  price: number | null;
  value: number | null;
  plan10b51: boolean;
  symbol: string | null;
}

const tag = (xml: string, name: string): string | null => {
  const m = xml.match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`, "i"));
  return m ? m[1].trim() : null;
};
/** <name><value>x</value>…</name> (Form 4 wraps most fields in <value>). */
const val = (xml: string, name: string): string | null => {
  const inner = tag(xml, name);
  if (inner === null) return null;
  const v = tag(inner, "value");
  return v ?? (inner.includes("<") ? null : inner);
};
const flag = (v: string | null) => v !== null && /^(1|true)$/i.test(v.trim());
const num = (v: string | null) => { if (v === null || v === "") return null; const n = Number(v.replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
const unescape = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");

/**
 * Open-market purchases (P) and sales (S) from a Form 4 submission (.txt or bare XML).
 * Several reporting owners on one form (joint filings) are joined; the first one names the trade.
 */
export function parseForm4(text: string): InsiderTrade[] {
  const doc = text.match(/<ownershipDocument>[\s\S]*?<\/ownershipDocument>/i)?.[0];
  if (!doc) return [];
  const docType = tag(doc, "documentType");
  if (docType && docType.trim() !== "4") return [];
  const symbol = tag(doc, "issuerTradingSymbol");
  const owners = [...doc.matchAll(/<reportingOwner>([\s\S]*?)<\/reportingOwner>/gi)].map((m) => m[1]);
  const names = owners.map((o) => unescape(tag(o, "rptOwnerName") ?? "")).filter(Boolean);
  const first = owners[0] ?? "";
  const anyOwner = (k: string) => owners.some((o) => flag(tag(o, k)));
  const title = owners.map((o) => tag(o, "officerTitle")).find((t) => t && t.trim()) ?? null;
  const plan = flag(tag(doc, "aff10b5One"));
  const out: InsiderTrade[] = [];
  const txs = [...doc.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi)].map((m) => m[1]);
  txs.forEach((t, i) => {
    const code = tag(t, "transactionCode")?.toUpperCase();
    if (code !== "P" && code !== "S") return;
    const shares = num(val(t, "transactionShares"));
    const price = num(val(t, "transactionPricePerShare"));
    out.push({
      line: i,
      owner: names.join("; ") || "Unknown",
      ownerCik: num(tag(first, "rptOwnerCik")),
      title: title ? unescape(title) : null,
      isDirector: anyOwner("isDirector"),
      isOfficer: anyOwner("isOfficer"),
      isTenPct: anyOwner("isTenPercentOwner"),
      code,
      tradeDate: val(t, "transactionDate")?.slice(0, 10) ?? null,
      shares, price,
      value: shares !== null && price !== null ? Math.round(shares * price) : null,
      plan10b51: plan,
      symbol: symbol ? symbol.trim().toUpperCase() : null,
    });
  });
  return out;
}

/** CIK → tickers, from SEC's company_tickers.json (several share classes can share a CIK). */
export async function fetchCikTickers(): Promise<Map<number, string[]>> {
  const r = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: { "User-Agent": SEC_UA } });
  if (!r.ok) { await r.body?.cancel(); throw new Error(`company_tickers.json HTTP ${r.status}`); }
  const j = await r.json() as Record<string, { cik_str: number; ticker: string }>;
  const m = new Map<number, string[]>();
  for (const v of Object.values(j)) {
    const t = v.ticker.toUpperCase();
    m.set(v.cik_str, [...(m.get(v.cik_str) ?? []), t]);
  }
  return m;
}
