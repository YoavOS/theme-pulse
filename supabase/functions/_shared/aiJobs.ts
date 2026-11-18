// Long AI calls on the PC model without the backend's ~1-minute request limit: the prompt is handed to the
// database (ai_job_submit → pg_net → Ollama, up to 15 minutes) and the answer is "finished" later — when the
// page polls { action: "job", id } or when the once-a-minute collector calls { action: "finish", job }.
// Without the PC model (or if it isn't set up) the same call runs right away on the free cloud keys.
// deno-lint-ignore-file no-explicit-any
import { fromOllama, llmFetch, localConfigured, localModelName, toOllamaRequest, type LlmTask } from "./llm.ts";

export type Finisher = (sb: any, params: any, msg: any, model: string) => Promise<any>;

/** Run now on the cloud keys, or queue on the PC model. Returns { job } when queued, else the finisher's output. */
export async function runAi(sb: any, fn: string, kind: string, params: any, body: any, finish: Finisher, opts: { task?: LlmTask; label: string }) {
  if (localConfigured()) {
    const { data: id, error } = await sb.rpc("ai_job_submit", { p_fn: fn, p_kind: kind, p_params: params ?? {}, p_request: toOllamaRequest(body) });
    if (!error && id) return { job: id as number };
    if (error) console.error(`[aiJobs] submit failed, using the cloud keys: ${error.message}`);
  }
  const res = await llmFetch(body, { task: opts.task ?? "long", label: opts.label, skipLocal: true });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error?.message ?? `AI error ${res.status}`);
  return await finish(sb, params, j.choices?.[0]?.message ?? {}, `${j.provider}/${j.model}`);
}

/** Finish an answered job (if it is ready and nobody else has), then report its state. */
export async function jobState(sb: any, id: number, finishers: Record<string, Finisher>) {
  const { data: claimed } = await sb.rpc("ai_job_claim", { p_id: id });
  const row = Array.isArray(claimed) ? claimed[0] : claimed;
  if (row) {
    try {
      const f = finishers[row.kind];
      if (!f) throw new Error(`no finisher for ${row.kind}`);
      const msg = fromOllama(row.response ?? {});
      if (!msg.content && !msg.tool_calls?.length) throw new Error("the PC model returned an empty answer");
      const output = await f(sb, row.params, msg, `local/${row.request?.model ?? localModelName()}`);
      await sb.from("ai_jobs").update({ status: "done", output, finished_at: new Date().toISOString() }).eq("id", id);
    } catch (e) {
      await sb.from("ai_jobs").update({ status: "error", error: e instanceof Error ? e.message : String(e), finished_at: new Date().toISOString() }).eq("id", id);
    }
  }
  const { data } = await sb.from("ai_jobs").select("id, status, output, error, created_at").eq("id", id).maybeSingle();
  return data ?? { id, status: "error", error: "unknown job" };
}
