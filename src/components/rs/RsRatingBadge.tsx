interface Props {
  rating: number | null;
}

function ratingStyles(r: number): { bg: string; text: string; label: string } {
  if (r >= 80) return { bg: "bg-[hsl(160,75%,30%)]", text: "text-[hsl(160,80%,90%)]", label: "Very Strong" };
  if (r >= 60) return { bg: "bg-[hsl(160,60%,45%)]/80", text: "text-[hsl(160,80%,95%)]", label: "Strong" };
  if (r >= 40) return { bg: "bg-[hsl(40,85%,50%)]/80", text: "text-[hsl(40,90%,12%)]", label: "Neutral" };
  return { bg: "bg-destructive/80", text: "text-destructive-foreground", label: "Weak" };
}

export default function RsRatingBadge({ rating }: Props) {
  if (rating === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const s = ratingStyles(rating);
  return (
    <span
      className={`inline-flex min-w-[34px] items-center justify-center rounded-md px-1.5 py-0.5 font-mono text-xs font-bold ${s.bg} ${s.text}`}
      title={`${s.label} (${rating}/99)`}
    >
      {rating}
    </span>
  );
}

export function computeRsRatings(values: (number | null)[]): (number | null)[] {
  // Returns 1–99 rating per index, based on rank within the non-null values.
  const indexed = values.map((v, i) => ({ v, i }));
  const valid = indexed.filter((x) => x.v !== null) as { v: number; i: number }[];
  if (valid.length === 0) return values.map(() => null);
  if (valid.length === 1) {
    const out: (number | null)[] = values.map(() => null);
    out[valid[0].i] = 99;
    return out;
  }
  // Sort ascending so weakest = lowest rating
  valid.sort((a, b) => a.v - b.v);
  const out: (number | null)[] = values.map(() => null);
  const n = valid.length;
  valid.forEach((entry, rank) => {
    // Map rank [0..n-1] → rating [1..99]
    const rating = Math.round(1 + (rank / (n - 1)) * 98);
    out[entry.i] = Math.max(1, Math.min(99, rating));
  });
  return out;
}
