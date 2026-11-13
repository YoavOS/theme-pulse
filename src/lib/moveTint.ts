import type { CSSProperties } from "react";

/**
 * Deepvue's box concept: a box takes the color of what it shows — blue when it shows a gain /
 * something good, pink for a loss / something bad, gold for caution — so the page reads at a
 * glance before any number is read. Light fill + matching border; stronger for bigger moves.
 */

export type Tone = "good" | "bad" | "warn" | "neutral";

const HSL: Record<Exclude<Tone, "neutral">, string> = {
  good: "var(--up)",
  bad: "var(--down)",
  warn: "var(--warn)",
};

/** Fill + border for a box with this tone. `strength` 0–1 (default 0.5) scales the tint. */
export function toneBox(tone: Tone, strength = 0.5): CSSProperties {
  if (tone === "neutral") return {};
  const s = Math.max(0, Math.min(1, strength));
  const c = HSL[tone];
  return { background: `hsl(${c} / ${(0.05 + 0.11 * s).toFixed(3)})`, borderColor: `hsl(${c} / ${(0.22 + 0.38 * s).toFixed(3)})` };
}

/** Text color class for a tone. */
export function toneText(tone: Tone): string {
  return tone === "good" ? "text-up" : tone === "bad" ? "text-down" : tone === "warn" ? "text-warn" : "text-muted-foreground";
}

/** Tone of a signed move; |v| < flat counts as neutral. */
export function toneOf(v: number | null | undefined, flat = 0): Tone {
  if (v === null || v === undefined || !Number.isFinite(v) || Math.abs(v) <= flat) return "neutral";
  return v > 0 ? "good" : "bad";
}

/** Box style for a signed move: direction picks the color, |v| / scale the strength. */
export function moveBox(v: number | null | undefined, scale = 5, flat = 0): CSSProperties {
  const t = toneOf(v, flat);
  return t === "neutral" ? {} : toneBox(t, Math.min(1, Math.abs(v as number) / (scale || 1)));
}

/** Tone implied by an existing text-color class (for boxes whose value is already colored). */
export function toneFromClass(cls: string | null | undefined): Tone {
  const c = cls ?? "";
  if (/gain|hsl\(222|text-up\b|text-primary|#5b8def|#6f9ff5|#7aa4f2/.test(c)) return "good";
  if (/loss|destructive|hsl\(33[05]|text-down\b|#e0559b/.test(c)) return "bad";
  if (/hsl\((3[5-9]|4[0-9]|5[0-2]),|amber|yellow|text-warn\b|#facc15|#f5a623|#f59e0b/.test(c)) return "warn";
  return "neutral";
}
