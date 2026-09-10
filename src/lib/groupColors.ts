// ─────────────────────────────────────────────────────────────
// App-wide color system for Sector / Industry / Sub-Industry / Theme grouping.
//
// Rule: every GICS Sector owns one hue family. Industries and
// sub-industries under that sector get deterministic shades of the
// same hue (lightness + saturation steps), so the same group always
// renders with the same color everywhere in the app.
// ─────────────────────────────────────────────────────────────

import {
  SECTOR_HIERARCHY,
  ALL_GICS_SECTORS,
  INDUSTRIES_BY_SECTOR,
  classifyIndustry,
} from "@/lib/sectorTaxonomy";

/** Base hue per GICS sector (deliberately spread across the wheel). */
export const SECTOR_HUES: Record<string, number> = {
  "Information Technology": 200,   // blue
  "Communication Services": 260,   // indigo/violet
  "Health Care": 160,              // teal/green
  "Financials": 220,               // steel blue
  "Consumer Discretionary": 30,    // orange
  "Consumer Staples": 100,         // olive/green
  "Industrials": 45,               // amber
  "Energy": 15,                    // red-orange
  "Materials": 320,                // magenta
  "Utilities": 185,                // cyan
  "Real Estate": 285,              // purple
  "Other": 0,                      // gray handled via saturation
  "Unknown": 0,
};

const SECTOR_SAT: Record<string, number> = { Other: 0, Unknown: 0 };

const norm = (v: string | null | undefined) => (v ?? "").toLowerCase().trim();

/** Stable index of a mid-level industry within its sector. */
const INDUSTRY_INDEX = (() => {
  const map = new Map<string, { sector: string; index: number; total: number }>();
  for (const sector of ALL_GICS_SECTORS) {
    const list = INDUSTRIES_BY_SECTOR[sector];
    list.forEach((ind, i) => map.set(norm(ind), { sector, index: i, total: list.length }));
  }
  return map;
})();

/** Stable index of a raw sub-industry label within its sector. */
const SUB_INDUSTRY_INDEX = (() => {
  const map = new Map<string, { sector: string; index: number; total: number }>();
  for (const sector of ALL_GICS_SECTORS) {
    const labels = Object.values(SECTOR_HIERARCHY[sector]).flat();
    labels.forEach((l, i) => {
      if (!map.has(norm(l))) map.set(norm(l), { sector, index: i, total: labels.length });
    });
  }
  return map;
})();

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Color for a broad GICS sector. */
export function colorForSector(sector: string | null | undefined): string {
  const key = (sector ?? "").trim();
  if (!key) return "hsl(0, 0%, 40%)";
  const hue = SECTOR_HUES[key];
  if (hue === undefined) {
    return `hsl(${hashString(key) % 360}, 25%, 50%)`;
  }
  const sat = SECTOR_SAT[key] ?? 72;
  return `hsl(${hue}, ${sat}%, ${sat === 0 ? 45 : 52}%)`;
}

function shade(meta: { sector: string; index: number; total: number }, spread: [number, number]) {
  const hue = SECTOR_HUES[meta.sector] ?? hashString(meta.sector) % 360;
  const span = Math.max(1, meta.total - 1);
  const t = meta.index / span;
  const light = spread[0] + t * spread[1];
  const sat = 78 - t * 26;
  const hueShift = (meta.index % 3) * 4 - 4;
  return `hsl(${hue + hueShift}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%)`;
}

/**
 * Color for a mid-level industry — a shade of its parent sector's hue.
 * Accepts either an industry name or a raw provider label.
 */
export function colorForIndustry(industry: string | null | undefined): string {
  const key = (industry ?? "").trim();
  if (!key) return "hsl(0, 0%, 40%)";
  const meta = INDUSTRY_INDEX.get(norm(key));
  if (meta) return shade(meta, [38, 30]);

  const cls = classifyIndustry(key);
  const viaParent = INDUSTRY_INDEX.get(norm(cls.industry));
  if (viaParent) return shade(viaParent, [38, 30]);
  if (SECTOR_HUES[cls.sector] !== undefined && cls.sector !== "Other") return colorForSector(cls.sector);
  return `hsl(${hashString(key) % 360}, 22%, 48%)`;
}

/** Color for a granular sub-industry — a lighter shade inside the sector family. */
export function colorForSubIndustry(sub: string | null | undefined): string {
  const key = (sub ?? "").trim();
  if (!key) return "hsl(0, 0%, 40%)";
  const meta = SUB_INDUSTRY_INDEX.get(norm(key));
  if (meta) return shade(meta, [34, 38]);
  return colorForIndustry(key);
}

/** Stable, distinct color for a custom theme name (not sector-derived). */
export function colorForTheme(name: string | null | undefined): string {
  const key = (name ?? "").trim();
  if (!key) return "hsl(0, 0%, 40%)";
  const h = hashString(key);
  return `hsl(${h % 360}, ${60 + (h % 3) * 8}%, ${50 + ((h >> 3) % 3) * 6}%)`;
}

export type GroupMode = "theme" | "industry" | "sector" | "subIndustry";

/** One entry point used by every chart in the app. */
export function colorForGroup(name: string | null | undefined, mode: GroupMode): string {
  const key = (name ?? "").trim();
  if (!key || key === "Unassigned" || key === "Unknown") return "hsl(0, 0%, 40%)";
  if (key === "Other" || key === "Other themes") return "hsl(0, 0%, 52%)";
  if (mode === "sector") return colorForSector(key);
  if (mode === "industry") return colorForIndustry(key);
  if (mode === "subIndustry") return colorForSubIndustry(key);
  return colorForTheme(key);
}

export const GROUP_MODE_LABEL: Record<GroupMode, string> = {
  theme: "Theme",
  industry: "Industry",
  sector: "Sector",
  subIndustry: "Sub-Industry",
};

export const ALL_GROUP_MODES: GroupMode[] = ["theme", "industry", "sector", "subIndustry"];

/**
 * Single source of truth for turning a stock's raw provider industry label
 * into the bucket name for the active grouping mode.
 */
export function groupKeyForIndustry(raw: string | null | undefined, mode: GroupMode): string {
  const cls = classifyIndustry(raw);
  if (mode === "sector") return cls.sector;
  if (mode === "industry") return cls.industry;
  if (mode === "subIndustry") return cls.subIndustry;
  return cls.industry;
}
