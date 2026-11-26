import { createContext, useContext } from "react";

/** Opens the all-terms browser, optionally at one entry. Null outside a <GlossaryProvider>. */
export const GlossaryOpenContext = createContext<((id?: string) => void) | null>(null);
export const useOpenGlossary = () => useContext(GlossaryOpenContext);
