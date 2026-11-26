import { useEffect, useState } from "react";
import { loadUniverseSectors } from "@/hooks/useUniverseSectors";

// ── Tickers mentioned in AI-written text ────────────────────────────────────────────
// Only symbols in the app's stock universe count, and short words that are also English or
// trading terms (A, IT, ON, NOW, EMA…) are skipped unless written as $TICKER or `TICKER`.
const AMBIGUOUS = new Set(["A", "I", "AI", "ALL", "ARE", "BE", "CAN", "FOR", "GO", "IT", "NOW", "ON", "ONE", "OR", "SO", "UP", "US", "TV", "BIG", "KEY", "LOW", "HIGH", "NEW", "OPEN", "REAL", "SEE", "TOP", "WELL", "ANY", "OUT", "RUN", "PLAY", "FAST", "FUN", "CASH", "EARN", "MAIN", "NEXT", "LIFE", "GOOD", "BEST", "EPS", "RS", "EMA", "ADR", "ATR", "SMA", "VWAP", "IPO", "CEO", "CFO", "ETF", "GDP", "CPI", "FED", "PE", "PS", "ROE", "ROIC", "USD", "YOY", "QOQ", "TTM", "SEC", "AM", "PM", "EST", "ET", "Q", "QQQ"]);
let universe: Promise<Set<string>> | null = null;
function knownSymbols(): Promise<Set<string>> {
  universe ??= loadUniverseSectors().then(({ rows, extra }) => new Set([...rows, ...extra].map((r) => r.symbol.toUpperCase()))).catch(() => { universe = null; return new Set<string>(); });
  return universe;
}
/** Tickers in the order they first appear in the text. */
export function tickersIn(text: string, known: Set<string>): string[] {
  const out: string[] = [], seen = new Set<string>();
  for (const m of text.matchAll(/(\$|`)?\b([A-Z]{1,5}(?:[.-][A-Z])?)\b`?/g)) {
    const sym = m[2], marked = !!m[1];
    if (seen.has(sym) || !known.has(sym) || (!marked && AMBIGUOUS.has(sym))) continue;
    seen.add(sym); out.push(sym);
  }
  return out;
}
export function useTickersIn(texts: string[]): string[] {
  const [known, setKnown] = useState<Set<string> | null>(null);
  useEffect(() => { let alive = true; void knownSymbols().then((s) => { if (alive) setKnown(s); }); return () => { alive = false; }; }, []);
  const joined = texts.join("\n");
  return known ? tickersIn(joined, known) : [];
}

