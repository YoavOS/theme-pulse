import { useState, useRef, useEffect, useCallback } from "react";
import { FundamentalsData, getScoreLabel, getStockTypeInfo, getValuationColor, getSmartMoneyColor } from "@/hooks/useFundamentals";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";

const DM_MONO = "'DM Mono', monospace";

function MiniBar({ value, max, reverse }: { value: number | null; max: number; reverse?: boolean }) {
  if (value === null) return <span className="text-muted-foreground" style={{ fontFamily: DM_MONO }}>—</span>;
  const pct = Math.min(Math.abs(value) / max * 100, 100);
  const good = reverse ? value <= max * 0.3 : value >= max * 0.5;
  const mid = reverse ? value <= max * 0.6 : value >= max * 0.25;
  const color = good ? "hsl(var(--gain-strong))" : mid ? "#facc15" : "hsl(var(--destructive))";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-14 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

interface Props {
  symbol: string;
  data: FundamentalsData | null;
  onFetchRequest: (symbol: string) => void;
  onDrilldown?: (symbol: string) => void;
  children: React.ReactNode;
}

export default function TickerFundamentalsTooltip({ symbol, data, onFetchRequest, onDrilldown, children }: Props) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<"right" | "left">("right");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      // Check position
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setPosition(rect.left + 340 > window.innerWidth ? "left" : "right");
      }
      setVisible(true);
      if (!data) onFetchRequest(symbol);
    }, 300);
  }, [data, onFetchRequest, symbol]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const d = data;
  const scoreLabel = d?.fundamental_score != null ? getScoreLabel(d.fundamental_score) : null;
  const typeInfo = d?.stock_type ? getStockTypeInfo(d.stock_type) : null;

  return (
    <div
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {visible && (
        <div
          ref={tooltipRef}
          className="absolute z-50 animate-in fade-in duration-150"
          style={{
            top: "50%",
            transform: "translateY(-50%)",
            ...(position === "right" ? { left: "calc(100% + 8px)" } : { right: "calc(100% + 8px)" }),
            width: 320,
          }}
        >
          <div
            className="rounded-lg p-3 space-y-2.5"
            style={{
              background: "rgba(10,10,15,0.95)",
              border: "1px solid rgba(255,255,255,0.12)",
              backdropFilter: "blur(16px)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            }}
          >
            {!d ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="font-['Syne',sans-serif] font-bold text-foreground text-sm">{symbol}</span>
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <p className="text-[9px] text-muted-foreground">Fetching fundamentals…</p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="flex items-center gap-2">
                  <span className="font-['Syne',sans-serif] font-bold text-foreground text-sm">{symbol}</span>
                  {typeInfo && (
                    <span className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0 text-[9px] font-semibold ${typeInfo.color}`}>
                      {typeInfo.emoji} {typeInfo.label}
                    </span>
                  )}
                </div>

                {/* Score gauge */}
                {d.fundamental_score != null && scoreLabel && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">Fundamental Score</span>
                      <span className={`text-xs font-semibold ${scoreLabel.color}`} style={{ fontFamily: DM_MONO }}>
                        {d.fundamental_score} / 100
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                      <div className="h-full rounded-full transition-all" style={{
                        width: `${d.fundamental_score}%`,
                        background: d.fundamental_score >= 70 ? "hsl(var(--primary))" : d.fundamental_score >= 50 ? "hsl(var(--gain-medium))" : d.fundamental_score >= 30 ? "#facc15" : "hsl(var(--destructive))"
                      }} />
                    </div>
                    <p className={`text-[9px] ${scoreLabel.color}`}>{scoreLabel.text}</p>
                  </div>
                )}

                {/* Valuation */}
                {d.pe_ratio != null && (
                  <p className={`text-[10px] ${getValuationColor(d.valuation_label)}`}>
                    Trading at {d.pe_ratio.toFixed(0)}× earnings — {d.valuation_label || "N/A"}
                  </p>
                )}

                {/* Mini metrics */}
                <div className="space-y-1">
                  {([
                    ["📈", "Revenue Growth", d.revenue_growth_1y, 100, false, true],
                    ["💰", "Net Margin", d.net_margin, 50, false, false],
                    ["🏦", "Debt / Equity", d.debt_to_equity, 5, true, false],
                    ["👔", "Analyst Rating", null, 0, false, false],
                  ] as const).map(([emoji, label, value, max, reverse], idx) => (
                    <div key={idx} className="flex items-center gap-2 text-[10px]">
                      <span className="w-3 text-center">{emoji}</span>
                      <span className="text-muted-foreground w-24 truncate">{label}</span>
                      {label === "Analyst Rating" ? (
                        <span className="text-foreground font-medium" style={{ fontFamily: DM_MONO }}>
                          {d.analyst_rating || "—"}
                        </span>
                      ) : (
                        <>
                          <span className="text-foreground font-medium w-12 text-right" style={{ fontFamily: DM_MONO }}>
                            {value != null
                              ? label.includes("Debt") ? (value as number).toFixed(1) : `${(value as number) >= 0 ? "+" : ""}${(value as number).toFixed(0)}%`
                              : "—"}
                          </span>
                          <MiniBar value={value as number | null} max={max as number} reverse={reverse as boolean} />
                        </>
                      )}
                    </div>
                  ))}
                </div>

                {/* Smart Money */}
                {d.smart_money_score != null && (
                  <p className={`text-[10px] ${getSmartMoneyColor(d.smart_money_score)}`}>
                    🏛️ Smart Money: {d.smart_money_score}/100 — {d.smart_money_label || "N/A"}
                  </p>
                )}

                {/* Insider */}
                {(d.recent_insider_buys != null || d.recent_insider_sells != null) && (
                  <p className={`text-[10px] ${(d.recent_insider_buys ?? 0) > (d.recent_insider_sells ?? 0) ? "text-primary" : "text-muted-foreground"}`}>
                    👔 Insiders: {d.recent_insider_buys ?? 0} buys · {d.recent_insider_sells ?? 0} sells (90d)
                  </p>
                )}

                {/* AI Summary */}
                {d.ai_summary && (
                  <p className="text-[9px] text-muted-foreground leading-relaxed border-t border-border/30 pt-2">
                    {d.ai_summary}
                  </p>
                )}

                {/* Footer */}
                <p
                  className="text-[9px] text-muted-foreground/60 cursor-pointer hover:text-muted-foreground transition-colors"
                  onClick={(e) => { e.stopPropagation(); onDrilldown?.(symbol); }}
                >
                  Click to open full breakdown →
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
