// ─── DATA MODEL ───────────────────────────────────────────────

export interface Ticker {
  symbol: string;
  pct: number;
  name?: string;
  skipped?: boolean;
  skipReason?: string;
}

export interface ThemeData {
  theme_name: string;
  performance_pct: number;
  up_count: number;
  down_count: number;
  na_count?: number;
  valid_count?: number;
  tickers: Ticker[];
  rank?: number;
  category?: "Strong" | "Neutral" | "Weak";
  notes?: string;
  dataSource?: "real" | "demo";
  lastUpdated?: string;
}

// ─── DEMO DATA ────────────────────────────────────────────────
// 60 themes, ~25 with realistic demo data, rest as placeholders

export const demoThemes: ThemeData[] = [
  {
    theme_name: "Fiber Optics & Connectivity",
    performance_pct: 12.34,
    up_count: 9,
    down_count: 2,
    tickers: [
      { symbol: "AAOI", pct: 22.56 },
      { symbol: "LITE", pct: 14.32 },
      { symbol: "COHR", pct: 11.87 },
      { symbol: "VIAV", pct: 9.45 },
      { symbol: "IIVI", pct: 7.21 },
      { symbol: "CIEN", pct: 5.64 },
    ],
    notes: "AI capex driving fiber demand",
    dataSource: "demo",
  },
  {
    theme_name: "AI Infrastructure / Data Centers",
    performance_pct: 9.87,
    up_count: 11,
    down_count: 3,
    tickers: [
      { symbol: "VRT", pct: 15.43 },
      { symbol: "EQIX", pct: 8.92 },
      { symbol: "DLR", pct: 7.34 },
      { symbol: "ANET", pct: 6.78 },
      { symbol: "PWSC", pct: 5.12 },
    ],
    notes: "Hyperscaler buildout accelerating",
    dataSource: "demo",
  },
  {
    theme_name: "GPU / AI Chips",
    performance_pct: 8.74,
    up_count: 7,
    down_count: 2,
    tickers: [
      { symbol: "NVDA", pct: 12.45 },
      { symbol: "AMD", pct: 8.34 },
      { symbol: "AVGO", pct: 6.21 },
      { symbol: "MRVL", pct: 4.87 },
      { symbol: "QCOM", pct: 3.12 },
    ],
    notes: "Blackwell shipments ramping",
    dataSource: "demo",
  },
  {
    theme_name: "Uranium & Nuclear Revival",
    performance_pct: 7.92,
    up_count: 8,
    down_count: 1,
    tickers: [
      { symbol: "CCJ", pct: 11.23 },
      { symbol: "LEU", pct: 9.87 },
      { symbol: "UEC", pct: 8.45 },
      { symbol: "NXE", pct: 6.34 },
      { symbol: "DNN", pct: 5.12 },
    ],
    notes: "SMR contracts signed",
    dataSource: "demo",
  },
  {
    theme_name: "Quantum Computing",
    performance_pct: 7.56,
    up_count: 5,
    down_count: 1,
    tickers: [
      { symbol: "IONQ", pct: 18.92 },
      { symbol: "RGTI", pct: 14.56 },
      { symbol: "QUBT", pct: 9.34 },
      { symbol: "QBTS", pct: 4.21 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Drone & Autonomous Systems",
    performance_pct: 6.43,
    up_count: 6,
    down_count: 2,
    tickers: [
      { symbol: "AVAV", pct: 9.87 },
      { symbol: "JOBY", pct: 8.12 },
      { symbol: "ACHR", pct: 6.45 },
      { symbol: "RKLB", pct: 5.34 },
    ],
    notes: "DoD contracts expanding",
    dataSource: "demo",
  },
  {
    theme_name: "Defense & Robotics",
    performance_pct: 5.89,
    up_count: 7,
    down_count: 3,
    tickers: [
      { symbol: "LMT", pct: 7.12 },
      { symbol: "RTX", pct: 5.87 },
      { symbol: "NOC", pct: 5.34 },
      { symbol: "LHX", pct: 4.56 },
      { symbol: "PLTR", pct: 3.89 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Space Economy",
    performance_pct: 5.67,
    up_count: 5,
    down_count: 2,
    tickers: [
      { symbol: "ASTS", pct: 8.74 },
      { symbol: "RKLB", pct: 7.45 },
      { symbol: "LUNR", pct: 6.12 },
      { symbol: "MNTS", pct: 3.45 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Optics & Photonics",
    performance_pct: 5.23,
    up_count: 6,
    down_count: 3,
    tickers: [
      { symbol: "COHR", pct: 9.12 },
      { symbol: "IIVI", pct: 6.34 },
      { symbol: "LITE", pct: 5.67 },
      { symbol: "MKSI", pct: 3.45 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Critical Minerals / Rare Earths",
    performance_pct: 4.87,
    up_count: 5,
    down_count: 2,
    tickers: [
      { symbol: "MP", pct: 8.34 },
      { symbol: "UUUU", pct: 6.78 },
      { symbol: "LAC", pct: 4.12 },
    ],
    notes: "China export restrictions",
    dataSource: "demo",
  },
  {
    theme_name: "Cybersecurity",
    performance_pct: 4.56,
    up_count: 8,
    down_count: 4,
    tickers: [
      { symbol: "CRWD", pct: 7.89 },
      { symbol: "PANW", pct: 5.67 },
      { symbol: "ZS", pct: 4.12 },
      { symbol: "FTNT", pct: 3.45 },
      { symbol: "S", pct: 2.89 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Copper & Base Metals",
    performance_pct: 4.12,
    up_count: 5,
    down_count: 3,
    tickers: [
      { symbol: "FCX", pct: 6.78 },
      { symbol: "SCCO", pct: 4.56 },
      { symbol: "TECK", pct: 3.12 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Semiconductors",
    performance_pct: 3.78,
    up_count: 10,
    down_count: 5,
    tickers: [
      { symbol: "TSM", pct: 6.45 },
      { symbol: "ASML", pct: 4.23 },
      { symbol: "KLAC", pct: 3.67 },
      { symbol: "LRCX", pct: 3.12 },
      { symbol: "AMAT", pct: 2.89 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Neoclouds / Hyperscale Cloud",
    performance_pct: 3.45,
    up_count: 4,
    down_count: 2,
    tickers: [
      { symbol: "CLSK", pct: 6.78 },
      { symbol: "COREWEAVE", pct: 5.34 },
      { symbol: "SMCI", pct: 2.12 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Thermal Management / Liquid Cooling",
    performance_pct: 3.21,
    up_count: 4,
    down_count: 2,
    tickers: [
      { symbol: "VRT", pct: 5.67 },
      { symbol: "GNRC", pct: 3.45 },
      { symbol: "LFUS", pct: 2.12 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Robotics & Industrial Automation",
    performance_pct: 2.89,
    up_count: 5,
    down_count: 3,
    tickers: [
      { symbol: "ISRG", pct: 4.56 },
      { symbol: "ROK", pct: 3.12 },
      { symbol: "TER", pct: 2.34 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Gold & Precious Metals",
    performance_pct: 2.45,
    up_count: 6,
    down_count: 3,
    tickers: [
      { symbol: "NEM", pct: 4.12 },
      { symbol: "GOLD", pct: 3.45 },
      { symbol: "AEM", pct: 2.89 },
      { symbol: "GFI", pct: 1.23 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "AI Software / Agents",
    performance_pct: 2.12,
    up_count: 5,
    down_count: 4,
    tickers: [
      { symbol: "PLTR", pct: 5.67 },
      { symbol: "AI", pct: 3.12 },
      { symbol: "PATH", pct: 1.45 },
      { symbol: "BBAI", pct: 0.89 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Energy Services & Nuclear",
    performance_pct: 1.87,
    up_count: 4,
    down_count: 3,
    tickers: [
      { symbol: "HAL", pct: 3.45 },
      { symbol: "SLB", pct: 2.12 },
      { symbol: "BKR", pct: 1.23 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Fintech & Digital Payments",
    performance_pct: 1.34,
    up_count: 5,
    down_count: 4,
    tickers: [
      { symbol: "SQ", pct: 3.12 },
      { symbol: "PYPL", pct: 2.45 },
      { symbol: "AFRM", pct: 1.23 },
      { symbol: "SOFI", pct: 0.67 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Semiconductor Equipment",
    performance_pct: 1.12,
    up_count: 4,
    down_count: 3,
    tickers: [
      { symbol: "ASML", pct: 2.89 },
      { symbol: "KLAC", pct: 1.45 },
      { symbol: "LRCX", pct: 0.87 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "SaaS & Cloud Software",
    performance_pct: 0.87,
    up_count: 6,
    down_count: 5,
    tickers: [
      { symbol: "NOW", pct: 2.34 },
      { symbol: "CRM", pct: 1.67 },
      { symbol: "SNOW", pct: 0.89 },
      { symbol: "DDOG", pct: 0.45 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Crypto & Blockchain",
    performance_pct: 0.56,
    up_count: 4,
    down_count: 4,
    tickers: [
      { symbol: "COIN", pct: 2.34 },
      { symbol: "MSTR", pct: 1.89 },
      { symbol: "MARA", pct: -1.23 },
      { symbol: "RIOT", pct: -2.45 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Memory & Storage",
    performance_pct: 0.34,
    up_count: 3,
    down_count: 3,
    tickers: [
      { symbol: "MU", pct: 1.56 },
      { symbol: "WDC", pct: 0.89 },
      { symbol: "STX", pct: -0.45 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Enterprise Software",
    performance_pct: 0.12,
    up_count: 4,
    down_count: 5,
    tickers: [
      { symbol: "ORCL", pct: 1.23 },
      { symbol: "SAP", pct: 0.67 },
      { symbol: "INTU", pct: -0.34 },
    ],
    dataSource: "demo",
  },
  // ─── WEAKER / LAGGING THEMES ─────────────────
  {
    theme_name: "Oil & Gas Exploration",
    performance_pct: -0.34,
    up_count: 3,
    down_count: 5,
    tickers: [
      { symbol: "XOM", pct: 0.45 },
      { symbol: "CVX", pct: -0.67 },
      { symbol: "COP", pct: -1.12 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Silver",
    performance_pct: -0.56,
    up_count: 2,
    down_count: 3,
    tickers: [
      { symbol: "PAAS", pct: 0.89 },
      { symbol: "AG", pct: -0.45 },
      { symbol: "SLV", pct: -1.23 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "LNG / Natural Gas",
    performance_pct: -0.89,
    up_count: 2,
    down_count: 4,
    tickers: [
      { symbol: "LNG", pct: 0.34 },
      { symbol: "AR", pct: -0.89 },
      { symbol: "EQT", pct: -1.45 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Shipping & Dry Bulk",
    performance_pct: -1.12,
    up_count: 2,
    down_count: 5,
    tickers: [
      { symbol: "GOGL", pct: 0.45 },
      { symbol: "ZIM", pct: -1.67 },
      { symbol: "DAC", pct: -2.12 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Traditional Retail",
    performance_pct: -1.45,
    up_count: 2,
    down_count: 6,
    tickers: [
      { symbol: "WMT", pct: 0.34 },
      { symbol: "TGT", pct: -1.89 },
      { symbol: "KSS", pct: -3.12 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Regional Banks",
    performance_pct: -1.78,
    up_count: 3,
    down_count: 7,
    tickers: [
      { symbol: "PACW", pct: -1.23 },
      { symbol: "WAL", pct: -2.34 },
      { symbol: "ZION", pct: -2.89 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Electric Vehicles & Battery",
    performance_pct: -2.12,
    up_count: 2,
    down_count: 6,
    tickers: [
      { symbol: "TSLA", pct: 0.56 },
      { symbol: "RIVN", pct: -2.34 },
      { symbol: "LCID", pct: -4.56 },
      { symbol: "NIO", pct: -3.89 },
    ],
    notes: "Tariff fears weigh on sector",
    dataSource: "demo",
  },
  {
    theme_name: "Cannabis & Psychedelics",
    performance_pct: -2.56,
    up_count: 1,
    down_count: 5,
    tickers: [
      { symbol: "TLRY", pct: -2.34 },
      { symbol: "CGC", pct: -3.56 },
      { symbol: "MSOS", pct: -1.89 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Solar Energy",
    performance_pct: -3.12,
    up_count: 1,
    down_count: 7,
    tickers: [
      { symbol: "ENPH", pct: -2.34 },
      { symbol: "SEDG", pct: -4.56 },
      { symbol: "FSLR", pct: -3.12 },
      { symbol: "RUN", pct: -2.89 },
    ],
    notes: "Policy uncertainty",
    dataSource: "demo",
  },
  {
    theme_name: "Commercial Real Estate",
    performance_pct: -3.45,
    up_count: 1,
    down_count: 8,
    tickers: [
      { symbol: "VNO", pct: -3.12 },
      { symbol: "SLG", pct: -4.23 },
      { symbol: "BXP", pct: -2.89 },
    ],
    dataSource: "demo",
  },
  {
    theme_name: "Wind Energy",
    performance_pct: -4.23,
    up_count: 0,
    down_count: 5,
    tickers: [
      { symbol: "VWDRY", pct: -4.56 },
      { symbol: "ORA", pct: -3.89 },
      { symbol: "NEP", pct: -5.12 },
    ],
    notes: "Offshore wind project cancellations",
    dataSource: "demo",
  },
  // ─── PLACEHOLDER THEMES (0% – fill with real data later) ───
  { theme_name: "Hypersonic & Missile Defense", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "Advanced Air Mobility / eVTOL", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "Steel & Iron Ore", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "Agriculture Commodities", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "Battery Metals / Lithium", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "Hydrogen & Clean Energy", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "Biotech & Genomics", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "GLP-1 / Obesity Drugs", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "Telemedicine", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "Airlines & Travel", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "Cruise Lines", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "Casinos & Gaming", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "Luxury Goods", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "DePIN / Decentralized Physical Infra", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "3D Printing / Additive Manufacturing", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "Robotics Process Automation (RPA)", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "Edge Computing", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "5G & Telecom Infrastructure", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "Water Infrastructure", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "Housing & Construction", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "Insurance", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "Traditional Media", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "Advertising & Marketing Tech", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
  { theme_name: "Electric Grid / Utilities", performance_pct: 0, up_count: 0, down_count: 0, tickers: [], dataSource: "demo" },
];

export function getProcessedThemes(themes: ThemeData[]): ThemeData[] {
  const sorted = [...themes].sort((a, b) => b.performance_pct - a.performance_pct);
  return sorted.map((t, i) => {
    // Recalculate up/down/na from tickers
    const validTickers = t.tickers.filter(tk => !tk.skipped);
    const naTickers = t.tickers.filter(tk => tk.skipped);
    const up_count = validTickers.filter(tk => tk.pct > 0).length;
    const down_count = validTickers.filter(tk => tk.pct <= 0).length;
    const na_count = naTickers.length;
    const valid_count = validTickers.length;

    // Recalculate performance from valid tickers only
    const performance_pct = validTickers.length > 0
      ? Math.round((validTickers.reduce((sum, tk) => sum + tk.pct, 0) / validTickers.length) * 100) / 100
      : t.performance_pct;

    return {
      ...t,
      rank: i + 1,
      category: performance_pct > 2 ? "Strong" : performance_pct >= 0 ? "Neutral" : "Weak",
      performance_pct,
      up_count: t.dataSource === "real" ? up_count : t.up_count,
      down_count: t.dataSource === "real" ? down_count : t.down_count,
      na_count,
      valid_count,
    };
  });
}
