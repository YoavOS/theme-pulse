import { VolumeDryUpTheme } from "@/hooks/useVolumeDryUp";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Info, TrendingDown } from "lucide-react";

const DM_MONO = "'DM Mono', monospace";

const TOOLTIP_TEXT =
  "Themes where institutional volume is fading after elevated activity — often precedes price reversals";

export default function VolumeDryUpSection({ themes }: { themes: VolumeDryUpTheme[] }) {
  if (themes.length === 0) return null;

  return (
    <div
      className="rounded-lg p-4"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(245, 166, 35, 0.15)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <TrendingDown size={14} className="text-[#f5a623]" />
        <h4
          className="font-['Syne',sans-serif] text-xs font-semibold uppercase tracking-widest text-[#f5a623]"
        >
          📉 Volume Dry-Up
        </h4>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info size={11} className="text-muted-foreground cursor-help opacity-50" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px] text-xs">
            {TOOLTIP_TEXT}
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="space-y-2">
        {themes.map(t => (
          <div
            key={t.themeName}
            className="flex items-center gap-3 py-1.5"
          >
            <span className="font-['Syne',sans-serif] text-[13px] font-medium text-foreground truncate flex-1 min-w-0">
              {t.themeName}
            </span>

            {/* Last week sustained */}
            <div className="text-right shrink-0 w-20">
              <span className="text-[10px] text-muted-foreground block" style={{ fontFamily: DM_MONO }}>
                Last wk
              </span>
              <span className="text-xs font-medium text-[#4ade80]" style={{ fontFamily: DM_MONO }}>
                {t.lastWeekSustained.toFixed(2)}×
              </span>
            </div>

            {/* Arrow */}
            <span className="text-[#f5a623] text-sm shrink-0">→</span>

            {/* This week sustained */}
            <div className="text-right shrink-0 w-20">
              <span className="text-[10px] text-muted-foreground block" style={{ fontFamily: DM_MONO }}>
                This wk
              </span>
              <span className="text-xs font-medium text-[#f5a623]" style={{ fontFamily: DM_MONO }}>
                {t.thisWeekSustained.toFixed(2)}×
              </span>
            </div>

            {/* 1W perf */}
            <div className="text-right shrink-0 w-16">
              <span
                className={`text-xs font-medium ${t.perf_1w >= 0 ? "text-[#00f5c4]" : "text-[#f5a623]"}`}
                style={{ fontFamily: DM_MONO }}
              >
                {t.perf_1w >= 0 ? "+" : ""}{t.perf_1w.toFixed(2)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
