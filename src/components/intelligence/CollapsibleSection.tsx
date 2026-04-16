import { ReactNode, useEffect, useRef, useState, createContext, useContext, useCallback, useMemo } from "react";
import { ChevronDown } from "lucide-react";

/* ─────────── Page-level controller ─────────── */

type Ctx = {
  registerSection: (id: string, defaultOpen: boolean) => void;
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  count: number;
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
  const known = useRef<Set<string>>(new Set());

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

  const value = useMemo<Ctx>(
    () => ({ registerSection, isOpen, toggle, expandAll, collapseAll, count: known.current.size }),
    [registerSection, isOpen, toggle, expandAll, collapseAll],
  );

  return <CollapsibleCtx.Provider value={value}>{children}</CollapsibleCtx.Provider>;
}

export function useCollapsibleController() {
  const ctx = useContext(CollapsibleCtx);
  if (!ctx) throw new Error("useCollapsibleController must be used within CollapsibleProvider");
  return ctx;
}

/* ─────────── Expand / Collapse All button bar ─────────── */

export function ExpandCollapseAll() {
  const { expandAll, collapseAll } = useCollapsibleController();
  return (
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
  );
}

/* ─────────── Section card ─────────── */

interface CollapsibleSectionProps {
  id: string;
  title: string;
  /** Small label rendered after the title, e.g. "12 themes" */
  badge?: ReactNode;
  /** Compact preview shown when collapsed, e.g. top-3 chips */
  summary?: ReactNode;
  /** Slot in the header (right-aligned, before chevron). Stops propagation. */
  headerActions?: ReactNode;
  defaultOpen?: boolean;
  /** Optional accent color for the title hairline */
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
