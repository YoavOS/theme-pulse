import { supabase } from "@/integrations/supabase/client";

export type AlertType =
  | "breadth_surge"
  | "breadth_collapse"
  | "volume_spike"
  | "volume_dryup"
  | "momentum_breakout"
  | "momentum_fade"
  | "reversal"
  | "watchlist_perf"
  | "watchlist_relvol"
  | "streak_high"
  | "streak_low"
  | "new_5day_high"
  | "new_5day_low";

export type AlertSeverity = "high" | "medium" | "low";

export interface AlertInsert {
  date: string;
  theme_name: string;
  alert_type: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  value_before?: number;
  value_after?: number;
  threshold?: number;
  ticker_symbol?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Fire-and-forget insert into alert_history.
 * Never throws — failures are logged but don't block the caller.
 */
export async function persistAlert(alert: AlertInsert): Promise<void> {
  try {
    await supabase.from("alert_history" as any).insert(alert as any);
  } catch (err) {
    console.error("Failed to persist alert:", err);
  }
}

/**
 * Batch insert multiple alerts.
 */
export async function persistAlerts(alerts: AlertInsert[]): Promise<void> {
  if (alerts.length === 0) return;
  try {
    await supabase.from("alert_history" as any).insert(alerts as any);
  } catch (err) {
    console.error("Failed to persist alerts batch:", err);
  }
}
