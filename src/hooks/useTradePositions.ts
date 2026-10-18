import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Position } from "@/lib/tradeDesk";

const LOCAL_KEY = "trade_desk_positions_v1";
const db = supabase as unknown as SupabaseClient;

function readLocal(): Position[] {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]") as Position[]; } catch { return []; }
}
function writeLocal(rows: Position[]) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(rows)); } catch { /* quota */ }
}
const num = (x: unknown) => (x === null || x === undefined ? null : Number(x));
const norm = (r: Record<string, unknown>): Position => ({
  id: String(r.id), symbol: String(r.symbol), entry_date: String(r.entry_date), entry_price: Number(r.entry_price), shares: Number(r.shares),
  initial_stop: Number(r.initial_stop), stop: num(r.stop), status: (r.status === "closed" ? "closed" : "open"),
  exit_date: r.exit_date ? String(r.exit_date) : null, exit_price: num(r.exit_price), notes: r.notes ? String(r.notes) : null,
});

/**
 * The user's positions: stored in the database when signed in (table trade_positions, own rows only),
 * otherwise in this browser.
 */
export function useTradePositions() {
  const { user, isLoading } = useAuth();
  const [rows, setRows] = useState<Position[]>([]);
  const [mode, setMode] = useState<"db" | "local">("local");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (isLoading) return;
    if (!user) { setMode("local"); setRows(readLocal()); return; }
    const { data, error: e } = await db.from("trade_positions").select("*").order("entry_date", { ascending: false });
    if (e) {
      // table not deployed yet → keep working locally
      setMode("local"); setRows(readLocal());
      setError(/does not exist|schema cache/i.test(e.message) ? null : e.message);
      return;
    }
    setMode("db"); setError(null);
    setRows((data ?? []).map((r) => norm(r as Record<string, unknown>)));
  }, [user, isLoading]);

  useEffect(() => { void load(); }, [load]);

  const add = useCallback(async (p: Omit<Position, "id">) => {
    if (mode === "db") {
      const { error: e } = await db.from("trade_positions").insert(p);
      if (e) throw e;
      await load();
    } else {
      const next = [{ ...p, id: crypto.randomUUID() }, ...readLocal()];
      writeLocal(next); setRows(next);
    }
  }, [mode, load]);

  const update = useCallback(async (id: string, patch: Partial<Position>) => {
    if (mode === "db") {
      const { error: e } = await db.from("trade_positions").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
      if (e) throw e;
      await load();
    } else {
      const next = readLocal().map((r) => (r.id === id ? { ...r, ...patch } : r));
      writeLocal(next); setRows(next);
    }
  }, [mode, load]);

  const remove = useCallback(async (id: string) => {
    if (mode === "db") {
      const { error: e } = await db.from("trade_positions").delete().eq("id", id);
      if (e) throw e;
      await load();
    } else {
      const next = readLocal().filter((r) => r.id !== id);
      writeLocal(next); setRows(next);
    }
  }, [mode, load]);

  return { rows, mode, error, signedIn: !!user, add, update, remove, reload: load };
}
