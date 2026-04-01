import { Calendar, Loader2, X, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useEodRoutine } from "@/hooks/useEodRoutine";
import { ThemeData } from "@/data/themeData";

interface EodRoutineButtonProps {
  onDashboardUpdate?: (themes: ThemeData[], timeframe: string) => void;
  buildThemesFromPerf?: (timeframe: string) => Promise<ThemeData[]>;
}

export function EodRoutineButton({ onDashboardUpdate, buildThemesFromPerf }: EodRoutineButtonProps) {
  const {
    state,
    isEnabled,
    isWeekend,
    buttonLabel,
    tooltip,
    targetDate,
    openConfirmDialog,
    closeConfirmDialog,
    runRoutine,
    dismissSummary,
  } = useEodRoutine(onDashboardUpdate, buildThemesFromPerf);

  const { isRunning, steps, progress, summary, showConfirmDialog, lastCompletedToday, currentStep, totalSteps } = state;

  const displayDate = new Date(targetDate + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  // Running: show progress card
  if (isRunning) {
    const currentStepData = steps.find(s => s.status === "running");
    const completedSteps = steps.filter(s => s.status === "done");

    return (
      <div className="flex flex-col gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 min-w-[260px]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-primary">📅 EOD Routine Running</span>
          <span className="text-[10px] text-muted-foreground">Step {currentStep} of {totalSteps}</span>
        </div>
        
        <Progress value={progress} className="h-1.5" />
        
        {currentStepData && (
          <div className="flex items-center gap-1.5 text-xs text-foreground">
            <Loader2 size={12} className="animate-spin text-primary" />
            <span>{currentStepData.emoji} Step {currentStepData.id}/{totalSteps} — {currentStepData.label}</span>
            {currentStepData.detail && (
              <span className="text-muted-foreground">· {currentStepData.detail}</span>
            )}
          </div>
        )}

        {completedSteps.length > 0 && (
          <div className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
            {completedSteps.slice(-3).map(step => (
              <div key={step.id} className="flex items-center gap-1">
                <Check size={10} className="text-gain-medium" />
                <span>{step.emoji} {step.label}</span>
                {step.detail && <span className="text-muted-foreground/70">({step.detail})</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Completed: show summary card
  if (summary) {
    const totalAlerts = summary.volumeAlerts + summary.momentumAlerts + summary.watchlistAlerts;

    return (
      <div className="relative flex flex-col gap-1.5 rounded-lg border border-[hsl(174,80%,50%)]/30 bg-[hsl(174,80%,50%)]/5 px-3 py-2 min-w-[300px]">
        <button
          onClick={dismissSummary}
          className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X size={12} />
        </button>

        <div className="flex items-center gap-1.5 text-xs font-semibold text-[hsl(174,80%,50%)]">
          <Check size={14} />
          EOD Routine Complete — {displayDate}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-muted-foreground border-t border-border/50 pt-1.5 mt-0.5">
          <div>📡 {summary.tickersScanned} tickers scanned</div>
          <div>💾 {summary.eodPricesSaved} EOD prices saved</div>
          <div>📊 {summary.themesBreadthRecorded} themes breadth recorded</div>
          <div>📈 Dispersion: {summary.dispersionScore.toFixed(1)}σ ({summary.dispersionLabel})</div>
          <div>⚡ {summary.volumeAlerts} volume alerts fired</div>
          <div>🚀 {summary.momentumAlerts} momentum alerts fired</div>
          <div>🔔 {summary.watchlistAlerts} watchlist alerts fired</div>
          <div>📰 News refreshed for {summary.newsRefreshed} themes</div>
          {summary.weeklyReportGenerated && <div>🗞 Weekly report generated</div>}
        </div>

        {summary.failedSteps.length > 0 && (
          <div className="flex items-center gap-1 text-[10px] text-destructive border-t border-border/50 pt-1 mt-0.5">
            <AlertTriangle size={10} />
            Failed: {summary.failedSteps.join(", ")}
          </div>
        )}

        <div className="text-[10px] text-muted-foreground/70 border-t border-border/50 pt-1 mt-0.5">
          Total time: {summary.elapsedTime}
        </div>
      </div>
    );
  }

  // Default: show button
  return (
    <>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={openConfirmDialog}
              disabled={!isEnabled}
              variant="outline"
              size="sm"
              className={`text-xs font-semibold transition-colors ${
                lastCompletedToday
                  ? "border-[hsl(174,80%,50%)]/40 bg-[hsl(174,80%,50%)]/10 text-[hsl(174,80%,50%)] hover:bg-[hsl(174,80%,50%)]/20"
                  : isEnabled
                  ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                  : "border-border bg-secondary/50 text-muted-foreground"
              }`}
            >
              <Calendar size={12} className="mr-1" />
              {buttonLabel}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs max-w-[200px]">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <AlertDialog open={showConfirmDialog} onOpenChange={(open) => !open && closeConfirmDialog()}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Calendar size={18} className="text-primary" />
              Run EOD Routine for {displayDate}?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>This will run a 15-step pipeline:</p>
              <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                <li>Full scan all tickers (identical to manual scan)</li>
                <li>Save EOD prices{isWeekend ? " (Friday close)" : ""}</li>
                <li>Update breadth, dispersion, volume analytics</li>
                <li>Check breadth, volume, momentum & watchlist alerts</li>
                <li>Update SPY benchmark & theme intelligence</li>
                <li>Generate AI narrative & refresh news (background)</li>
              </ul>
              <p className="text-sm text-muted-foreground mt-3">
                <strong>Estimated time:</strong> ~10 minutes
              </p>
              <p className="text-xs text-destructive/80 mt-2">
                ⚠ Cannot be cancelled once started
              </p>
              {lastCompletedToday && (
                <p className="text-xs text-[hsl(40,80%,50%)]">
                  Note: Routine was already run today at {lastCompletedToday.time}. Running again will overwrite today's data.
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={runRoutine}
              className="bg-[hsl(174,80%,50%)] text-[hsl(174,80%,10%)] hover:bg-[hsl(174,80%,45%)]"
            >
              Run Routine
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
