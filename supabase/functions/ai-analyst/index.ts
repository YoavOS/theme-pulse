// ai-analyst — the app's AI analyst. Runs on the local model first (Ollama on your PC), then the free
// cloud keys if the local one is off. It reads the app's own data; it never changes anything.
//
//   POST { action: "ask", question, history?, state?, lang? }
//        Ask-your-data chat. The model may look things up (read-only SQL, stock profiles, the market
//        digest) over several rounds. Each call works for at most ~100 s; if it isn't finished it
//        returns { done:false, state } and the page calls again with that state.
//   POST { action: "stock", symbol, lang? }          one-stock analysis from everything the app knows
//   POST { action: "focus", blocks, lang? }          review of the focus list (blocks = the organizer's groups)
//   POST { action: "report", lang? }                 write tonight's market report and save it (ai_reports)
//   POST { action: "latest", kind?, lang? }          the newest saved report
//   POST { action: "status" }                        which model is answering
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { extractJson, hasAnyLlm, llmFetch } from "../_shared/llm.ts";
import { DATA_GUIDE, headlines, langLine, liveColumns, marketDigest, sql, stockProfile } from "../_shared/aiData.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const today = () => new Date().toISOString().slice(0, 10);
const clip = (v: unknown, n: number) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + " …(cut)" : s; };

const STYLE = `House rules: you are a careful market analyst working for one private trader (momentum / Weinstein stages / bases, learning fundamentals).
Use only the data you are given or look up; say plainly when something is missing or stale. Never invent numbers.
Describe what the data shows (strength, stage, setup, risk) — do not tell the reader to buy or sell, and no price targets.
Markdown: short headed sections and bullets, tickers in **bold**. Be concrete and brief.`;

async function chat(messages: any[], opts: { task?: "long" | "fast"; label: string; tools?: any[]; maxTokens?: number }) {
  const res = await llmFetch({
    model: "openai/gpt-oss-120b", reasoning_effort: "low", temperature: 0.3, max_tokens: opts.maxTokens ?? 2500,
    messages, ...(opts.tools ? { tools: opts.tools, tool_choice: "auto" } : {}),
  }, { task: opts.task ?? "long", label: opts.label });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error?.message ?? `AI error ${res.status}`);
  return { msg: j.choices?.[0]?.message ?? {}, provider: j.provider as string, model: j.model as string };
}

// ---------------------------------------------------------------- ask your data
const TOOLS = [
  { type: "function", function: { name: "run_sql", description: "Run one read-only PostgreSQL SELECT on the app's database. Returns up to 100 rows as JSON. Always add a LIMIT and only the columns you need.",
    parameters: { type: "object", properties: { query: { type: "string" }, why: { type: "string", description: "one short line: what this query checks" } }, required: ["query"] } } },
  { type: "function", function: { name: "stock_profile", description: "Everything the app knows about one stock: RS, returns, stage, base/setup, breakouts, growth scores, 10-year track record, fundamentals, insiders, strongest industry peers.",
    parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } } },
  { type: "function", function: { name: "market_digest", description: "Today's market overview: index stages, stage breadth, strongest/weakest industries, new stage 2s, breakouts, bases near pivot, RS-line highs, themes.",
    parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "table_columns", description: "The exact column names of the main tables (use if a query failed on a column name).",
    parameters: { type: "object", properties: {} } } },
];

async function runTool(sb: any, name: string, args: any): Promise<{ result: string; step: any }> {
  try {
    if (name === "run_sql") {
      const rows = await sql(sb, String(args.query ?? ""), 100);
      return { result: clip(rows, 14000), step: { tool: name, why: args.why ?? null, sql: args.query, rows: rows.length } };
    }
    if (name === "stock_profile") return { result: clip(await stockProfile(sb, args.symbol), 12000), step: { tool: name, symbol: args.symbol } };
    if (name === "market_digest") return { result: clip(await marketDigest(sb), 16000), step: { tool: name } };
    if (name === "table_columns") return { result: clip(await liveColumns(sb), 8000), step: { tool: name } };
    return { result: `Unknown tool ${name}`, step: { tool: name, error: "unknown" } };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { result: `ERROR: ${m}. Fix the query and try again.`, step: { tool: name, sql: args?.query, error: m } };
  }
}

