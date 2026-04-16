import { ReactNode, useEffect, useRef, useState, createContext, useContext, useCallback, useMemo } from "react";
import { ChevronDown } from "lucide-react";

/* ─────────── Page-level controller ─────────── */

type Ctx = {
  // Section-level (large cards)
  registerSection: (id: string, defaultOpen: boolean) => void;
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  count: number;

  // Theme-row-level (per-theme ticker drill-downs)
  registerThemeRow: (id: string) => void;
  isThemeRowOpen: (id: string) => boolean;
  toggleThemeRow: (id: string) => void;
  expandAllThemeRows: () => void;
  collapseAllThemeRows: () => void;
  themeRowCount: number;
};

const CollapsibleCtx = createContext<Ctx | null>(null);

export function CollapsibleProvider({
  children,
  storageKey,
}: {
  children: ReactNode;
  storageKey: string;
}) {
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [themeRowMap, setThemeRowMap] = useState<Record<string, boolean>>({});
  const known = useRef<Set<string>>(new Set());
  const knownThemeRows = useRef<Set<string>>(new Set());

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(openMap));
    } catch {}
  }, [openMap, storageKey]);

  const registerSection = useCallback((id: string, defaultOpen: boolean) => {
    if (known.current.has(id)) return;
    known.current.add(id);
    setOpenMap(prev => (id in prev ? prev : { ...prev, [id]: defaultOpen }));
  }, []);

  const isOpen = useCallback((id: string) => openMap[id] ?? false, [openMap]);

  const toggle = useCallback(
    (id: string) => setOpenMap(prev => ({ ...prev, [id]: !prev[id] })),
    [],
  );

  const expandAll = useCallback(() => {
    setOpenMap(() => {
      const next: Record<string, boolean> = {};
      known.current.forEach(id => (next[id] = true));
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setOpenMap(() => {
      const next: Record<string, boolean> = {};
      known.current.forEach(id => (next[id] = false));
      return next;
    });
  }, []);

  /* ─── Theme-row controls ─── */

  const registerThemeRow = useCallback((id: string) => {
    if (knownThemeRows.current.has(id)) return;
    knownThemeRows.current.add(id);
  }, []);

  const isThemeRowOpen = useCallback((id: string) => themeRowMap[id] ?? false, [themeRowMap]);

  const toggleThemeRow = useCallback(
    (id: string) => setThemeRowMap(prev => ({ ...prev, [id]: !prev[id] })),
    [],
  );

  const expandAllThemeRows = useCallback(() => {
    setThemeRowMap(() => {
      const next: Record<string, boolean> = {};
      knownThemeRows.current.forEach(id => (next[id] = true));
      return next;
    });
  }, []);

  const collapseAllThemeRows = useCallback(() => {
    setThemeRowMap({});
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      registerSection, isOpen, toggle, expandAll, collapseAll, count: known.current.size,
      registerThemeRow, isThemeRowOpen, toggleThemeRow, expandAllThemeRows, collapseAllThemeRows,
      themeRowCount: knownThemeRows.current.size,
    }),
    [registerSection, isOpen, toggle, expandAll, collapseAll,
     registerThemeRow, isThemeRowOpen, toggleThemeRow, expandAllThemeRows, collapseAllThemeRows],
  );

  return <CollapsibleCtx.Provider value={value}>{children}</CollapsibleCtx.Provider>;
}

export function useCollapsibleController() {
  const ctx = useContext(CollapsibleCtx);
  if (!ctx) throw new Error("useCollapsibleController must be used within CollapsibleProvider");
  return ctx;
}

/* ─────────── Hook for individual theme rows ─────────── */

export function useThemeRowToggle(id: string) {
  const { registerThemeRow, isThemeRowOpen, toggleThemeRow } = useCollapsibleController();
  useEffect(() => { registerThemeRow(id); }, [id, registerThemeRow]);
  return { open: isThemeRowOpen(id), toggle: () => toggleThemeRow(id) };
}

/* ─────────── Expand / Collapse All button bar ─────────── */

export function ExpandCollapseAll() {
  const { expandAll, collapseAll, expandAllThemeRows, collapseAllThemeRows } = useCollapsibleController();
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-1 rounded-lg bg-[rgba(255,255,255,0.03)] p-0.5">
        <button
          onClick={expandAll}
          className="rounded-md px-2.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-foreground"
        >
          Expand all
        </button>
        <span className="h-3 w-px bg-[rgba(255,255,255,0.08)]" />
        <button
          onClick={collapseAll}
          className="rounded-md px-2.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-foreground"
        >
          Collapse all
        </button>
      </div>
      <div className="flex items-center gap-1 rounded-lg bg-[rgba(0,245,196,0.06)] p-0.5 border border-[rgba(0,245,196,0.12)]">
        <button
          onClick={expandAllThemeRows}
          className="rounded-md px-2.5 py-1 text-[10px] font-medium text-[#00f5c4] transition-colors hover:bg-[rgba(0,245,196,0.1)]"
          title="Expand every theme to reveal its underlying tickers"
        >
          Show all details
        </button>
        <span className="h-3 w-px bg-[rgba(0,245,196,0.15)]" />
        <button
          onClick={collapseAllThemeRows}
          className="rounded-md px-2.5 py-1 text-[10px] font-medium text-[#00f5c4]/80 transition-colors hover:bg-[rgba(0,245,196,0.1)]"
        >
          Hide all details
        </button>
      </div>
    </div>
  );
}

/* ─────────── Section card ─────────── */

interface CollapsibleSectionProps {
  id: string;
  title: string;
  badge?: ReactNode;
  summary?: ReactNode;
  headerActions?: ReactNode;
  defaultOpen?: boolean;
  accent?: string;
  children: ReactNode;
}

export default function CollapsibleSection({
  id,
  title,
  badge,
  summary,
  headerActions,
  defaultOpen = false,
  accent = "#00f5c4",
  children,
}: CollapsibleSectionProps) {
  const { registerSection, isOpen, toggle } = useCollapsibleController();

  useEffect(() => {
    registerSection(id, defaultOpen);
  }, [id, defaultOpen, registerSection]);

  const open = isOpen(id);

  return (
    <section
      className="overflow-hidden rounded-xl"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(12px)",
      }}
    >
      <button
        type="button"
        onClick={() => toggle(id)}
        aria-expanded={open}
        className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[rgba(255,255,255,0.03)]"
      >
        <span
          className="h-5 w-0.5 rounded-full transition-opacity"
          style={{ background: accent, opacity: open ? 1 : 0.4 }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-['Syne',sans-serif] text-sm font-semibold text-foreground">
              {title}
            </h3>
            {badge && (
              <span
                className="text-[10px] text-muted-foreground"
                style={{ fontFamily: "'DM Mono', monospace" }}
              >
                {badge}
              </span>
            )}
          </div>
          {!open && summary && (
            <div className="mt-1 truncate text-[11px] text-muted-foreground">{summary}</div>
          )}
        </div>
        {headerActions && (
          <div
            onClick={e => e.stopPropagation()}
            className="flex items-center gap-1.5"
          >
            {headerActions}
          </div>
        )}
        <ChevronDown
          size={16}
          className="shrink-0 text-muted-foreground transition-transform duration-300 group-hover:text-foreground"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      <div
        className="grid transition-all duration-300 ease-out"
        style={{
          gridTemplateRows: open ? "1fr" : "0fr",
          opacity: open ? 1 : 0,
        }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-[rgba(255,255,255,0.06)] px-4 py-4">{children}</div>
        </div>
      </div>
    </section>
  );
}
