import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const LAST_READ_KEY = "alertsLastRead";

export function useUnreadAlertCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const lastRead = localStorage.getItem(LAST_READ_KEY);
    let q = supabase
      .from("alert_history" as any)
      .select("id", { count: "exact", head: true });

    if (lastRead) {
      q = q.gt("triggered_at", lastRead);
    }

    q.then(({ count: c }) => {
      setCount(c || 0);
    });
  }, []);

  return count;
}
