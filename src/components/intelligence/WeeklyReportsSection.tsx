import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, ChevronDown, ChevronUp, X, FileText } from "lucide-react";
import { toast } from "sonner";

const DM_MONO = "'DM Mono', monospace";

interface WeeklyReport {
  id: string;
  week_ending: string;
  narrative: string;
  top_themes: any[];
  bottom_themes: any[];
  biggest_reversals: any[];
  volume_anomalies: any[];
  generated_at: string;
}

export default function WeeklyReportsSection() {
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    const { data, error } = await supabase
      .from("weekly_reports")
      .select("*")
      .order("week_ending", { ascending: false })
      .limit(20);

    if (error) {
      console.error("Failed to fetch weekly reports:", error);
    } else {
      setReports((data as unknown as WeeklyReport[]) || []);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // Determine if current week already has a report
  const now = new Date();
  const day = now.getDay();
  const fridayOffset = day === 0 ? 2 : day === 6 ? 1 : day === 5 ? 0 : day + 2;
  const friday = new Date(now);
  friday.setDate(friday.getDate() - fridayOffset);
  const currentFriday = friday.toISOString().split("T")[0];
  const existingReport = reports.find(r => r.week_ending === currentFriday);

  const generateReport = useCallback(async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-weekly-report", {
        body: { week_ending: currentFriday },
      });

      if (error) {
        const msg = error.message || "Failed to generate weekly report";
        toast.error(msg);
        console.error("Weekly report error:", error);
      } else if (data?.error) {
        toast.error(data.error);
      } else {
        toast.success(`Weekly report generated for week ending ${currentFriday}`);
        await fetchReports();
      }
    } catch (err) {
      toast.error("Network error generating report");
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  }, [currentFriday, fetchReports]);

  const deleteReport = useCallback(async (id: string) => {
    const { error } = await supabase.from("weekly_reports").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete report");
    } else {
      setReports(prev => prev.filter(r => r.id !== id));
      setDeleteConfirm(null);
      toast.success("Report deleted");
    }
  }, []);

  return (
    <div
      className="rounded-lg p-5"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FileText size={15} className="text-muted-foreground" />
          <h3 className="font-['Syne',sans-serif] text-sm font-semibold text-foreground">
            Weekly Reports
          </h3>
        </div>
        <button
          onClick={generateReport}
          disabled={isGenerating}
          className="flex items-center gap-1.5 rounded-md border border-[hsl(var(--primary))]/30 bg-[hsl(var(--primary))]/10 px-3 py-1.5 text-xs font-medium text-[hsl(var(--primary))] transition-colors hover:bg-[hsl(var(--primary))]/20 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw size={12} className={isGenerating ? "animate-spin" : ""} />
          {isGenerating
            ? "Generating…"
            : existingReport
            ? "Regenerate Weekly Report"
            : "Generate Weekly Report"}
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : reports.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No weekly reports yet — first report generates automatically after Friday EOD save
        </p>
      ) : (
        <div className="space-y-2">
          {reports.map(report => {
            const isExpanded = expandedId === report.id;
            const firstSentence = report.narrative.split(/[.!?]\s/)[0] + ".";

            return (
              <div
                key={report.id}
                className="rounded-lg overflow-hidden transition-all"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                {/* Header row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : report.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                >
                  <span
                    className="shrink-0 text-xs font-medium text-muted-foreground"
                    style={{ fontFamily: DM_MONO }}
                  >
                    Week ending {report.week_ending}
                  </span>
                  <span className="flex-1 text-xs text-muted-foreground truncate">
                    {firstSentence}
                  </span>
                  {isExpanded ? (
                    <ChevronUp size={14} className="shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                  )}
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="px-4 pb-4">
                    <p
                      className="font-['Syne',sans-serif] text-foreground mb-3"
                      style={{ fontSize: "14px", lineHeight: 1.8 }}
                    >
                      {report.narrative}
                    </p>
                    <div className="flex items-center justify-between">
                      <span
                        className="text-[10px] text-muted-foreground"
                        style={{ fontFamily: DM_MONO }}
                      >
                        Generated {new Date(report.generated_at).toLocaleString()}
                      </span>
                      {deleteConfirm === report.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-destructive">Delete?</span>
                          <button
                            onClick={() => deleteReport(report.id)}
                            className="text-[10px] text-destructive font-medium hover:underline"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="text-[10px] text-muted-foreground hover:underline"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(report.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
