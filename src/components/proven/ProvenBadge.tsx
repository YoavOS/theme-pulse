import { LABEL_CLS, LABEL_SHORT, LABEL_TEXT, type ProvenRow } from "@/lib/proven/types";

/** Compact Proven-Strong chip; the sentence is in the tooltip (hover) and for screen readers. */
export default function ProvenBadge({ row, short = true, className = "" }: { row: Pick<ProvenRow, "label" | "sentence"> | undefined | null; short?: boolean; className?: string }) {
  if (!row?.label) return null;
  const text = short ? LABEL_SHORT[row.label] : LABEL_TEXT[row.label];
  return (
    <span title={`${LABEL_TEXT[row.label]} — ${row.sentence ?? ""}`} aria-label={`${LABEL_TEXT[row.label]}: ${row.sentence ?? ""}`}
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded border px-1 py-px text-[9.5px] font-semibold leading-tight ${LABEL_CLS[row.label]} ${className}`}>
      {text}
    </span>
  );
}
