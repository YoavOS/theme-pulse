import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  type ClassifierResponse,
  getClassificationStatus,
  hasRunnableWork,
  isClassifierRunning,
  onClassificationStatus,
  retryFailedClassifications,
  runClassification,
} from "@/lib/classification";

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * One compact line next to the Group-by toggle:
 * "94% classified · Classify" — hover for the full breakdown.
 */
export default function ClassificationCoverage({ onUpdated }: { onUpdated?: () => void }) {
  const [res, setRes] = useState<ClassifierResponse | null>(null);
  const [running, setRunning] = useState(isClassifierRunning());

  useEffect(() => {
    const off = onClassificationStatus((r) => {
      setRes(r);
      setRunning(isClassifierRunning());
    });
    if (!isClassifierRunning()) getClassificationStatus().then(setRes).catch(() => undefined);
    return off;
  }, []);

  const s = res?.status;

  const start = async () => {
    setRunning(true);
    try {
      if (s && !hasRunnableWork(s) && s.failed > 0) await retryFailedClassifications();
      await runClassification();
      onUpdated?.();
    } finally {
      setRunning(false);
    }
  };

  if (res && !res.ok && !running) {
    return (
      <span className="text-[11px] text-muted-foreground" title={res.error ?? ""}>
        · {res.setupNeeded ? "Industry classification: database not set up yet" : "Industry classification unavailable"}
      </span>
    );
  }
  if (!s) return null;

  const pct = s.total > 0 ? Math.floor((s.done / s.total) * 100) : 0;
  const waiting = s.pending + s.needs_av + s.needs_ai;
  const breakdown = [
    `${fmt(s.done)} of ${fmt(s.total)} tickers classified`,
    s.pending ? `${fmt(s.pending)} in queue` : null,
    s.needs_av
      ? s.avKeyConfigured
        ? `${fmt(s.needs_av)} waiting for Alpha Vantage (${s.avUsedToday}/${s.avDailyCap} used today — continues daily)`
        : `${fmt(s.needs_av)} waiting (no Alpha Vantage key found)`
      : null,
    s.needs_ai ? `${fmt(s.needs_ai)} waiting for AI fallback` : null,
    s.failed ? `${fmt(s.failed)} not found in any source` : null,
  ].filter(Boolean).join("\n");

  const canRun = hasRunnableWork(s) || s.failed > 0;
  const label = running
    ? "Classifying…"
    : hasRunnableWork(s) ? "Classify" : s.failed > 0 && waiting === 0 ? `Retry ${fmt(s.failed)}` : null;

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground" title={breakdown}>
      <span>
        · {pct}% classified{running && ` (${fmt(s.done)}/${fmt(s.total)})`}
      </span>
      {label && canRun && (
        <button
          type="button"
          onClick={start}
          disabled={running}
          className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-foreground/80 hover:bg-accent disabled:opacity-60"
          title={running ? "Keep this page open while it runs" : breakdown}
        >
          {running && <Loader2 size={10} className="animate-spin" />}
          {label}
        </button>
      )}
    </span>
  );
}
