import { useMemo } from "react";
import { Sun } from "lucide-react";
import { useNow, type BriefData } from "@/hooks/useBrief";

/** The Brief panel collapsed: a thin rail that keeps the next event and breadth in view. */
export default function BriefRail({ data, onOpen }: { data: BriefData; onOpen: () => void }) {
  const now = useNow(30_000);
  const next = useMemo(
    () => data.events
      .filter((e) => (e.impact === "High" || e.impact === "Medium") && new Date(e.date).getTime() > now.getTime())
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null,
    [data.events, now],
  );
  const mins = next ? Math.max(0, Math.round((new Date(next.date).getTime() - now.getTime()) / 60_000)) : null;
  const spy = data.spy;
  const up = spy && spy.up + spy.down > 0 ? Math.round((spy.up / (spy.up + spy.down)) * 100) : null;

  return (
    <div className="flex h-full flex-col items-center gap-4 py-3">
      <button onClick={onOpen} aria-label="Open brief" title="Open brief"
        className="grid h-10 w-10 place-items-center rounded-lg border border-[hsl(40,90%,55%)]/70 bg-[hsl(40,90%,55%)]/10 text-[hsl(40,90%,62%)] hover:bg-[hsl(40,90%,55%)]/20">
        <Sun size={16} />
      </button>
      {next && mins !== null && (
        <button onClick={onOpen} className="flex flex-col items-center gap-1" title={`Next: ${next.event}`}>
          <span className={`h-2 w-2 rounded-full ${next.impact === "High" ? "bg-[hsl(350,85%,62%)]" : "bg-[hsl(40,90%,55%)]"}`} aria-hidden />
          <span className="text-center font-mono text-[10.5px] leading-tight text-[hsl(40,90%,62%)]">
            {mins >= 60 ? <>{Math.floor(mins / 60)}h<br />{String(mins % 60).padStart(2, "0")}m</> : `${mins}m`}
          </span>
          <span className="max-w-[48px] truncate text-[9.5px] text-muted-foreground">{next.event.split(" ")[0]}</span>
        </button>
      )}
      <span className="h-px w-7 bg-border" aria-hidden />
      {up !== null && (
        <div className="flex flex-col items-center" title="S&P 500 members up today">
          <span className={`font-mono text-[11px] ${up >= 50 ? "text-gain-medium" : "text-loss-medium"}`}>{up}%</span>
          <span className="text-[9.5px] text-muted-foreground">S&amp;P up</span>
        </div>
      )}
      {data.earnings.length > 0 && (
        <div className="flex flex-col items-center" title="Companies reporting today">
          <span className="font-mono text-[11px]">{data.earnings.length}</span>
          <span className="text-[9.5px] text-muted-foreground">earnings</span>
        </div>
      )}
    </div>
  );
}
