// ─────────────────────────────────────────────────────────────
// App-wide color system for Sector / Industry / Theme grouping.
//
// Rule: every GICS Sector owns one hue family. Industries that
// belong to that sector get deterministic shades of the same hue
// (lightness + saturation steps), so the same industry always
// renders with the same color everywhere in the app.
// ─────────────────────────────────────────────────────────────

import { GICS_SECTORS, ALL_GICS_SECTORS, gicsForIndustry } from "@/lib/sectorTaxonomy";

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

/** Stable index of an industry within its sector's industry list. */
const INDUSTRY_INDEX = (() => {
  const map = new Map<string, { sector: string; index: number; total: number }>();
  for (const sector of ALL_GICS_SECTORS) {
    const list = GICS_SECTORS[sector];
    list.forEach((ind, i) => {
      map.set(norm(ind), { sector, index: i, total: list.length });
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
    // Unmapped label — derive a stable hue but keep it desaturated so it
    // never competes visually with a real sector family.
    return `hsl(${hashString(key) % 360}, 25%, 50%)`;
  }
  const sat = SECTOR_SAT[key] ?? 72;
  return `hsl(${hue}, ${sat}%, ${sat === 0 ? 45 : 52}%)`;
}

/**
 * Color for a granular industry — a shade of its parent sector's hue.
 * Unmapped industries fall back to a stable neutral shade.
 */
export function colorForIndustry(industry: string | null | undefined): string {
  const key = (industry ?? "").trim();
  if (!key) return "hsl(0, 0%, 40%)";

  const meta = INDUSTRY_INDEX.get(norm(key));
  if (!meta) {
    const parent = gicsForIndustry(key);
    if (parent) return colorForSector(parent);
    return `hsl(${hashString(key) % 360}, 22%, 48%)`;
  }

  const hue = SECTOR_HUES[meta.sector] ?? hashString(meta.sector) % 360;
  const span = Math.max(1, meta.total - 1);
  const t = meta.index / span;                 // 0..1 within the family
  const light = 38 + t * 30;                   // 38% → 68%
  const sat = 78 - t * 26;                     // 78% → 52%
  const hueShift = (meta.index % 3) * 4 - 4;   // ±4° so neighbours stay distinct
  return `hsl(${hue + hueShift}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%)`;
}

/** Stable, distinct color for a custom theme name (not sector-derived). */
export function colorForTheme(name: string | null | undefined): string {
  const key = (name ?? "").trim();
  if (!key) return "hsl(0, 0%, 40%)";
  const h = hashString(key);
  return `hsl(${h % 360}, ${60 + (h % 3) * 8}%, ${50 + ((h >> 3) % 3) * 6}%)`;
}

export type GroupMode = "theme" | "industry" | "sector";

/** One entry point used by every chart in the app. */
export function colorForGroup(name: string | null | undefined, mode: GroupMode): string {
  const key = (name ?? "").trim();
  if (!key || key === "Unassigned" || key === "Unknown") return "hsl(0, 0%, 40%)";
  if (key === "Other" || key === "Other themes") return "hsl(0, 0%, 52%)";
  if (mode === "sector") return colorForSector(key);
  if (mode === "industry") return colorForIndustry(key);
  return colorForTheme(key);
}

export const GROUP_MODE_LABEL: Record<GroupMode, string> = {
  theme: "Theme",
  industry: "Industry",
  sector: "Sector",
};
