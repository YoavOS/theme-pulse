import { UserCheck } from "lucide-react";
import { MIN_BUY_VALUE, type InsiderInfo } from "@/hooks/useInsiderBuys";

const money = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`);

/**
 * Small chip for open-market insider buying in the last 90 days.
 * Green = a cluster (2+ insiders within 30 days); amber = a single insider. Hover for the trades.
 * Renders nothing when there's no qualifying purchase.
 */
export default function InsiderBuyBadge({ info }: { info: InsiderInfo | undefined }) {
  if (!info || info.buyers === 0) return null;
  const tip = [
    info.cluster ? `Cluster: ${info.buyers} insiders bought on the open market` : "One insider bought on the open market",
    `${money(info.value)} in the last 90 days (buys of ${money(MIN_BUY_VALUE)}+, not under a 10b5-1 plan)`,
    "",
    ...info.buys.slice(0, 8).map((b) =>
      `${b.date} · ${b.owner}${b.title ? ` (${b.title})` : b.isDirector ? " (Director)" : ""} · ${b.value !== null ? money(b.value) : `${b.shares ?? "?"} sh`}${b.plan ? " · 10b5-1 plan" : ""}`),
    info.buys.length > 8 ? `…and ${info.buys.length - 8} more` : "",
  ].filter((x, i) => x !== "" || i === 2).join("\n");
  const cls = info.cluster
    ? "border-[hsl(222,82%,66%)]/50 bg-[hsl(222,82%,66%)]/15 text-[hsl(222,82%,74%)]"
    : "border-[hsl(40,90%,55%)]/40 bg-[hsl(40,90%,55%)]/10 text-[hsl(40,90%,65%)]";
  return (
    <span title={tip} className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px font-mono text-[10px] leading-4 ${cls}`}>
      <UserCheck size={10} aria-hidden="true" />
      {info.buyers > 1 ? `${info.buyers}×` : ""}{money(info.value)}
      <span className="sr-only">insider buying</span>
    </span>
  );
}
