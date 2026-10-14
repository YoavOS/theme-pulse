// ─────────────────────────────────────────────────────────────
// GICS-style taxonomy + provider-label normalization.
// PURE module (no imports) — an identical copy lives in
// supabase/functions/_shared/gicsTaxonomy.ts so the browser and the
// classification worker always agree on names. Edit both together.
// ─────────────────────────────────────────────────────────────

/** Sector → Industry → Sub-Industries (canonical GICS-style names). */
export const GICS: Record<string, Record<string, string[]>> = {
  "Energy": {
    "Energy Equipment & Services": ["Oil & Gas Drilling", "Oil & Gas Equipment & Services"],
    "Oil, Gas & Consumable Fuels": [
      "Integrated Oil & Gas", "Oil & Gas Exploration & Production", "Oil & Gas Refining & Marketing",
      "Oil & Gas Storage & Transportation", "Coal & Consumable Fuels", "Uranium",
    ],
  },
  "Materials": {
    "Chemicals": ["Commodity Chemicals", "Diversified Chemicals", "Fertilizers & Agricultural Chemicals", "Industrial Gases", "Specialty Chemicals"],
    "Construction Materials": ["Construction Materials"],
    "Containers & Packaging": ["Metal, Glass & Plastic Containers", "Paper & Plastic Packaging"],
    "Metals & Mining": ["Aluminum", "Diversified Metals & Mining", "Copper", "Gold", "Precious Metals & Minerals", "Silver", "Steel"],
    "Paper & Forest Products": ["Forest Products", "Paper Products"],
  },
  "Industrials": {
    "Aerospace & Defense": ["Aerospace & Defense"],
    "Building Products": ["Building Products"],
    "Construction & Engineering": ["Construction & Engineering"],
    "Electrical Equipment": ["Electrical Components & Equipment", "Heavy Electrical Equipment"],
    "Industrial Conglomerates": ["Industrial Conglomerates"],
    "Machinery": ["Construction Machinery & Heavy Trucks", "Agricultural & Farm Machinery", "Industrial Machinery & Components", "Tools & Accessories"],
    "Trading Companies & Distributors": ["Trading Companies & Distributors", "Rental & Leasing Services"],
    "Commercial Services & Supplies": ["Commercial Printing", "Environmental & Facilities Services", "Office Services & Supplies", "Diversified Support Services", "Security & Alarm Services"],
    "Professional Services": ["Human Resource & Employment Services", "Research & Consulting Services", "Data Processing & Outsourced Services"],
    "Air Freight & Logistics": ["Air Freight & Logistics"],
    "Passenger Airlines": ["Passenger Airlines"],
    "Marine Transportation": ["Marine Transportation"],
    "Ground Transportation": ["Rail Transportation", "Cargo Ground Transportation", "Passenger Ground Transportation"],
    "Transportation Infrastructure": ["Airport Services", "Highways & Railtracks", "Marine Ports & Services"],
  },
  "Consumer Discretionary": {
    "Automobile Components": ["Automotive Parts & Equipment", "Tires & Rubber"],
    "Automobiles": ["Automobile Manufacturers", "Motorcycle Manufacturers", "Recreational Vehicles"],
    "Household Durables": ["Consumer Electronics", "Home Furnishings", "Homebuilding", "Household Appliances", "Housewares & Specialties"],
    "Leisure Products": ["Leisure Products"],
    "Textiles, Apparel & Luxury Goods": ["Apparel, Accessories & Luxury Goods", "Footwear", "Textiles"],
    "Hotels, Restaurants & Leisure": ["Casinos & Gaming", "Hotels, Resorts & Cruise Lines", "Leisure Facilities", "Restaurants", "Travel Services"],
    "Diversified Consumer Services": ["Education Services", "Specialized Consumer Services"],
    "Distributors": ["Distributors"],
    "Broadline Retail": ["Broadline Retail", "Internet Retail"],
    "Specialty Retail": ["Apparel Retail", "Computer & Electronics Retail", "Home Improvement Retail", "Other Specialty Retail", "Automotive Retail", "Homefurnishing Retail"],
  },
  "Consumer Staples": {
    "Consumer Staples Distribution & Retail": ["Drug Retail", "Food Distributors", "Food Retail", "Consumer Staples Merchandise Retail"],
    "Beverages": ["Brewers", "Distillers & Vintners", "Soft Drinks & Non-alcoholic Beverages"],
    "Food Products": ["Agricultural Products & Services", "Packaged Foods & Meats", "Confectioners"],
    "Tobacco": ["Tobacco"],
    "Household Products": ["Household Products"],
    "Personal Care Products": ["Personal Care Products"],
  },
  "Health Care": {
    "Health Care Equipment & Supplies": ["Health Care Equipment", "Health Care Supplies"],
    "Health Care Providers & Services": ["Health Care Distributors", "Health Care Services", "Health Care Facilities", "Managed Health Care"],
    "Health Care Technology": ["Health Care Technology"],
    "Biotechnology": ["Biotechnology"],
    "Pharmaceuticals": ["Pharmaceuticals", "Specialty & Generic Pharmaceuticals"],
    "Life Sciences Tools & Services": ["Life Sciences Tools & Services", "Diagnostics & Research"],
  },
  "Financials": {
    "Banks": ["Diversified Banks", "Regional Banks"],
    "Financial Services": ["Diversified Financial Services", "Multi-Sector Holdings", "Specialized Finance", "Mortgage Finance", "Transaction & Payment Processing Services", "Shell Companies"],
    "Consumer Finance": ["Consumer Finance"],
    "Capital Markets": ["Asset Management & Custody Banks", "Investment Banking & Brokerage", "Diversified Capital Markets", "Financial Exchanges & Data"],
    "Mortgage REITs": ["Mortgage REITs"],
    "Insurance": ["Insurance Brokers", "Life & Health Insurance", "Multi-line Insurance", "Property & Casualty Insurance", "Reinsurance"],
  },
  "Information Technology": {
    "IT Services": ["IT Consulting & Other Services", "Internet Services & Infrastructure"],
    "Software": ["Application Software", "Systems Software"],
    "Communications Equipment": ["Communications Equipment"],
    "Technology Hardware, Storage & Peripherals": ["Technology Hardware, Storage & Peripherals"],
    "Electronic Equipment, Instruments & Components": ["Electronic Equipment & Instruments", "Electronic Components", "Electronic Manufacturing Services", "Technology Distributors"],
    "Semiconductors & Semiconductor Equipment": ["Semiconductors", "Semiconductor Materials & Equipment", "Solar"],
  },
  "Communication Services": {
    "Diversified Telecommunication Services": ["Alternative Carriers", "Integrated Telecommunication Services"],
    "Wireless Telecommunication Services": ["Wireless Telecommunication Services"],
    "Media": ["Advertising", "Broadcasting", "Cable & Satellite", "Publishing"],
    "Entertainment": ["Movies & Entertainment", "Interactive Home Entertainment"],
    "Interactive Media & Services": ["Interactive Media & Services"],
  },
  "Utilities": {
    "Electric Utilities": ["Electric Utilities"],
    "Gas Utilities": ["Gas Utilities"],
    "Multi-Utilities": ["Multi-Utilities"],
    "Water Utilities": ["Water Utilities"],
    "Independent Power & Renewable Electricity": ["Independent Power Producers & Energy Traders", "Renewable Electricity"],
  },
  "Real Estate": {
    "Equity REITs": [
      "Diversified REITs", "Industrial REITs", "Hotel & Resort REITs", "Office REITs", "Health Care REITs",
      "Residential REITs", "Retail REITs", "Data Center REITs", "Telecom Tower REITs", "Self-Storage REITs", "Other Specialized REITs",
    ],
    "Real Estate Management & Development": ["Real Estate Development", "Real Estate Services", "Diversified Real Estate Activities", "Real Estate Operating Companies"],
  },
};

