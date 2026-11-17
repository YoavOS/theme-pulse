import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Trial usage: every section of the AI tab counts how often it is opened or run, so after a few
 * weeks of testing we can see what is worth keeping, moving elsewhere in the app, or deleting.
 */
export interface LabUse { id: string; uses: number; first_used: string | null; last_used: string | null }
type Sb = { from: (t: string) => { select: (c: string) => Promise<{ data: LabUse[] | null }> }; rpc: (f: string, a: Record<string, unknown>) => Promise<{ error: unknown }> };
const sb = supabase as unknown as Sb;

export function useLabUsage() {
  return useQuery({
    queryKey: ["labs"],
    queryFn: async () => { const { data } = await sb.from("app_features").select("id, uses, first_used, last_used"); return new Map((data ?? []).map((r) => [r.id, r])); },
    staleTime: 60_000,
  });
}

/** Count one use (at most once a minute per section, so switching back and forth doesn't inflate it). */
const lastTouch = new Map<string, number>();
export function touchLab(id: string) {
  const now = Date.now();
  if ((lastTouch.get(id) ?? 0) > now - 60_000) return;
  lastTouch.set(id, now);
  sb.rpc("lab_touch", { fid: id }).then(() => undefined, () => undefined);
}
