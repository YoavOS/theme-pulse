import { isAwake } from "@/lib/appSleep";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * When the app is open and notifications are allowed (Today's list → Notify me), show one desktop
 * notification per new list day: how many 21 EMA pullbacks and red-day leaders it has. Checks every 30 minutes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const KEY = "today_list_notified_day";

export function useTodayListNotifier() {
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const check = async () => {
      if (!isAwake() || Notification.permission !== "granted") return;
      const { data: last } = await db.from("today_list").select("day").order("day", { ascending: false }).limit(1).maybeSingle();
      if (!last?.day) return;
      let seen = ""; try { seen = localStorage.getItem(KEY) ?? ""; } catch { /* ignore */ }
      if (seen >= last.day) return;
      const { data } = await db.from("today_list").select("list, symbol, rank, evidence").eq("day", last.day).order("rank");
      const rows = (data ?? []) as { list: string; symbol: string; evidence: { zone?: string } }[];
      const at = rows.filter((r) => r.list === "ema21" && r.evidence?.zone === "at").map((r) => r.symbol);
      const ema = rows.filter((r) => r.list === "ema21").length;
      const red = rows.filter((r) => r.list === "redday").slice(0, 5).map((r) => r.symbol);
      const n = new Notification(`Today's list · ${last.day}`, {
        body: `${ema} 21 EMA pullbacks${at.length ? ` (in your zone: ${at.slice(0, 6).join(", ")})` : ""}\nBought on red days: ${red.join(", ") || "none"}`,
        tag: "today-list",
      });
      n.onclick = () => { window.focus(); window.location.assign("/ai?tab=today"); };
      try { localStorage.setItem(KEY, last.day); } catch { /* ignore */ }
    };
    const t0 = window.setTimeout(check, 5000);
    const t = window.setInterval(check, 30 * 60_000);
    return () => { window.clearTimeout(t0); window.clearInterval(t); };
  }, []);
}