async function ask(sb: any, body: any) {
  const started = Date.now();
  const BUDGET = 100_000;
  let state: any[] = Array.isArray(body.state) ? body.state : [];
  const steps: any[] = [];
  if (!state.length) {
    const q = String(body.question ?? "").trim().slice(0, 2000);
    if (!q) return json({ error: "question required" }, 400);
    const history = (Array.isArray(body.history) ? body.history : []).slice(-8)
      .map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "").slice(0, 3000) }));
    state = [
      { role: "system", content: `${STYLE}\n\n${DATA_GUIDE}\n\nToday is ${today()}. Look things up with the tools before answering; prefer one good query over many.
When you have enough, answer the question directly. Reply in the language the question is written in (Hebrew question → Hebrew answer).` },
      ...history, { role: "user", content: q },
    ];
  }
  let provider = "", model = "";
  for (let round = 0; round < 8; round++) {
    const last = round === 7;
    const r = await chat(state, { label: "ai-ask", tools: last ? undefined : TOOLS, maxTokens: 3000 });
    provider = r.provider; model = r.model;
    const calls = r.msg.tool_calls ?? [];
    if (!calls.length) return json({ done: true, answer: r.msg.content ?? "", steps, provider, model });
    state.push({ role: "assistant", content: r.msg.content ?? "", tool_calls: calls });
    for (const c of calls) {
      let args: any = {};
      try { args = typeof c.function?.arguments === "string" ? JSON.parse(c.function.arguments || "{}") : (c.function?.arguments ?? {}); } catch { /* bad args */ }
      const t = await runTool(sb, c.function?.name, args);
      steps.push(t.step);
      state.push({ role: "tool", tool_call_id: c.id, name: c.function?.name, content: t.result });
    }
    if (Date.now() - started > BUDGET) return json({ done: false, state, steps, provider, model });
  }
  state.push({ role: "user", content: "Answer now with what you have." });
  const r = await chat(state, { label: "ai-ask" });
  return json({ done: true, answer: r.msg.content ?? "", steps, provider: r.provider, model: r.model });
}

// ---------------------------------------------------------------- one stock
async function stock(sb: any, body: any) {
  const symbol = String(body.symbol ?? "").toUpperCase().trim();
  if (!symbol) return json({ error: "symbol required" }, 400);
  const lang = body.lang === "he" ? "he" : "en";
  const [profile, news] = await Promise.all([stockProfile(sb, symbol), headlines(symbol)]);
  const r = await chat([
    { role: "system", content: `${STYLE}\n${langLine(lang)}` },
    { role: "user", content: `Analyse ${symbol} for me from the app's data below. Sections:
1. The picture in two sentences.
2. Trend & strength — stage, RS, returns, where it sits against its industry peers.
3. Setup — base / pivot / breakout state, distance to pivot, stop risk, earnings date.
4. The business — growth, margins, the 10-year track record (explain the label in plain words; I'm learning fundamentals).
5. News — what the headlines suggest, if anything.
6. What to watch — the 3 facts that would change the picture, and the main risks.
Data (JSON):\n${clip(profile, 14000)}\nHeadlines:\n${clip(news, 3000)}` },
  ], { label: "ai-stock", maxTokens: 2500 });
  const content = r.msg.content ?? "";
  await sb.from("ai_reports").insert({ kind: "stock", day: today(), lang, subject: symbol, title: `${symbol} analysis`, content, data: profile, model: `${r.provider}/${r.model}` });
  return json({ content, data: profile, provider: r.provider, model: r.model });
}

