import { useMemo, useState } from "react";
import { SectionHead, Segmented } from "@/components/Explainer";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LEAD_INFO, leadershipForGroups, type GroupLead, type LeadState } from "@/lib/leadership";
import { HowItWorks } from "@/components/Explainer";
import type { StockStage } from "@/lib/stageAnalysis";

const sign = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;

function RsSpark({ g }: { g: GroupLead }) {
  const pts = g.rsLine;
  if (pts.length < 5) return null;
  const lo = Math.min(...pts), hi = Math.max(...pts);
  const W = 80, H = 18;
  const d = pts.map((y, k) => `${k ? "L" : "M"}${((k / (pts.length - 1)) * W).toFixed(1)},${(H - ((y - lo) / (hi - lo || 1)) * H).toFixed(1)}`).join("");
  const up = pts[pts.length - 1] >= pts[Math.max(0, pts.length - 14)];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[18px] w-20" preserveAspectRatio="none" aria-label="Relative strength vs SPY, 40 weeks">
      <path d={d} fill="none" stroke={up ? "hsl(150,65%,50%)" : "hsl(330,70%,65%)"} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Leadership state of each group (current group mode) from members' weekly closes and breadth flags. */
export default function LeadershipPanel({ groups, spy, asOf, modeLabel, minMembers }: {
  groups: { name: string; members: StockStage[] }[]; spy: StockStage | null; asOf: string | null; modeLabel: string; minMembers: number;
}) {
  const [show, setShow] = useState<"leaders" | "all">("leaders");
  const [all, setAll] = useState(false);
  const leads = useMemo(() => leadershipForGroups(groups, spy, asOf, minMembers), [groups, spy, asOf, minMembers]);

  if (!leads.length) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <SectionHead title="Group leadership" className="mb-1" />
        <p className="text-xs text-muted-foreground">Needs weekly price history per stock — press Scan Stages (or run a Full Scan) to fill it in.</p>
      </section>
    );
  }
  const counts = new Map<LeadState, number>();
  for (const g of leads) counts.set(g.state, (counts.get(g.state) ?? 0) + 1);
  const rows = show === "leaders" ? leads.filter((g) => ["confirmed", "emerging", "mature", "warning", "lost"].includes(g.state)) : leads;

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 pb-0.5 pt-4">
        <SectionHead
          title="Group leadership"
          sub={`Which ${modeLabel.toLowerCase()} groups are beating SPY (equal-weight returns) and where each is in its leadership cycle. Change the grouping in "By group" below.`}
          right={<Segmented<"leaders" | "all"> size="xs" value={show} onChange={setShow} options={[{ value: "leaders" as const, label: "Leadership signals" }, { value: "all" as const, label: `All ${leads.length}` }]} />}
        />
      </div>
      <div className="flex flex-wrap gap-1.5 px-4 pt-3">
        {(Object.keys(LEAD_INFO) as LeadState[]).filter((s) => counts.get(s)).map((s) => (
          <Tooltip key={s}>
            <TooltipTrigger asChild>
              <span className={`cursor-help rounded px-1.5 py-[2px] text-[10.5px] ${LEAD_INFO[s].cls}`}>{LEAD_INFO[s].label} {counts.get(s)}</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs leading-relaxed">{LEAD_INFO[s].tip}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">No group shows a leadership signal right now.</p>
      ) : (
        <div className="overflow-x-auto px-2 pb-2 pt-1">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-[10.5px] text-muted-foreground">
                <th className="px-2 py-1.5 text-left font-medium">Group</th>
                <th className="px-2 py-1.5 text-left font-medium">State</th>
                <th className="px-2 py-1.5 text-right font-medium" title="Percentile among groups of the 13-week return vs SPY, and its change over 4 weeks">RS rank 13w</th>
                <th className="px-2 py-1.5 text-right font-medium">vs SPY 4w · 13w · 26w</th>
                <th className="px-2 py-1.5 text-right font-medium" title="Members above their 10-week line now (in brackets: the highest share in the last 13 weeks)">Above 10w line (13w peak)</th>
                <th className="px-2 py-1.5 text-right font-medium" title="Members that made a new 52-week high in the last 4 weeks">New highs 4w</th>
                <th className="px-2 py-1.5 text-left font-medium">RS line</th>
              </tr>
            </thead>
            <tbody>
              {(all ? rows : rows.slice(0, 12)).map((g) => (
                <tr key={g.name} className="border-b border-border/30">
                  <td className="max-w-[220px] truncate px-2 py-1" title={g.name}>{g.name} <span className="text-[10px] text-muted-foreground">{g.n}</span></td>
                  <td className="px-2 py-1">
                    <Tooltip>
                      <TooltipTrigger asChild><span className={`cursor-help whitespace-nowrap rounded px-1.5 py-[1px] text-[10.5px] ${LEAD_INFO[g.state].cls}`}>{LEAD_INFO[g.state].label}</span></TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs leading-relaxed">
                        {g.reasons.length ? <ul className="list-disc pl-4">{g.reasons.map((x) => <li key={x}>{x}</li>)}</ul> : LEAD_INFO[g.state].tip}
                      </TooltipContent>
                    </Tooltip>
                  </td>
                  <td className="px-2 py-1 text-right font-mono">
                    {g.rank13}
                    {g.rank13Chg4 !== null && <span className={`ml-1 text-[10px] ${g.rank13Chg4 > 0 ? "text-emerald-400" : g.rank13Chg4 < 0 ? "text-pink-300" : "text-muted-foreground"}`}>{g.rank13Chg4 > 0 ? "+" : ""}{g.rank13Chg4}</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-right font-mono text-[11px]">
                    {[g.rs4, g.rs13, g.rs26].map((x, k) => <span key={k} className={`${k ? "ml-1.5" : ""} ${x > 0 ? "text-emerald-400" : "text-pink-300"}`}>{sign(x)}</span>)}
                  </td>
                  <td className="px-2 py-1 text-right font-mono">{Math.round(g.p50)}% <span className="text-[10px] text-muted-foreground">({Math.round(g.p50Peak13)})</span></td>
                  <td className="px-2 py-1 text-right font-mono">{Math.round(g.highs4)}%</td>
                  <td className="px-2 py-1"><RsSpark g={g} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 12 && (
            <button onClick={() => setAll((v) => !v)} className="w-full border-t border-border px-4 py-2 text-left text-[11.5px] text-primary hover:bg-accent/30">
              {all ? "Show the first 12 only" : `Show all ${rows.length}`}
            </button>
          )}
        </div>
      )}
      <div className="border-t border-border px-4 py-2">
        <HowItWorks title="What the states mean & how they tested">
          <p>
            <b className="text-foreground/80">Emerging / Confirmed</b> = the group just started beating SPY with more of its stocks above their 10-week line.
            <b className="text-foreground/80"> Mature</b> = still leading but for a while. <b className="text-foreground/80">Peak warning</b> = leading but cracking
            (fewer stocks above trend, RS rank slipping). <b className="text-foreground/80">Leadership lost</b> = no longer beating SPY. Hover a state for the exact reasons.
          </p>
          <p>
            <b className="text-foreground/80">Tested on your list</b> (sub-industries and themes, weekly, 2022–Oct 2026, groups vs SPY, median): over the next 4 weeks,
            Confirmed and Emerging groups beat SPY by about +1 to +2 pts (55–57% of the time) and Peak-warning groups lagged (−0.7 to −1.3, 45–46%).
            Over 13 weeks the warnings faded and groups that had lost leadership often rebounded — so use the states to choose where to look for
            setups and to be stricter in the near term, not as sell signals. Today's stocks only (survivorship), and the yearly results swung a lot.
          </p>
          <p>Research: industry momentum persists roughly 3–12 months as a group while the weekly #1 churns (Moskowitz &amp; Grinblatt 1999), so states need several weeks of agreement.</p>
        </HowItWorks>
      </div>
    </section>
  );
}
