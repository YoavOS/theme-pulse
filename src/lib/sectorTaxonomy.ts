// GICS-aligned sector taxonomy.
// Maps each broad GICS Sector to the granular industry labels Finnhub returns
// (stored in qualified_rs_universe.sector via prof.finnhubIndustry).
// When a user excludes a broad sector, every industry under it is excluded.

export const GICS_SECTORS: Record<string, string[]> = {
  "Energy": [
    "Energy", "Oil, Gas & Consumable Fuels", "Energy Equipment & Services",
  ],
  "Materials": [
    "Materials", "Chemicals", "Metals & Mining", "Paper & Forest",
    "Containers & Packaging", "Packaging", "Construction Materials",
  ],
  "Industrials": [
    "Industrials", "Aerospace & Defense", "Airlines", "Air Freight & Logistics",
    "Logistics & Transportation", "Building", "Building Products", "Construction",
    "Construction & Engineering", "Commercial Services & Supplies",
    "Professional Services", "Electrical Equipment", "Industrial Conglomerates",
    "Machinery", "Marine", "Road & Rail", "Trading Companies & Distributors",
    "Transportation Infrastructure", "Distributors",
  ],
  "Consumer Discretionary": [
    "Auto Components", "Automobiles", "Diversified Consumer Services",
    "Hotels, Restaurants & Leisure", "Household Durables", "Leisure Products",
    "Multiline Retail", "Specialty Retail", "Retail",
    "Textiles, Apparel & Luxury Goods", "Internet & Direct Marketing Retail",
    "Consumer products",
  ],
  "Consumer Staples": [
    "Beverages", "Food & Staples Retailing", "Food Products",
    "Household Products", "Personal Products", "Tobacco",
  ],
  "Health Care": [
    "Health Care", "Biotechnology", "Pharmaceuticals",
    "Health Care Equipment & Supplies", "Health Care Providers & Services",
    "Health Care Technology", "Life Sciences Tools & Services",
  ],
  "Financials": [
    "Financial Services", "Banking", "Banks", "Capital Markets",
    "Consumer Finance", "Diversified Financial Services", "Insurance",
    "Mortgage Real Estate Investment Trusts (REITs)", "Thrifts & Mortgage Finance",
  ],
  "Information Technology": [
    "Technology", "Software", "IT Services", "Communications", "Semiconductors",
    "Semiconductors & Semiconductor Equipment", "Technology Hardware, Storage & Peripherals",
    "Electronic Equipment, Instruments & Components",
  ],
  "Communication Services": [
    "Media", "Entertainment", "Interactive Media & Services",
    "Diversified Telecommunication Services", "Wireless Telecommunication Services",
    "Telecommunication",
  ],
  "Utilities": [
    "Utilities", "Electric Utilities", "Gas Utilities", "Multi-Utilities",
    "Water Utilities", "Independent Power and Renewable Electricity Producers",
    "Renewable Energy",
  ],
  "Real Estate": [
    "Real Estate", "Equity Real Estate Investment Trusts (REITs)",
    "Real Estate Management & Development",
  ],
};

export const ALL_GICS_SECTORS = Object.keys(GICS_SECTORS);

// Reverse lookup: industry -> GICS sector (case-insensitive).
const INDUSTRY_TO_GICS = (() => {
  const map = new Map<string, string>();
  for (const [gics, industries] of Object.entries(GICS_SECTORS)) {
    for (const ind of industries) {
      map.set(ind.toLowerCase().trim(), gics);
    }
  }
  return map;
})();

export function gicsForIndustry(industry: string | null | undefined): string | null {
  if (!industry) return null;
  return INDUSTRY_TO_GICS.get(industry.toLowerCase().trim()) ?? null;
}

/** Expand a set of selected labels (mix of GICS + industries) to all industry labels covered. */
export function expandSelectedToIndustries(selected: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const item of selected) {
    if (GICS_SECTORS[item]) {
      for (const ind of GICS_SECTORS[item]) out.add(ind.toLowerCase().trim());
    } else {
      out.add(item.toLowerCase().trim());
    }
  }
  return out;
}
