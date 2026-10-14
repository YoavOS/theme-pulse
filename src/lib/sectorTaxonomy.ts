// GICS-style hierarchical taxonomy: Sector → Industry → Sub-Industry.
//
// The raw labels below are the granular classification strings the data
// providers return (Finnhub `finnhubIndustry`, with FMP/Yahoo fallbacks stored
// in qualified_rs_universe.sector). Those raw labels are treated as the
// SUB-INDUSTRY level. Each one rolls up to a mid-level INDUSTRY, and each
// industry rolls up to a broad GICS SECTOR.
//
// Everything is resolved locally from this static map, so classification costs
// zero API calls and is stable across the whole app.
import { classifyLabel } from "@/lib/gicsTaxonomy";

export const SECTOR_HIERARCHY: Record<string, Record<string, string[]>> = {
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

/** Flat sector → all raw sub-industry labels (kept for backward compatibility). */
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

const LABEL_TO_NODE = (() => {
  const map = new Map<string, { sector: string; industry: string }>();
  for (const [sector, groups] of Object.entries(SECTOR_HIERARCHY)) {
    for (const [industry, labels] of Object.entries(groups)) {
      map.set(norm(industry), { sector, industry });
      for (const l of labels) if (!map.has(norm(l))) map.set(norm(l), { sector, industry });
    }
  }
  return map;
})();

export interface Classification {
  sector: string;
  industry: string;
  subIndustry: string;
}

/** Resolve a raw provider label into the full Sector → Industry → Sub-Industry chain. */
export function classifyIndustry(raw: string | null | undefined): Classification {
  const label = (raw ?? "").trim();
  if (!label) return { sector: "Unknown", industry: "Unknown", subIndustry: "Unknown" };
  const g = classifyLabel(label);
  if (g.sector !== "Other") return g;
  const node = LABEL_TO_NODE.get(norm(label));
  if (!node) return { sector: "Other", industry: "Other", subIndustry: label };
  return { sector: node.sector, industry: node.industry, subIndustry: label };
}

/** Broad GICS sector for a raw label (legacy helper). */
export function gicsForIndustry(industry: string | null | undefined): string | null {
  if (!industry) return null;
  const s = classifyIndustry(industry).sector;
  return s === "Other" || s === "Unknown" ? null : s;
}

/** Mid-level industry for a raw label. */
export function industryForLabel(industry: string | null | undefined): string | null {
  if (!industry) return null;
  const i = classifyIndustry(industry).industry;
  return i === "Other" || i === "Unknown" ? null : i;
}

/** Expand a set of selected labels (mix of sectors, industries and raw labels) to raw labels. */
export function expandSelectedToIndustries(selected: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const item of selected) {
    if (SECTOR_HIERARCHY[item]) {
      for (const ind of Object.values(SECTOR_HIERARCHY[item]).flat()) out.add(norm(ind));
    } else {
      const sectorOfIndustry = Object.entries(SECTOR_HIERARCHY).find(([, g]) => g[item]);
      if (sectorOfIndustry) {
        for (const l of sectorOfIndustry[1][item]) out.add(norm(l));
      } else {
        out.add(norm(item));
      }
    }
  }
  return out;
}
