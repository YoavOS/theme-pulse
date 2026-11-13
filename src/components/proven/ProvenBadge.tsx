import { LABEL_CLS, LABEL_SHORT, LABEL_TEXT, type ProvenRow } from "@/lib/proven/types";
import { Term } from "@/components/lens/Term";

const LABEL_TERM: Record<string, string> = {
  elite: "elite", proven: "proven_label", proven_caveat: "proven_label", fading: "fading_label", provisional: "provisional",
  emerging: "emerging_label", emerging_early: "emerging_label", was_strong: "was_strong", not_proven: "not_proven", insufficient: "provisional",
};

/** Compact Proven-Strong chip; the sentence is in the tooltip (hover) and for screen readers. */
export default function ProvenBadge({ row, short = true, className = "", explain = false }: { row: Pick<ProvenRow, "label" | "sentence"> | undefined | null; short?: boolean; className?: string; /** click opens what the label means */ explain?: boolean }) {
  if (!row?.label) return null;
  const text = short ? LABEL_SHORT[row.label] : LABEL_TEXT[row.label];
  return (
    <span title={`${LABEL_TEXT[row.label]} — ${row.sentence ?? ""}`} aria-label={`${LABEL_TEXT[row.label]}: ${row.sentence ?? ""}`}
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded border px-1 py-px text-[9.5px] font-semibold leading-tight ${LABEL_CLS[row.label]} ${className}`}>
      {explain ? <Term id={LABEL_TERM[row.label]}>{text}</Term> : text}
    </span>
  );
}
