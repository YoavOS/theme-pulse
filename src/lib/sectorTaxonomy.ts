// GICS-style hierarchical taxonomy: Sector → Industry → Sub-Industry.
//
// The canonical names live in "@/lib/gicsTaxonomy" (GICS). Each stock's label
// (qualified_rs_universe.sector) is either a canonical sub-industry written by
// the `classify-tickers` function, or — until a stock is classified — the raw
// provider label (Finnhub industry). Both resolve through classifyIndustry().
//
// Everything is resolved locally, so classification costs zero API calls here.
import { GICS, classifyLabel } from "@/lib/gicsTaxonomy";

/** Canonical hierarchy (re-exported under the old name for existing imports). */
export const SECTOR_HIERARCHY: Record<string, Record<string, string[]>> = GICS;

/**
 * LEGACY provider-label map (Finnhub-era). Only used as a last-resort fallback to
 * find the SECTOR of an old raw label that the GICS module does not know.
 */
const LEGACY_LABELS: Record<string, Record<string, string[]>> = {
  "Energy": {
    "Oil, Gas & Consumable Fuels": ["Energy", "Oil, Gas & Consumable Fuels", "Oil & Gas", "Coal", "Uranium"],
    "Energy Equipment & Services": ["Energy Equipment & Services", "Oil & Gas Services"],
  },
  "Materials": {
    "Chemicals": ["Chemicals", "Specialty Chemicals", "Agricultural Chemicals"],
    "Metals & Mining": ["Metals & Mining", "Steel", "Gold", "Copper", "Aluminum"],
    "Containers & Packaging": ["Containers & Packaging", "Packaging"],
    "Construction Materials": ["Construction Materials", "Cement"],
    "Paper & Forest Products": ["Paper & Forest", "Paper & Forest Products", "Materials"],
  },
  "Industrials": {
    "Aerospace & Defense": ["Aerospace & Defense", "Defense"],
    "Transportation": [
      "Airlines", "Air Freight & Logistics", "Logistics & Transportation",
      "Marine", "Road & Rail", "Transportation Infrastructure", "Trucking", "Railroads",
    ],
    "Capital Goods": [
      "Machinery", "Electrical Equipment", "Industrial Conglomerates",
      "Building", "Building Products", "Construction", "Construction & Engineering",
      "Industrials",
    ],
    "Commercial & Professional Services": [
      "Commercial Services & Supplies", "Professional Services",
      "Staffing & Employment Services", "Security & Protection Services",
    ],
    "Trading Companies & Distributors": ["Trading Companies & Distributors", "Distributors"],
  },
  "Consumer Discretionary": {
    "Automobiles & Components": ["Auto Components", "Automobiles", "Auto Manufacturers", "Auto Parts"],
    "Consumer Durables & Apparel": [
      "Household Durables", "Leisure Products", "Textiles, Apparel & Luxury Goods",
      "Homebuilding", "Furnishings",
    ],
    "Consumer Services": ["Hotels, Restaurants & Leisure", "Diversified Consumer Services", "Restaurants", "Education", "Gambling & Casinos", "Travel Services"],
    "Retailing": [
      "Multiline Retail", "Specialty Retail", "Retail",
      "Internet & Direct Marketing Retail", "Consumer products", "Apparel Retail",
    ],
  },
  "Consumer Staples": {
    "Food, Beverage & Tobacco": ["Beverages", "Food Products", "Tobacco", "Farm Products"],
    "Food & Staples Retailing": ["Food & Staples Retailing", "Grocery Stores", "Discount Stores"],
    "Household & Personal Products": ["Household Products", "Personal Products"],
  },
  "Health Care": {
    "Biotechnology": ["Biotechnology"],
    "Pharmaceuticals": ["Pharmaceuticals", "Drug Manufacturers"],
    "Health Care Equipment & Supplies": ["Health Care Equipment & Supplies", "Medical Devices", "Medical Instruments & Supplies"],
    "Health Care Providers & Services": ["Health Care", "Health Care Providers & Services", "Medical Care Facilities", "Health Information Services"],
    "Life Sciences & Health Tech": ["Health Care Technology", "Life Sciences Tools & Services", "Diagnostics & Research"],
  },
  "Financials": {
    "Banks": ["Banking", "Banks", "Thrifts & Mortgage Finance", "Banks - Regional", "Banks - Diversified"],
    "Capital Markets": ["Capital Markets", "Asset Management", "Financial Data & Stock Exchanges", "Investment Banking & Brokerage"],
    "Insurance": ["Insurance"],
    "Consumer & Diversified Finance": [
      "Financial Services", "Consumer Finance", "Diversified Financial Services",
      "Credit Services", "Mortgage Real Estate Investment Trusts (REITs)",
    ],
  },
  "Information Technology": {
    "Software": ["Software", "Technology", "Software - Application", "Software - Infrastructure"],
    "IT Services": ["IT Services", "Information Technology Services", "Communications"],
    "Semiconductors": ["Semiconductors", "Semiconductors & Semiconductor Equipment", "Semiconductor Equipment & Materials"],
    "Hardware & Equipment": [
      "Technology Hardware, Storage & Peripherals",
      "Electronic Equipment, Instruments & Components",
      "Computer Hardware", "Communication Equipment", "Solar",
    ],
  },
  "Communication Services": {
    "Media & Entertainment": ["Media", "Entertainment", "Broadcasting", "Advertising Agencies", "Electronic Gaming & Multimedia"],
    "Interactive Media & Services": ["Interactive Media & Services", "Internet Content & Information"],
    "Telecommunication Services": [
      "Diversified Telecommunication Services", "Wireless Telecommunication Services", "Telecommunication",
    ],
  },
  "Utilities": {
    "Regulated Utilities": ["Utilities", "Electric Utilities", "Gas Utilities", "Multi-Utilities", "Water Utilities"],
    "Independent & Renewable Power": [
      "Independent Power and Renewable Electricity Producers", "Renewable Energy", "Renewable Utilities",
    ],
  },
  "Real Estate": {
    "Equity REITs": ["Equity Real Estate Investment Trusts (REITs)", "REIT"],
    "Real Estate Management & Development": ["Real Estate", "Real Estate Management & Development", "Real Estate Services"],
  },
};

