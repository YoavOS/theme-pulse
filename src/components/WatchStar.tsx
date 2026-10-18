import { Star } from "lucide-react";
import { useWatchlist } from "@/lib/watchlist";

/** Star toggle that adds / removes a symbol from the personal watchlist. Clicks don't reach the row underneath. */
export default function WatchStar({ symbol, size = 12, className = "" }: { symbol: string; size?: number; className?: string }) {
  const { has, toggle } = useWatchlist();
  const on = has(symbol);
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); toggle(symbol); }}
      title={on ? "Remove from watchlist" : "Add to watchlist"}
      aria-label={on ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
      className={`inline-flex items-center ${on ? "text-[hsl(45,95%,58%)]" : "text-muted-foreground/50 hover:text-muted-foreground"} ${className}`}
    >
      <Star size={size} fill={on ? "currentColor" : "none"} />
    </button>
  );
}
