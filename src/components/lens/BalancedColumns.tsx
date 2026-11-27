import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Cards laid out in `cols` columns that fill top-to-bottom and end at about the same height.
 * Each block goes, in reading order, to the column that is shortest so far.
 *
 * Blocks never remount when they change column (they are all children of one CSS grid; the column is
 * set per item and the height is a row span), so open rows and loaded data survive. Columns are
 * re-balanced while the data settles; once the reader interacts — or after a few seconds — the
 * assignment is frozen, so opening a row only pushes down the cards below it in the same column.
 */
const ROW = 4;     // px per grid row
const GAP = 12;    // px between cards in a column

export interface Block { key: string; node: ReactNode }

export function BalancedColumns({ cols, blocks, className = "" }: { cols: number; blocks: Block[]; className?: string }) {
  const keys = blocks.map((b) => b.key);
  const sig = `${cols}|${keys.join(",")}`;
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [placed, setPlaced] = useState<{ sig: string; col: Record<string, number> } | null>(null);
  const frozen = useRef<string | null>(null);          // sig the assignment was frozen for
  const inner = useRef(new Map<string, HTMLDivElement>());

  // live heights of every block
  useLayoutEffect(() => {
    if (cols < 2 || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      setHeights((h) => {
        let next = h;
        for (const e of entries) {
          const k = (e.target as HTMLElement).dataset.block!;
          const v = Math.ceil((e.target as HTMLElement).getBoundingClientRect().height);
          if (h[k] !== v) { if (next === h) next = { ...h }; next[k] = v; }
        }
        return next;
      });
    });
    inner.current.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [sig, cols]);

  // greedy assignment: next block → shortest column (re-run until frozen)
  const assignment = useMemo(() => {
    if (frozen.current === sig && placed?.sig === sig) return placed.col;
    const tops = Array(Math.max(cols, 1)).fill(0), col: Record<string, number> = {};
    for (const k of keys) {
      let c = 0;
      for (let i = 1; i < tops.length; i++) if (tops[i] < tops[c] - 1) c = i;
      col[k] = c;
      tops[c] += (heights[k] ?? 200) + GAP;
    }
    return col;
  }, [sig, heights]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (frozen.current !== sig) setPlaced({ sig, col: assignment }); }, [assignment, sig]);

  // freeze after the first interaction, or once the data has had time to settle
  useEffect(() => {
    frozen.current = null;
    const t = setTimeout(() => { frozen.current = sig; }, 4000);
    return () => clearTimeout(t);
  }, [sig]);
  const freeze = () => { frozen.current = sig; };

  if (cols < 2) return <div className={`space-y-3 ${className}`}>{blocks.map((b) => <div key={b.key}>{b.node}</div>)}</div>;
  return (
    <div className={`grid ${className}`} onPointerDownCapture={freeze} onKeyDownCapture={freeze}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: `${ROW}px`, gridAutoFlow: "dense", columnGap: GAP }}>
      {blocks.map((b) => (
        <div key={b.key} style={{ gridColumn: (assignment[b.key] ?? 0) + 1, gridRowEnd: `span ${Math.max(1, Math.ceil(((heights[b.key] ?? 200) + GAP) / ROW))}` }}>
          <div data-block={b.key} ref={(el) => { if (el) inner.current.set(b.key, el); else inner.current.delete(b.key); }}>{b.node}</div>
        </div>
      ))}
    </div>
  );
}