// ---------------------------------------------------------------- focus list
async function focus(sb: any, body: any) {
  const lang = body.lang === "he" ? "he" : "en";
  const blocks: any[] = Array.isArray(body.blocks) ? body.blocks.slice(0, 30) : [];
  const symbols = [...new Set(blocks.flatMap((b) => (Array.isArray(b.symbols) ? b.symbols : [])).map((s: any) => String(s).toUpperCase().replace(/[^A-Z0-9.\-]/g, "")).filter(Boolean))].slice(0, 120);
  if (!symbols.length) return json({ error: "the focus list is empty" }, 400);
  const list = symbols.map((s) => `'${s}'`).join(",");
  const rows = await sql(sb, `select u.symbol, u.sector, round(u.rs_overall::numeric,1) rs, u.return_1w, u.return_1m, u.adr_percent,
    s.stage, s.substage, s.weeks_in_stage, b.state base_state, b.primary_label, b.score base_score, b.dist_to_pivot, b.stop_risk, b.earnings_date,
    p.label track_record, sp.current_score growth_score
    from qualified_rs_universe u left join stock_stages s using (symbol) left join stock_bases b using (symbol)
    left join proven_strength p using (symbol) left join superperformance_stocks sp using (symbol) where u.symbol in (${list})`, 150).catch(() => []);
  const industries = await sql(sb, `select u.sector industry, round(avg(u.rs_overall)::numeric,1) avg_rs, round(100.0*avg((s.stage = 2)::int),0) pct_stage2
    from qualified_rs_universe u left join stock_stages s using (symbol) where u.sector in (select sector from qualified_rs_universe where symbol in (${list}))
    group by 1`, 60).catch(() => []);
  const missing = symbols.filter((s) => !rows.some((r: any) => r.symbol === s));
  const r = await chat([
    { role: "system", content: `${STYLE}\n${langLine(lang)}` },
    { role: "user", content: `Review my focus list. Groups as I organised them:\n${clip(blocks.map((b) => ({ group: b.title ?? b.name, symbols: b.symbols, notes: Array.isArray(b.notes) ? b.notes.slice(0, 20) : undefined })), 6000)}
Each stock's data:\n${clip(rows, 14000)}\nTheir industries:\n${clip(industries, 4000)}\nNot in the universe (no data): ${missing.join(", ") || "none"}
Sections: 1) The list in a sentence (how strong, how concentrated). 2) Strongest setups now — closest to a pivot with a tight stop and a strong stage/RS.
3) Weak spots — stocks whose stage, RS or base has broken down, or earnings within ~2 weeks. 4) Concentration — industries/themes over-represented, and strong industries missing.
5) Housekeeping — names to consider moving between groups or dropping from focus, with the one-line reason from the data. No buy/sell instructions.` },
  ], { label: "ai-focus", maxTokens: 2500 });
  const content = r.msg.content ?? "";
  await sb.from("ai_reports").insert({ kind: "focus", day: today(), lang, subject: "focus", title: "Focus list review", content, data: { symbols, rows }, model: `${r.provider}/${r.model}` });
  return json({ content, provider: r.provider, model: r.model });
}

// ---------------------------------------------------------------- nightly report
async function report(sb: any, body: any) {
  const lang = body.lang === "he" ? "he" : "en";
  // reuse today's digest if the other language already gathered it
  const { data: prev } = await sb.from("ai_reports").select("data").eq("kind", "market").eq("day", today()).limit(1).maybeSingle();
  const digest = prev?.data && !body.fresh ? prev.data : await marketDigest(sb);
  const r = await chat([
    { role: "system", content: `${STYLE}\n${langLine(lang)}` },
    { role: "user", content: `Write tonight's market report for ${today()} from the app's data below.
Sections: 1) The market in three sentences (index stages, breadth: how much of the universe is in stage 2 vs 4).
2) Leadership — the strongest industries and themes, and whether leadership is broadening or narrowing.
3) New strength — fresh stage 2 entries, RS-line new highs, the best breakouts of the week (with relative volume).
4) Setups to study — bases near their pivot (label, distance to pivot, stop risk); point out proven-strong businesses among them.
5) Warnings — new stage 4s, weak industries, failed breakouts.
6) One thing to watch tomorrow.
Keep it under ~600 words. Data (JSON):\n${clip(digest, 24000)}` },
  ], { label: "ai-report", maxTokens: 3000 });
  const content = r.msg.content ?? "";
  if (!content.trim()) return json({ error: "empty report" }, 502);
  await sb.from("ai_reports").delete().eq("kind", "market").eq("day", today()).eq("lang", lang);
  await sb.from("ai_reports").insert({ kind: "market", day: today(), lang, subject: "market", title: lang === "he" ? `דוח שוק ${today()}` : `Market report ${today()}`, content, data: digest, model: `${r.provider}/${r.model}` });
  return json({ ok: true, lang, provider: r.provider, model: r.model, chars: content.length });
}

