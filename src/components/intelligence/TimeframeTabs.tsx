import { Lock } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { type Timeframe, type TimeframeAvailability } from "@/hooks/useTimeframeAvailability";

const LABELS: Record<Timeframe, string> = { today: "Today", "1W": "1W", "1M": "1M", "3M": "3M" };
const ALL: Timeframe[] = ["today", "1W", "1M", "3M"];

interface TimeframeTabsProps {
  selected: Timeframe;
  onSelect: (tf: Timeframe) => void;
  availability: TimeframeAvailability;
}

export default function TimeframeTabs({ selected, onSelect, availability }: TimeframeTabsProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-[rgba(255,255,255,0.03)] p-0.5">
      {ALL.map(tf => {
        const unlocked = availability[tf];
        const isActive = selected === tf;
        const needed = availability.daysNeeded[tf] ?? 0;

        if (!unlocked) {
          return (
            <Tooltip key={tf}>
              <TooltipTrigger asChild>
                <button
                  disabled
                  className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-medium opacity-50 text-muted-foreground cursor-not-allowed"
                >
                  {LABELS[tf]}
                  <Lock size={9} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs max-w-[200px]">
                Unlocks after {needed} more trading day{needed !== 1 ? "s" : ""} of EOD data
              </TooltipContent>
            </Tooltip>
          );
        }

        return (
          <button
            key={tf}
            onClick={() => onSelect(tf)}
            className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-all ${
              isActive
                ? "bg-[rgba(255,255,255,0.08)] text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.04)]"
            }`}
          >
            {LABELS[tf]}
          </button>
        );
      })}
    </div>
  );
}
