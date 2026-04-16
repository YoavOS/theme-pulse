import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, BarChart3, TrendingUp, LineChart, Grid3X3, Sparkles, Activity, FlaskConical, RefreshCw } from "lucide-react";
import { useThemeIntelligence } from "@/hooks/useThemeIntelligence";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import OverviewTab from "@/components/intelligence/OverviewTab";
import MomentumTab from "@/components/intelligence/MomentumTab";
import BreadthTab from "@/components/intelligence/BreadthTab";
import InsightsTab from "@/components/intelligence/InsightsTab";
import TrendsTab from "@/components/intelligence/TrendsTab";
import HeatmapTab from "@/components/intelligence/HeatmapTab";
import FundamentalsIntelTab from "@/components/intelligence/FundamentalsIntelTab";
import React from "react";
import HelpButton from "@/components/HelpButton";
import { CollapsibleProvider, ExpandCollapseAll } from "@/components/intelligence/CollapsibleSection";

const SUB_TABS = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "momentum", label: "Momentum", icon: TrendingUp },
  { id: "breadth", label: "Breadth", icon: Activity },
  { id: "trends", label: "Trends", icon: LineChart },
  { id: "heatmap", label: "Heatmap", icon: Grid3X3 },
  { id: "fundamentals", label: "Fundamentals", icon: FlaskConical },
  { id: "insights", label: "Insights", icon: Sparkles },
] as const;

type SubTabId = typeof SUB_TABS[number]["id"];

export default function ThemeIntelligence() {
  const [activeTab, setActiveTab] = useState<SubTabId>("overview");
  const [isBackfilling, setIsBackfilling] = useState(false);
  const { themes, accelerating, fading, isLoading, refetch } = useThemeIntelligence();

  const runBackfill = async () => {
    if (isBackfilling) return;
    setIsBackfilling(true);
    const tId = toast.loading("Backfilling historical data via Yahoo…");
    try {
      let offset = 0;
      let done = false;
      let totalUpdated = 0;
      while (!done) {
        const { data, error } = await supabase.functions.invoke("backfill-theme-performance", {
          body: { offset, limit: 30 },
        });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);
        done = data.done;
        offset = data.next_offset ?? offset;
        totalUpdated += data.chunkUpdated ?? 0;
        toast.loading(`Backfilled ${data.processed}/${data.total} symbols…`, { id: tId });
      }
      toast.success(`Done — refreshed ${totalUpdated} symbols`, { id: tId });
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { id: tId });
    } finally {
      setIsBackfilling(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft size={16} />
            </Link>
            <h1 className="font-['Syne',sans-serif] text-xl font-bold tracking-tight text-foreground">
              Theme Intelligence
            </h1>
            <span className="text-xs text-muted-foreground">
              {themes.length} themes · {isLoading ? "loading…" : "live"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ExpandCollapseAll />
            <button
              onClick={runBackfill}
              disabled={isBackfilling}
              className="flex items-center gap-1.5 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
              title="Refresh 1W/1M/3M/YTD via Yahoo Finance"
            >
              <RefreshCw size={12} className={isBackfilling ? "animate-spin" : ""} />
              {isBackfilling ? "Refreshing…" : "Refresh historical"}
            </button>
            <HelpButton />
          </div>
        </div>

        {/* Sub-tab navigation — sticky pills */}
        <div className="container pb-2">
          <div className="relative flex items-center gap-1 rounded-lg bg-[rgba(255,255,255,0.03)] p-1 w-fit">
            {SUB_TABS.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-medium transition-all ${
                    isActive
                      ? "bg-[rgba(255,255,255,0.08)] text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.04)]"
                  }`}
                >
                  <Icon size={13} />
                  {tab.label}
                  {isActive && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-6 rounded-full bg-[#00f5c4]" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Content area with fade transition */}
      <main className="container py-5">
        <div
          key={activeTab}
          className="animate-in fade-in duration-300"
        >
          {activeTab === "overview" && (
            <OverviewTab themes={themes} isLoading={isLoading} />
          )}
          {activeTab === "momentum" && (
            <MomentumTab accelerating={accelerating} fading={fading} isLoading={isLoading} />
          )}
          {activeTab === "breadth" && (
            <ErrorBoundary label="Breadth">
              <BreadthTab themes={themes} isLoading={isLoading} />
            </ErrorBoundary>
          )}
          {activeTab === "trends" && (
            <ErrorBoundary label="Trends">
              <TrendsTab />
            </ErrorBoundary>
          )}
          {activeTab === "heatmap" && (
            <ErrorBoundary label="Heatmap">
              <HeatmapTab />
            </ErrorBoundary>
          )}
          {activeTab === "fundamentals" && (
            <ErrorBoundary label="Fundamentals">
              <FundamentalsIntelTab themes={themes} isLoading={isLoading} />
            </ErrorBoundary>
          )}
          {activeTab === "insights" && (
            <InsightsTab themes={themes} accelerating={accelerating} fading={fading} isLoading={isLoading} />
          )}
        </div>
      </main>
    </div>
  );
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode; label: string },
  { error: Error | null }
> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center rounded-lg py-16 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <h3 className="font-['Syne',sans-serif] text-lg font-semibold text-foreground mb-1">{this.props.label} Error</h3>
          <p className="text-sm text-muted-foreground">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function PlaceholderTab({ label, description }: { label: string; description: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg py-20 text-center"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(12px)",
      }}
    >
      <h3 className="font-['Syne',sans-serif] text-lg font-semibold text-foreground mb-1">{label}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
