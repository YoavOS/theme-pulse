import { createContext } from "react";

/**
 * Optional company context for glossary popovers: given a glossary entry id, the "For SYMBOL" lines
 * that put the company's own number into plain words and compare it with its industry (the Lens provides it).
 */
export const TermCompanyContext = createContext<((entryId: string) => { symbol: string; lines: string[] } | null) | null>(null);
