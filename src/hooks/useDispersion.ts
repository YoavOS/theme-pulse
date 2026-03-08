import { useMemo } from "react";
import { ThemeData } from "@/data/themeData";

export interface DispersionResult {
  score: number;
  label: string;
  color: string;
  tooltip: string;
}

export function calculateDispersion(performances: number[]): number {
  if (performances.length < 2) return 0;
  const mean = performances.reduce((a, b) => a + b, 0) / performances.length;
  const variance = performances.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / performances.length;
  return Math.round(Math.sqrt(variance) * 100) / 100;
}

export function getDispersionLabel(score: number): string {
  if (score > 3.0) return "Very High — stock picker's market";
  if (score >= 2.0) return "High — rotation day";
  if (score >= 1.0) return "Moderate — mixed conditions";
  if (score >= 0.5) return "Low — themes moving together";
  return "Very Low — macro-driven";
}

export function getDispersionShortLabel(score: number): string {
  if (score > 3.0) return "Very High";
  if (score >= 2.0) return "High";
  if (score >= 1.0) return "Moderate";
  if (score >= 0.5) return "Low";
  return "Very Low";
}

export function getDispersionColor(score: number): string {
  if (score >= 2.0) return "hsl(174, 80%, 50%)"; // teal
  if (score >= 1.0) return "hsl(var(--muted-foreground))";
  return "hsl(40, 80%, 50%)"; // amber
}

export function getDispersionColorClass(score: number): { border: string; bg: string; text: string } {
  if (score >= 2.0) return { border: "border-[hsl(174,80%,50%)]/30", bg: "bg-[hsl(174,80%,50%)]/10", text: "text-[hsl(174,80%,50%)]" };
  if (score >= 1.0) return { border: "border-border", bg: "bg-secondary/50", text: "text-muted-foreground" };
  return { border: "border-[hsl(40,80%,50%)]/30", bg: "bg-[hsl(40,80%,50%)]/10", text: "text-[hsl(40,80%,50%)]" };
}

export function useDispersion(themes: ThemeData[]): DispersionResult | null {
  return useMemo(() => {
    const performances = themes
      .filter(t => t.tickers.length > 0 || t.up_count > 0 || t.down_count > 0)
      .map(t => t.performance_pct);

    if (performances.length < 3) return null;

    const score = calculateDispersion(performances);
    return {
      score,
      label: getDispersionLabel(score),
      color: getDispersionColor(score),
      tooltip: "Measures how spread out theme performances are today. High = clear winners and losers. Low = everything moving together.",
    };
  }, [themes]);
}