// ---------------------------------------------------------------- one line per stock in Today's list
async function lines(sb: any, body: any) {
  const lang = body.lang === "he" ? "he" : "en";
  const col = lang === "he" ? "ai_line_he" : "ai_line";
  const { data: last } = await sb.from("today_list").select("day").order("day", { ascending: false }).limit(1).maybeSingle();
  if (!last) return json({ ok: true, note: "no lists yet" });
  const { data: rows } = await sb.from("today_list").select("list, symbol, rank, grp, evidence").eq("day", last.day).lte("rank", 15).order("rank");
  const todo = (rows ?? []).filter((r: any) => r.list !== "redday_group" || r.rank <= 8);
  if (!todo.length) return json({ ok: true, day: last.day, written: 0 });
  const r = await chat([
    { role: "system", content: `${STYLE}\n${langLine(lang)}\nReply with JSON only.` },
    { role: "user", content: `For each item below write ONE short line (max ~25 words) for a momentum trader: why it is on this list, using its numbers, and the one thing that would cancel the idea.
Lists: ema21 = pullback to the daily 21 EMA after a big run (run % from the EMA at its last touch to the peak; distAdr = distance from the EMA in average daily ranges; volDryUp < 1 means volume is lighter than during the run).
redday = stock bought on red market days (bought of redDays; avgExcessOnRedDays = points better than SPY on those days). redday_group = an industry/theme bought on red days.
Return {"items":[{"list":"...","symbol":"...","line":"..."}]}.
Items:\n${clip(todo.map((t: any) => ({ list: t.list, symbol: t.symbol, group: t.grp, ...t.evidence })), 20000)}` },
  ], { task: "fast", label: "ai-lines", maxTokens: 4000 });
  let items: any[] = [];
  try { items = JSON.parse(extractJson(r.msg.content ?? "")).items ?? []; } catch { return json({ error: "the AI didn't return the lines as JSON" }, 502); }
  let written = 0;
  for (const it of items) {
    if (!it?.symbol || !it?.line) continue;
    const { error } = await sb.from("today_list").update({ [col]: String(it.line).slice(0, 400) }).eq("day", last.day).eq("list", it.list).eq("symbol", it.symbol);
    if (!error) written++;
  }
  return json({ ok: true, day: last.day, lang, written, provider: r.provider, model: r.model });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const sb = createClient(SB_URL, SB_KEY);
    const action = String(body.action ?? "ask");
    if (action === "latest") {
      let q = sb.from("ai_reports").select("id, kind, day, lang, subject, title, content, model, created_at").eq("kind", body.kind ?? "market");
      if (body.lang) q = q.eq("lang", body.lang);
      if (body.subject) q = q.eq("subject", String(body.subject).toUpperCase());
      const { data, error } = await q.order("created_at", { ascending: false }).limit(body.limit ?? 1);
      if (error) throw new Error(error.message);
      return json({ reports: data ?? [] });
    }
    if (action === "status") {
      const url = (Deno.env.get("LOCAL_LLM_URL") ?? "").replace(/\/+$/, "");
      let local: any = { configured: !!url };
      if (url) {
        try {
          const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(4000) });
          const j = await r.json();
          local = { configured: true, reachable: true, model: Deno.env.get("LOCAL_LLM_MODEL") || "qwen3.8:27b", installed: (j.models ?? []).map((m: any) => m.name) };
        } catch (e) { local = { configured: true, reachable: false, error: e instanceof Error ? e.message : String(e) }; }
      }
      return json({ local, cloudFallback: !!(Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GROQ_API_KEY")) });
    }
    if (!hasAnyLlm()) return json({ error: "No AI is set up: start Ollama on the PC or add a GEMINI/GROQ key." }, 503);
    if (action === "ask") return await ask(sb, body);
    if (action === "stock") return await stock(sb, body);
    if (action === "focus") return await focus(sb, body);
    if (action === "report") return await report(sb, body);
    if (action === "lines") return await lines(sb, body);
    return json({ error: `unknown action ${action}` }, 400);
  } catch (e) {
    console.error("[ai-analyst]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
