import { LABEL_CLS, LABEL_SHORT, LABEL_TEXT, type ProvenRow } from "@/lib/proven/types";
import { Term } from "@/components/lens/Term";
import { useLensLang } from "@/lib/lens/i18n";
import { HE_LABEL_SHORT, HE_LABEL_TEXT, heSentence } from "@/lib/lens/he/proven";

const LABEL_TERM: Record<string, string> = {
  elite: "elite", proven: "proven_label", proven_caveat: "proven_label", fading: "fading_label", provisional: "provisional",
  emerging: "emerging_label", emerging_early: "emerging_label", was_strong: "was_strong", not_proven: "not_proven", insufficient: "provisional",
};

/** Compact Proven-Strong chip; the sentence is in the tooltip (hover) and for screen readers. */
export default function ProvenBadge({ row, short = true, className = "", explain = false }: { row: Pick<ProvenRow, "label" | "sentence"> | undefined | null; short?: boolean; className?: string; /** click opens what the label means */ explain?: boolean }) {
  const he = useLensLang() === "he";
  if (!row?.label) return null;
  const full = (he ? HE_LABEL_TEXT : LABEL_TEXT)[row.label];
  const text = short ? (he ? HE_LABEL_SHORT : LABEL_SHORT)[row.label] : full;
  const sentence = he ? heSentence(row.sentence) : row.sentence ?? "";
  return (
    <span title={`${full} — ${sentence}`} aria-label={`${full}: ${sentence}`}
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded border px-1 py-px text-[9.5px] font-semibold leading-tight ${LABEL_CLS[row.label]} ${className}`}>
      {explain ? <Term id={LABEL_TERM[row.label]}>{text}</Term> : text}
    </span>
  );
}
