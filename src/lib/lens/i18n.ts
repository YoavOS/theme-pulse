import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

/**
 * Language of the Fundamentals tab (Lens + Damodaran's ideas): English or Hebrew.
 * Kept in this browser; every component that shows Lens text re-renders when it changes.
 */
export type LensLang = "en" | "he";
const KEY = "lens-lang";
const listeners = new Set<() => void>();
let current: LensLang = (() => { try { return localStorage.getItem(KEY) === "he" ? "he" : "en"; } catch { return "en"; } })();

export function getLensLang(): LensLang { return current; }
export function setLensLang(l: LensLang) {
  current = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  listeners.forEach((f) => f());
}
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
/** The saved setting itself (for the language switch and the tab's own wrapper). */
export function useLensLangSetting(): LensLang {
  return useSyncExternalStore(subscribe, getLensLang, getLensLang);
}
/** True inside the Fundamentals tab (Lens + Damodaran's ideas). Pieces shared with other tabs — the
 *  Proven badge, glossary terms — stay English elsewhere in the app. */
export const LensScope = createContext(false);
/** The language to render in: the setting inside the Fundamentals tab, English everywhere else. */
export function useLensLang(): LensLang {
  const lang = useLensLangSetting();
  return useContext(LensScope) ? lang : "en";
}
/** `tx("English", "עברית")` — the string for the current language. */
export function useTx() {
  const lang = useLensLang();
  return useCallback(<T,>(en: T, he: T): T => (lang === "he" ? he : en), [lang]);
}
export const dirOf = (l: LensLang) => (l === "he" ? "rtl" : "ltr");

// ── Bidi helpers for Hebrew text that carries numbers, tickers and formulas ──────────────
const LRI = "⁦", PDI = "⁩";
/** Keep a left-to-right piece (a number, a ticker, a formula) intact inside Hebrew text. */
export const ltr = (s: string | number | null | undefined) => (s === null || s === undefined || s === "" ? "" : `${LRI}${s}${PDI}`);
/** Wrap every number-like run (signs, $, %, ×, units, ranges) so RTL text doesn't flip "−5%" into "%5−". */
const NUM_RUN = /(?:(?<=^|[\s(:"'׳])[−+\-–])?\$?(?<![\d.,])\d[\d.,]*(?:\s?(?:%|×|x|pp|B|M|T|K|bps))?(?:\s?[–-]\s?\d[\d.,]*(?:\s?%)?)?(?:\/(?:yr|שנה))?/g;
export function isoNums(s: string): string {
  if (!s || !/\d/.test(s)) return s;
  return s.replace(NUM_RUN, (m) => (m.includes(LRI) ? m : `${LRI}${m}${PDI}`));
}
