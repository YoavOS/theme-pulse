import { useEffect, useState } from "react";
import { X, Sparkles, Loader2, Copy, TrendingUp, Telescope, Target } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface EarningsAnalysisContext {
  symbol: string;
  company?: string | null;
  sector?: string | null;
  gapPct?: number | null;
  epsSurprisePct?: number | null;
  revenueSurprisePct?: number | null;
  reportDate?: string | null;
  reportTime?: string | null;
}

interface AnalysisData {
  shortTerm: string;
  longTerm: string;
  takeaway: string;
}

interface Props {
  ctx: EarningsAnalysisContext | null;
  onClose: () => void;
}

export default function EarningsAnalysisPanel({ ctx, onClose }: Props) {
  const [data, setData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ctx) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    setData(null);
    void (async () => {
      try {
        const { data: resp, error } = await supabase.functions.invoke("earnings-deep-analysis", { body: ctx });
        if (cancelled) return;
        if (error) throw error;
        if ((resp as { error?: string })?.error) throw new Error((resp as { error: string }).error);
        setData(resp as AnalysisData);
      } catch (e) {
        toast.error("AI analysis failed", { description: e instanceof Error ? e.message : String(e) });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ctx]);

  if (!ctx) return null;

  const exportTV = () => {
    void navigator.clipboard.writeText(ctx.symbol);
    toast.success(`${ctx.symbol} copied for TradingView`);
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <aside className="flex h-full w-full max-w-xl flex-col border-l border-border bg-background shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-border bg-card px-5 py-4">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">AI Earnings Analysis</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold text-foreground">{ctx.symbol}</span>
              <span className="truncate text-xs text-muted-foreground">{ctx.company ?? ""}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={exportTV} title="Copy ticker for TradingView"
              className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/15">
              <Copy size={11} /> TV
            </button>
            <button onClick={onClose} className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
              <X size={14} />
            </button>
          </div>
        </header>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-2 border-b border-border bg-muted/10 px-5 py-3 text-center text-[11px]">
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">Gap</div>
            <div className={`font-mono font-bold ${(ctx.gapPct ?? 0) >= 0 ? "text-[hsl(150,75%,55%)]" : "text-[hsl(0,75%,65%)]"}`}>
              {ctx.gapPct !== null && ctx.gapPct !== undefined ? `${ctx.gapPct >= 0 ? "+" : ""}${ctx.gapPct.toFixed(1)}%` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">EPS Surprise</div>
            <div className={`font-mono font-bold ${(ctx.epsSurprisePct ?? 0) >= 0 ? "text-[hsl(150,75%,55%)]" : "text-[hsl(0,75%,65%)]"}`}>
              {ctx.epsSurprisePct !== null && ctx.epsSurprisePct !== undefined ? `${ctx.epsSurprisePct >= 0 ? "+" : ""}${ctx.epsSurprisePct.toFixed(1)}%` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">Rev Surprise</div>
            <div className={`font-mono font-bold ${(ctx.revenueSurprisePct ?? 0) >= 0 ? "text-[hsl(150,75%,55%)]" : "text-[hsl(0,75%,65%)]"}`}>
              {ctx.revenueSurprisePct !== null && ctx.revenueSurprisePct !== undefined ? `${ctx.revenueSurprisePct >= 0 ? "+" : ""}${ctx.revenueSurprisePct.toFixed(1)}%` : "—"}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" /> Generating AI analysis…
            </div>
          )}
          {data && (
            <div className="space-y-5">
              <Section
                icon={<TrendingUp size={14} className="text-[hsl(40,90%,60%)]" />}
                accent="hsl(40,90%,60%)"
                title="Short-Term Catalyst"
                subtitle="Immediate reaction"
                body={data.shortTerm}
              />
              <Section
                icon={<Telescope size={14} className="text-[hsl(200,80%,60%)]" />}
                accent="hsl(200,80%,60%)"
                title="Long-Term Drivers"
                subtitle="Strategic view"
                body={data.longTerm}
              />
              <Section
                icon={<Target size={14} className="text-[hsl(150,75%,55%)]" />}
                accent="hsl(150,75%,55%)"
                title="Trader Takeaway"
                subtitle="Actionable summary"
                body={data.takeaway}
              />
              <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground">
                <Sparkles size={11} className="mt-0.5 text-primary" />
                Generated by AI based on the available earnings data. Always cross-check before trading.
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function Section({ icon, accent, title, subtitle, body }: {
  icon: React.ReactNode; accent: string; title: string; subtitle: string; body: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4" style={{ boxShadow: `inset 3px 0 0 ${accent}` }}>
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-bold tracking-wide text-foreground">{title}</h3>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{subtitle}</span>
      </div>
      <p className="text-[13px] leading-relaxed text-foreground/90">{body}</p>
    </section>
  );
}