export const norm = (v: string | null | undefined) =>
  (v ?? "")
    .toLowerCase()
    .replace(/[—–]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\band\b/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** Provider label (FMP / Yahoo / Finnhub / Alpha Vantage / legacy) → canonical sub-industry. */
const RAW_ALIASES: Record<string, string> = {
  // Energy
  "Oil & Gas Drilling": "Oil & Gas Drilling", "Oil & Gas E&P": "Oil & Gas Exploration & Production",
  "Oil & Gas Exploration & Production": "Oil & Gas Exploration & Production", "Oil & Gas Integrated": "Integrated Oil & Gas",
  "Oil & Gas Midstream": "Oil & Gas Storage & Transportation", "Oil & Gas Refining & Marketing": "Oil & Gas Refining & Marketing",
  "Oil & Gas Equipment & Services": "Oil & Gas Equipment & Services", "Oil & Gas Services": "Oil & Gas Equipment & Services",
  "Energy Equipment & Services": "Oil & Gas Equipment & Services", "Oil & Gas Energy": "Integrated Oil & Gas",
  "Oil, Gas & Consumable Fuels": "Oil & Gas Exploration & Production", "Oil & Gas": "Oil & Gas Exploration & Production",
  "Thermal Coal": "Coal & Consumable Fuels", "Coking Coal": "Coal & Consumable Fuels", "Coal": "Coal & Consumable Fuels", "Uranium": "Uranium",
  // Materials
  "Agricultural Inputs": "Fertilizers & Agricultural Chemicals", "Agricultural - Inputs": "Fertilizers & Agricultural Chemicals",
  "Agricultural Chemicals": "Fertilizers & Agricultural Chemicals", "Chemicals": "Diversified Chemicals",
  "Chemicals - Specialty": "Specialty Chemicals", "Building Materials": "Construction Materials", "Cement": "Construction Materials",
  "Lumber & Wood Production": "Forest Products", "Paper & Paper Products": "Paper Products", "Paper, Lumber & Forest Products": "Forest Products",
  "Paper & Forest": "Paper Products", "Paper & Forest Products": "Paper Products",
  "Other Industrial Metals & Mining": "Diversified Metals & Mining", "Industrial Materials": "Diversified Metals & Mining",
  "Metals & Mining": "Diversified Metals & Mining", "Other Precious Metals & Mining": "Precious Metals & Minerals",
  "Other Precious Metals": "Precious Metals & Minerals", "Packaging & Containers": "Metal, Glass & Plastic Containers",
  "Containers & Packaging": "Metal, Glass & Plastic Containers", "Packaging": "Paper & Plastic Packaging",
  // Industrials
  "Defense": "Aerospace & Defense", "Specialty Business Services": "Diversified Support Services",
  "Commercial Services & Supplies": "Diversified Support Services", "Consulting Services": "Research & Consulting Services",
  "Professional Services": "Research & Consulting Services", "Security & Protection Services": "Security & Alarm Services",
  "Staffing & Employment Services": "Human Resource & Employment Services", "Conglomerates": "Industrial Conglomerates",
  "Engineering & Construction": "Construction & Engineering", "Construction": "Construction & Engineering",
  "Infrastructure Operations": "Highways & Railtracks", "Industrial - Infrastructure Operations": "Highways & Railtracks",
  "Transportation Infrastructure": "Highways & Railtracks", "Building Products & Equipment": "Building Products", "Building": "Building Products",
  "Farm & Heavy Construction Machinery": "Construction Machinery & Heavy Trucks", "Agricultural - Machinery": "Agricultural & Farm Machinery",
  "Industrial Distribution": "Trading Companies & Distributors", "Industrial - Distribution": "Trading Companies & Distributors",
  "Business Equipment & Supplies": "Office Services & Supplies", "Specialty Industrial Machinery": "Industrial Machinery & Components",
  "Industrial - Machinery": "Industrial Machinery & Components", "Machinery": "Industrial Machinery & Components",
  "Industrial - Specialties": "Industrial Machinery & Components", "Industrial - Capital Goods": "Industrial Machinery & Components",
  "Metal Fabrication": "Industrial Machinery & Components", "Manufacturing - Metal Fabrication": "Industrial Machinery & Components",
  "Manufacturing - Tools & Accessories": "Tools & Accessories", "Pollution & Treatment Controls": "Environmental & Facilities Services",
  "Industrial - Pollution & Treatment Controls": "Environmental & Facilities Services", "Waste Management": "Environmental & Facilities Services",
  "Electrical Equipment & Parts": "Electrical Components & Equipment", "Electrical Equipment": "Electrical Components & Equipment",
  "Airports & Air Services": "Airport Services", "Airlines": "Passenger Airlines", "Airlines, Airports & Air Services": "Passenger Airlines",
  "Railroads": "Rail Transportation", "Road & Rail": "Rail Transportation", "Marine Shipping": "Marine Transportation", "Marine": "Marine Transportation",
  "Trucking": "Cargo Ground Transportation", "Integrated Freight & Logistics": "Air Freight & Logistics",
  "Logistics & Transportation": "Air Freight & Logistics", "Rental & Leasing Services": "Rental & Leasing Services",
  "Trading Companies & Distributors": "Trading Companies & Distributors",
  // Consumer Discretionary
  "Auto & Truck Dealerships": "Automotive Retail", "Auto - Dealerships": "Automotive Retail", "Auto Manufacturers": "Automobile Manufacturers",
  "Auto - Manufacturers": "Automobile Manufacturers", "Automobiles": "Automobile Manufacturers", "Auto Parts": "Automotive Parts & Equipment",
  "Auto - Parts": "Automotive Parts & Equipment", "Auto Components": "Automotive Parts & Equipment",
  "Auto - Recreational Vehicles": "Recreational Vehicles", "Furnishings, Fixtures & Appliances": "Home Furnishings", "Furnishings": "Home Furnishings",
  "Residential Construction": "Homebuilding", "Household Durables": "Housewares & Specialties", "Textile Manufacturing": "Textiles",
  "Manufacturing - Textiles": "Textiles", "Apparel Manufacturing": "Apparel, Accessories & Luxury Goods", "Apparel - Manufacturers": "Apparel, Accessories & Luxury Goods",
  "Luxury Goods": "Apparel, Accessories & Luxury Goods", "Textiles, Apparel & Luxury Goods": "Apparel, Accessories & Luxury Goods",
  "Footwear & Accessories": "Footwear", "Apparel - Footwear & Accessories": "Footwear", "Personal Services": "Specialized Consumer Services",
  "Diversified Consumer Services": "Specialized Consumer Services", "Apparel - Retail": "Apparel Retail", "Department Stores": "Broadline Retail",
  "Multiline Retail": "Broadline Retail", "Internet & Direct Marketing Retail": "Internet Retail", "Home Improvement": "Home Improvement Retail",
  "Specialty Retail": "Other Specialty Retail", "Retail": "Other Specialty Retail", "Gambling": "Casinos & Gaming",
  "Resorts & Casinos": "Casinos & Gaming", "Gambling, Resorts & Casinos": "Casinos & Gaming", "Gambling & Casinos": "Casinos & Gaming",
  "Leisure": "Leisure Facilities", "Lodging": "Hotels, Resorts & Cruise Lines", "Travel Lodging": "Hotels, Resorts & Cruise Lines",
  "Hotels, Restaurants & Leisure": "Restaurants", "Education & Training Services": "Education Services", "Education": "Education Services",
  // Consumer Staples
  "Beverages - Brewers": "Brewers", "Beverages - Wineries & Distilleries": "Distillers & Vintners", "Beverages - Alcoholic": "Distillers & Vintners",
  "Beverages - Non-Alcoholic": "Soft Drinks & Non-alcoholic Beverages", "Beverages": "Soft Drinks & Non-alcoholic Beverages",
  "Food Confectioners": "Confectioners", "Farm Products": "Agricultural Products & Services", "Agricultural Farm Products": "Agricultural Products & Services",
  "Packaged Foods": "Packaged Foods & Meats", "Food Products": "Packaged Foods & Meats", "Household & Personal Products": "Household Products",
  "Personal Products": "Personal Care Products", "Personal Products & Services": "Personal Care Products", "Consumer products": "Household Products",
  "Discount Stores": "Consumer Staples Merchandise Retail", "Food Distribution": "Food Distributors", "Grocery Stores": "Food Retail",
  "Food & Staples Retailing": "Food Retail", "Pharmaceutical Retailers": "Drug Retail",
  // Health Care
  "Drug Manufacturers - General": "Pharmaceuticals", "Drug Manufacturers - Specialty & Generic": "Specialty & Generic Pharmaceuticals",
  "Drug Manufacturers": "Pharmaceuticals", "Medical - Pharmaceuticals": "Pharmaceuticals", "Healthcare Plans": "Managed Health Care",
  "Medical - Healthcare Plans": "Managed Health Care", "Medical Care Facilities": "Health Care Facilities", "Medical - Care Facilities": "Health Care Facilities",
  "Health Information Services": "Health Care Technology", "Medical - Healthcare Information Services": "Health Care Technology",
  "Medical Devices": "Health Care Equipment", "Medical - Devices": "Health Care Equipment", "Medical - Equipment & Services": "Health Care Equipment",
  "Health Care Equipment & Supplies": "Health Care Equipment", "Medical Instruments & Supplies": "Health Care Supplies",
  "Medical - Instruments & Supplies": "Health Care Supplies", "Medical - Specialties": "Health Care Supplies",
  "Medical - Diagnostics & Research": "Diagnostics & Research", "Medical Distribution": "Health Care Distributors",
  "Medical - Distribution": "Health Care Distributors", "Health Care Providers & Services": "Health Care Services",
  // Financials
  "Banks - Diversified": "Diversified Banks", "Banks - Regional": "Regional Banks", "Banks": "Regional Banks", "Banking": "Regional Banks",
  "Thrifts & Mortgage Finance": "Mortgage Finance", "Financial - Mortgages": "Mortgage Finance", "Asset Management": "Asset Management & Custody Banks",
  "Asset Management - Global": "Asset Management & Custody Banks", "Asset Management - Income": "Asset Management & Custody Banks",
  "Asset Management - Bonds": "Asset Management & Custody Banks", "Asset Management - Leveraged": "Asset Management & Custody Banks",
  "Asset Management - Cryptocurrency": "Asset Management & Custody Banks", "Capital Markets": "Investment Banking & Brokerage",
  "Financial - Capital Markets": "Investment Banking & Brokerage", "Financial Data & Stock Exchanges": "Financial Exchanges & Data",
  "Financial - Data & Stock Exchanges": "Financial Exchanges & Data", "Insurance - Life": "Life & Health Insurance",
  "Insurance - Property & Casualty": "Property & Casualty Insurance", "Insurance - Reinsurance": "Reinsurance",
  "Insurance - Specialty": "Property & Casualty Insurance", "Insurance - Diversified": "Multi-line Insurance", "Insurance": "Property & Casualty Insurance",
  "Financial Conglomerates": "Multi-Sector Holdings", "Financial - Conglomerates": "Multi-Sector Holdings",
  "Financial - Diversified": "Diversified Financial Services", "Diversified Financial Services": "Diversified Financial Services",
  "Credit Services": "Consumer Finance", "Financial - Credit Services": "Consumer Finance",
  "Mortgage Real Estate Investment Trusts (REITs)": "Mortgage REITs", "REIT - Mortgage": "Mortgage REITs",
  // Technology
  "Information Technology Services": "IT Consulting & Other Services", "IT Services": "IT Consulting & Other Services",
  "Software - Application": "Application Software", "Software - Services": "Application Software", "Software - Infrastructure": "Systems Software",
  "Software": "Application Software", "Communication Equipment": "Communications Equipment", "Computer Hardware": "Technology Hardware, Storage & Peripherals",
  "Hardware, Equipment & Parts": "Electronic Components", "Electronic Equipment, Instruments & Components": "Electronic Components",
  "Electronics & Computer Distribution": "Technology Distributors", "Scientific & Technical Instruments": "Electronic Equipment & Instruments",
  "Semiconductor Equipment & Materials": "Semiconductor Materials & Equipment", "Semiconductors & Semiconductor Equipment": "Semiconductors",
  // Communication
  "Telecom Services": "Integrated Telecommunication Services", "Telecommunications Services": "Integrated Telecommunication Services",
  "Telecommunication": "Integrated Telecommunication Services", "Communications": "Integrated Telecommunication Services",
  "Diversified Telecommunication Services": "Integrated Telecommunication Services", "Advertising Agencies": "Advertising",
  "Entertainment": "Movies & Entertainment", "Media & Entertainment": "Movies & Entertainment", "Media": "Movies & Entertainment",
  "Internet Content & Information": "Interactive Media & Services", "Electronic Gaming & Multimedia": "Interactive Home Entertainment",
  // Utilities
  "Utilities - Independent Power Producers": "Independent Power Producers & Energy Traders", "Independent Power Producers": "Independent Power Producers & Energy Traders",
  "Independent Power and Renewable Electricity Producers": "Renewable Electricity", "Utilities - Renewable": "Renewable Electricity",
  "Renewable Utilities": "Renewable Electricity", "Renewable Energy": "Renewable Electricity",
  "Utilities - Regulated Water": "Water Utilities", "Regulated Water": "Water Utilities", "Utilities - Regulated Electric": "Electric Utilities",
  "Regulated Electric": "Electric Utilities", "Utilities - Regulated Gas": "Gas Utilities", "Regulated Gas": "Gas Utilities",
  "Utilities - Diversified": "Multi-Utilities", "Diversified Utilities": "Multi-Utilities", "General Utilities": "Multi-Utilities",
  // Real Estate
  "Real Estate - Development": "Real Estate Development", "Real Estate - Services": "Real Estate Services",
  "Real Estate - Diversified": "Diversified Real Estate Activities", "Real Estate Management & Development": "Real Estate Operating Companies",
  "REIT - Healthcare Facilities": "Health Care REITs", "REIT - Hotel & Motel": "Hotel & Resort REITs", "REIT - Industrial": "Industrial REITs",
  "REIT - Office": "Office REITs", "REIT - Residential": "Residential REITs", "REIT - Retail": "Retail REITs",
  "REIT - Specialty": "Other Specialized REITs", "REIT - Diversified": "Diversified REITs", "REIT": "Diversified REITs",
  "Equity Real Estate Investment Trusts (REITs)": "Diversified REITs",
};

/** Labels too broad to trust — keep them, but let deeper sources improve them. */
const BROAD_LABELS = new Set([
  "technology", "financial services", "health care", "healthcare", "retail", "energy", "industrials", "materials",
  "utilities", "real estate", "consumer products", "communications", "telecommunication", "media", "insurance",
  "consumer cyclical", "consumer defensive", "basic materials", "communication services", "financial", "n/a", "",
]);

/** Keyword fallback for free-form labels (Alpha Vantage SIC text, odd provider strings). */
const KEYWORD_RULES: [RegExp, string][] = [
  [/semiconductor equip|wafer/, "Semiconductor Materials & Equipment"],
  [/semiconductor|integrated circuit|chip/, "Semiconductors"],
  [/prepackaged software|software/, "Application Software"],
  [/computer programming|data processing|computer integrated|it consult|information technology/, "IT Consulting & Other Services"],
  [/computer (peripheral|storage|terminal|communication)|electronic computers/, "Technology Hardware, Storage & Peripherals"],
  [/telephone|radiotelephone|wireless/, "Wireless Telecommunication Services"],
  [/telecom|communications services/, "Integrated Telecommunication Services"],
  [/cable|satellite/, "Cable & Satellite"],
  [/biolog|biotech|in vitro/, "Biotechnology"],
  [/pharma|medicinal|drug/, "Pharmaceuticals"],
  [/surgical|medical instrument|dental|ophthalmic|orthopedic|x-ray|electromedical|medical device/, "Health Care Equipment"],
  [/hospital|nursing|health services|medical labor/, "Health Care Facilities"],
  [/hospital & medical service plans|managed care/, "Managed Health Care"],
  [/mortgage reit|reit.*mortgage/, "Mortgage REITs"],
  [/real estate investment trust|\breit/, "Other Specialized REITs"],
  [/real estate/, "Real Estate Services"],
  [/national commercial bank|state commercial bank|savings institution|bank/, "Regional Banks"],
  [/insurance/, "Property & Casualty Insurance"],
  [/security brokers|investment bank|broker/, "Investment Banking & Brokerage"],
  [/investment advice|asset manag/, "Asset Management & Custody Banks"],
  [/credit|loan|finance/, "Consumer Finance"],
  [/crude petroleum|natural gas|oil & gas|oil and gas/, "Oil & Gas Exploration & Production"],
  [/drilling/, "Oil & Gas Drilling"],
  [/petroleum refin/, "Oil & Gas Refining & Marketing"],
  [/pipeline/, "Oil & Gas Storage & Transportation"],
  [/coal/, "Coal & Consumable Fuels"],
  [/gold|silver ore/, "Gold"],
  [/mining|metal ores/, "Diversified Metals & Mining"],
  [/steel|blast furnace/, "Steel"],
  [/chemical|plastic material/, "Specialty Chemicals"],
  [/aircraft|aerospace|guided missile|defense|ordnance/, "Aerospace & Defense"],
  [/electric services|electric util/, "Electric Utilities"],
  [/gas distribution|natural gas transmis/, "Gas Utilities"],
  [/water supply/, "Water Utilities"],
  [/solar|renewable/, "Renewable Electricity"],
  [/motor vehicle parts|auto parts/, "Automotive Parts & Equipment"],
  [/motor vehicle|automobile/, "Automobile Manufacturers"],
  [/restaurant|eating places/, "Restaurants"],
  [/hotel|motel|cruise/, "Hotels, Resorts & Cruise Lines"],
  [/casino|gaming|gambling/, "Casinos & Gaming"],
  [/catalog|mail-order|internet retail|e-commerce/, "Internet Retail"],
  [/retail/, "Other Specialty Retail"],
  [/apparel|footwear/, "Apparel, Accessories & Luxury Goods"],
  [/beverage|bottled/, "Soft Drinks & Non-alcoholic Beverages"],
  [/food/, "Packaged Foods & Meats"],
  [/airline|air transport/, "Passenger Airlines"],
  [/trucking|motor freight/, "Cargo Ground Transportation"],
  [/railroad/, "Rail Transportation"],
  [/shipping|water transport/, "Marine Transportation"],
  [/construction machinery|farm machinery/, "Construction Machinery & Heavy Trucks"],
  [/machinery|industrial instrument/, "Industrial Machinery & Components"],
  [/electrical|electronic component|printed circuit/, "Electronic Components"],
  [/instrument|measuring/, "Electronic Equipment & Instruments"],
  [/construction|engineering services/, "Construction & Engineering"],
  [/advertis/, "Advertising"],
  [/motion picture|entertainment/, "Movies & Entertainment"],
  [/television|radio broadcast/, "Broadcasting"],
  [/newspaper|publishing|periodicals/, "Publishing"],
  [/business services|services-management/, "Diversified Support Services"],
  [/blank check|shell/, "Shell Companies"],
];

export interface Classification {
  sector: string;
  industry: string;
  subIndustry: string;
}

const SUB_TO_NODE = (() => {
  const m = new Map<string, { sector: string; industry: string; sub: string }>();
  for (const [sector, inds] of Object.entries(GICS))
    for (const [industry, subs] of Object.entries(inds))
      for (const sub of subs) m.set(norm(sub), { sector, industry, sub });
  return m;
})();

const INDUSTRY_TO_NODE = (() => {
  const m = new Map<string, { sector: string; industry: string }>();
  for (const [sector, inds] of Object.entries(GICS))
    for (const industry of Object.keys(inds)) m.set(norm(industry), { sector, industry });
  return m;
})();

const ALIASES = (() => {
  const m = new Map<string, string>();
  for (const [k, v] of Object.entries(RAW_ALIASES)) m.set(norm(k), v);
  return m;
})();

export const ALL_SUB_INDUSTRIES = [...SUB_TO_NODE.values()].map(n => n.sub);

export type MatchQuality = "exact" | "fuzzy" | "broad" | "none";

/** Resolve any provider label to a canonical sub-industry and say how confident we are. */
export function resolveSubIndustry(raw: string | null | undefined): { sub: string | null; quality: MatchQuality } {
  const key = norm(raw);
  if (!key) return { sub: null, quality: "none" };
  const direct = SUB_TO_NODE.get(key);
  if (direct) return { sub: direct.sub, quality: BROAD_LABELS.has(key) ? "broad" : "exact" };
  const alias = ALIASES.get(key);
  if (alias) return { sub: alias, quality: BROAD_LABELS.has(key) ? "broad" : "exact" };
  if (BROAD_LABELS.has(key)) return { sub: null, quality: "broad" };
  for (const [re, sub] of KEYWORD_RULES) if (re.test(key)) return { sub, quality: "fuzzy" };
  return { sub: null, quality: "none" };
}

/** Full Sector → Industry → Sub-Industry chain for any label. */
export function classifyLabel(raw: string | null | undefined): Classification {
  const label = (raw ?? "").trim();
  if (!label) return { sector: "Unknown", industry: "Unknown", subIndustry: "Unknown" };
  const ind = INDUSTRY_TO_NODE.get(norm(label));
  const r = resolveSubIndustry(label);
  if (r.sub) {
    const n = SUB_TO_NODE.get(norm(r.sub))!;
    return { sector: n.sector, industry: n.industry, subIndustry: n.sub };
  }
  if (ind) return { sector: ind.sector, industry: ind.industry, subIndustry: ind.industry };
  if (GICS[label]) return { sector: label, industry: "Other", subIndustry: "Other" };
  return { sector: "Other", industry: "Other", subIndustry: "Other" };
}

/** Every provider label that resolves into a given sub-industry (for filters). */
export function labelsForSub(sub: string): string[] {
  const out = [norm(sub)];
  for (const [k, v] of ALIASES) if (v === sub) out.push(k);
  return out;
}