/** Flat sector → all canonical sub-industries. */
export const GICS_SECTORS: Record<string, string[]> = Object.fromEntries(
  Object.entries(SECTOR_HIERARCHY).map(([sector, groups]) => [sector, Object.values(groups).flat()]),
);

export const ALL_GICS_SECTORS = Object.keys(SECTOR_HIERARCHY);

/** Ordered industry list per sector. */
export const INDUSTRIES_BY_SECTOR: Record<string, string[]> = Object.fromEntries(
  Object.entries(SECTOR_HIERARCHY).map(([sector, groups]) => [sector, Object.keys(groups)]),
);

export const ALL_INDUSTRIES = Object.values(INDUSTRIES_BY_SECTOR).flat();

const norm = (v: string | null | undefined) => (v ?? "").toLowerCase().trim();

const LEGACY_NODE = (() => {
  const map = new Map<string, { sector: string; industry: string }>();
  for (const [sector, groups] of Object.entries(LEGACY_LABELS)) {
    const canonical = new Set((INDUSTRIES_BY_SECTOR[sector] ?? []).map(norm));
    for (const [legacyIndustry, labels] of Object.entries(groups)) {
      // Keep the legacy industry only when it is also a canonical GICS industry name.
      const industry = canonical.has(norm(legacyIndustry))
        ? INDUSTRIES_BY_SECTOR[sector].find((i) => norm(i) === norm(legacyIndustry))!
        : "Other";
      const node = { sector, industry };
      if (!map.has(norm(legacyIndustry))) map.set(norm(legacyIndustry), node);
      for (const l of labels) if (!map.has(norm(l))) map.set(norm(l), node);
    }
  }
  return map;
})();

export interface Classification {
  sector: string;
  industry: string;
  subIndustry: string;
}

/** Resolve a stock label into the full Sector → Industry → Sub-Industry chain. */
export function classifyIndustry(raw: string | null | undefined): Classification {
  const label = (raw ?? "").trim();
  if (!label) return { sector: "Unknown", industry: "Unknown", subIndustry: "Unknown" };
  const g = classifyLabel(label);
  if (g.sector !== "Other") return g;
  // Not yet classified, broad provider label (e.g. "Technology"): best-effort
  // sector (and industry when it is a canonical name); the classifier fixes it later.
  const node = LEGACY_NODE.get(norm(label));
  if (node) return { sector: node.sector, industry: node.industry, subIndustry: label };
  return { sector: "Other", industry: "Other", subIndustry: label };
}

/** Broad GICS sector for a label (legacy helper). */
export function gicsForIndustry(industry: string | null | undefined): string | null {
  if (!industry) return null;
  const s = classifyIndustry(industry).sector;
  return s === "Other" || s === "Unknown" ? null : s;
}

/** Mid-level industry for a label. */
export function industryForLabel(industry: string | null | undefined): string | null {
  if (!industry) return null;
  const i = classifyIndustry(industry).industry;
  return i === "Other" || i === "Unknown" ? null : i;
}

/**
 * Build a matcher for "exclude sectors" filters. The selection may contain
 * sector names, industry names, sub-industry names or old raw provider labels
 * (from saved settings); a stock is excluded if any level of its label matches.
 */
export function buildGroupExcluder(selected: Set<string>): (label: string | null | undefined) => boolean {
  const sel = new Set([...selected].map(norm));
  if (sel.size === 0) return () => false;
  const cache = new Map<string, boolean>();
  return (label) => {
    const key = norm(label);
    if (!key) return false;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const c = classifyIndustry(label);
    const out = sel.has(key) || sel.has(norm(c.sector)) || sel.has(norm(c.industry)) || sel.has(norm(c.subIndustry));
    cache.set(key, out);
    return out;
  };
}
