import { useEffect, useState } from "react";
import { Loader2, X, BarChart3 } from "lucide-react";
import { useFundamentalsScan, FundamentalsCoverage } from "@/hooks/useFundamentalsScan";

const METRIC_LABELS: Record<string, string> = {
  eps_ttm_yoy: "EPS Growth (TTM YoY)",
  eps_annual_yoy: "EPS Growth (Annual YoY)",
  eps_quarterly_yoy: "EPS Growth (Quarterly YoY)",
  eps_quarterly_qoq: "EPS Growth (Quarterly QoQ)",
  revenue_ttm_yoy: "Revenue Growth (TTM YoY)",
  revenue_annual_yoy: "Revenue Growth (Annual YoY)",
  revenue_quarterly_yoy: "Revenue Growth (Quarterly YoY)",
  revenue_quarterly_qoq: "Revenue Growth (Quarterly QoQ)",
  pe_ratio: "P/E Ratio",
  forward_pe: "Forward P/E",
  peg_ratio: "PEG Ratio",
  ps_ratio: "P/S Ratio",
  pb_ratio: "P/B Ratio",
  gross_margin: "Gross Margin",
  net_margin: "Net Margin",
  operating_margin: "Operating Margin",
  roe: "Return on Equity",
  roa: "Return on Assets",
  debt_to_equity: "Debt / Equity",
  current_ratio: "Current Ratio",
};

function pctColor(pct: number): string {
  if (pct >= 80) return "bg-[hsl(160,70%,50%)]";
  if (pct >= 50) return "bg-[hsl(45,90%,55%)]";
  if (pct >= 25) return "bg-[hsl(25,85%,55%)]";
  return "bg-destructive";
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function FundamentalsCoverageModal({ open, onClose }: Props) {
  const { fetchCoverage } = useFundamentalsScan();
  const [data, setData] = useState<FundamentalsCoverage | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchCoverage().then((d) => {
      setData(d);
      setLoading(false);
    });
  }, [open, fetchCoverage]);

  if (!open) return null;

  // Sort metrics by coverage % desc
  const entries = data
    ? Object.entries(data.coverage).sort((a, b) => b[1].pct - a[1].pct)
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Fundamentals Coverage</h2>
            {data && (
              <span className="text-xs text-muted-foreground">
                · {data.total.toLocaleString()} stocks scanned
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto p-4" style={{ maxHeight: "calc(85vh - 56px)" }}>
          {loading && (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 size={16} className="mr-2 animate-spin" />
              Calculating coverage…
            </div>
          )}
          {!loading && data && data.total === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No fundamentals data yet. Run the scan first.
            </p>
          )}
          {!loading && data && data.total > 0 && (
            <>
              <p className="mb-3 text-[11px] text-muted-foreground">
                Percentage of the {data.total.toLocaleString()} scanned tickers for which each metric was successfully pulled
                from <strong>Yahoo Finance + Finnhub</strong>. Use this to decide which growth filters to add to the RS Alpha scanner.
              </p>
              <div className="space-y-1.5">
                {entries.map(([key, val]) => (
                  <div key={key} className="grid grid-cols-[1fr_60px_50px] items-center gap-2 text-xs">
                    <div className="text-foreground">{METRIC_LABELS[key] ?? key}</div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full ${pctColor(val.pct)} transition-all`}
                        style={{ width: `${val.pct}%` }}
                      />
                    </div>
                    <div className="text-right font-mono text-muted-foreground">
                      {val.pct.toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
