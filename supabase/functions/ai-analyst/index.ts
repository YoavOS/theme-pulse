// ai-analyst — the app's AI analyst. Runs on the local model first (Ollama on your PC), then the free
// cloud keys if the local one is off. It reads the app's own data; it never changes anything.
//
//   POST { action: "ask", question, history?, state?, lang? }
//        Ask-your-data chat. The model may look things up (read-only SQL, stock profiles, the market
//        digest) over several rounds (one model call per round).
//   POST { action: "stock", symbol, lang? }          one-stock analysis from everything the app knows
//   POST { action: "focus", blocks, lang? }          review of the focus list (blocks = the organizer's groups)
//   POST { action: "report", lang? }                 write tonight's market report and save it (ai_reports)
//   POST { action: "latest", kind?, lang? }          the newest saved report
//   POST { action: "status" }                        which model is answering
//   POST { action: "job", id }                       state of a queued PC-model job: { status, output } (finishes it if answered)
//   POST { action: "finish", job }                   the database's collector: finish an answered job
// On the PC model every AI action returns { job } at once and the answer arrives through "job"; on the cloud keys
// it answers directly. See _shared/aiJobs.ts.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { extractJson, hasAnyLlm } from "../_shared/llm.ts";
import { jobState, runAi, type Finisher } from "../_shared/aiJobs.ts";
import { DATA_GUIDE, headlines, langLine, liveColumns, marketDigest, sql, stockProfile } from "../_shared/aiData.ts";
import { tradeContext } from "../_shared/journal.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const today = () => new Date().toISOString().slice(0, 10);
const clip = (v: unknown, n: number) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + " …(cut)" : s; };

const STYLE = `House rules: you are a careful market analyst working for one private trader (momentum / Weinstein stages / bases, learning fundamentals).
Use only the data you are given or look up; say plainly when something is missing or stale. Never invent numbers.
Describe what the data shows (strength, stage, setup, risk) — do not tell the reader to buy or sell, and no price targets.
Markdown: short headed sections and bullets, tickers in **bold**. Be concrete and brief.`;

const FIN: Record<string, Finisher> = {};
/** Send one model call: queued on the PC model (returns { job }) or answered now on the cloud keys (returns the finisher's output). */
function go(sb: any, kind: string, params: any, messages: any[], opts: { task?: "long" | "fast"; label: string; tools?: any[]; maxTokens?: number; json?: boolean }) {
  const body = {
    model: "openai/gpt-oss-120b", reasoning_effort: "low", temperature: 0.3, max_tokens: opts.maxTokens ?? 2500,
    messages, ...(opts.tools ? { tools: opts.tools, tool_choice: "auto" } : {}), ...(opts.json ? { response_format: { type: "json_object" } } : {}),
  };
  return runAi(sb, "ai-analyst", kind, params, body, FIN[kind], { task: opts.task, label: opts.label });
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
  return json(await go(sb, "ask", { state, steps, round: 0 }, state, { label: "ai-ask", tools: TOOLS, maxTokens: 3000 }));
}
FIN.ask = async (sb, params, msg, model) => {
  const state: any[] = params.state ?? [], steps: any[] = params.steps ?? [];
  const round = Number(params.round ?? 0);
  const calls = msg.tool_calls ?? [];
  if (!calls.length) return { done: true, answer: msg.content ?? "", steps, model };
  state.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });
  for (const c of calls) {
    let args: any = {};
    try { args = typeof c.function?.arguments === "string" ? JSON.parse(c.function.arguments || "{}") : (c.function?.arguments ?? {}); } catch { /* bad args */ }
    const t = await runTool(sb, c.function?.name, args);
    steps.push(t.step);
    state.push({ role: "tool", tool_call_id: c.id, name: c.function?.name, content: t.result });
  }
  const last = round >= 6;
  if (last) state.push({ role: "user", content: "Answer now with what you have." });
  const next: any = await go(sb, "ask", { state, steps, round: round + 1 }, state, { label: "ai-ask", tools: last ? undefined : TOOLS, maxTokens: 3000 });
  return next?.job ? { next: next.job, steps } : next;
};

// ---------------------------------------------------------------- one stock
async function stock(sb: any, body: any) {
  const symbol = String(body.symbol ?? "").toUpperCase().trim();
  if (!symbol) return json({ error: "symbol required" }, 400);
  const lang = body.lang === "he" ? "he" : "en";
  const [profile, news] = await Promise.all([stockProfile(sb, symbol), headlines(symbol)]);
  return json(await go(sb, "stock", { symbol, lang, profile }, [
    { role: "system", content: `${STYLE}\n${langLine(lang)}` },
    { role: "user", content: `Analyse ${symbol} for me from the app's data below. Sections:
1. The picture in two sentences.
2. Trend & strength — stage, RS, returns, where it sits against its industry peers.
3. Setup — base / pivot / breakout state, distance to pivot, stop risk, earnings date.
4. The business — growth, margins, the 10-year track record (explain the label in plain words; I'm learning fundamentals).
5. News — what the headlines suggest, if anything.
6. What to watch — the 3 facts that would change the picture, and the main risks.
Data (JSON):\n${clip(profile, 14000)}\nHeadlines:\n${clip(news, 3000)}` },
  ], { label: "ai-stock", maxTokens: 2500 }));
}
FIN.stock = async (sb, { symbol, lang, profile }, msg, model) => {
  const content = msg.content ?? "";
  await sb.from("ai_reports").insert({ kind: "stock", day: today(), lang, subject: symbol, title: `${symbol} analysis`, content, data: profile, model });
  return { content, model };
};

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
  return json(await go(sb, "focus", { lang, symbols, rows }, [
    { role: "system", content: `${STYLE}\n${langLine(lang)}` },
    { role: "user", content: `Review my focus list. Groups as I organised them:\n${clip(blocks.map((b) => ({ group: b.title ?? b.name, symbols: b.symbols, notes: Array.isArray(b.notes) ? b.notes.slice(0, 20) : undefined })), 6000)}
Each stock's data:\n${clip(rows, 14000)}\nTheir industries:\n${clip(industries, 4000)}\nNot in the universe (no data): ${missing.join(", ") || "none"}
Sections: 1) The list in a sentence (how strong, how concentrated). 2) Strongest setups now — closest to a pivot with a tight stop and a strong stage/RS.
3) Weak spots — stocks whose stage, RS or base has broken down, or earnings within ~2 weeks. 4) Concentration — industries/themes over-represented, and strong industries missing.
5) Housekeeping — names to consider moving between groups or dropping from focus, with the one-line reason from the data. No buy/sell instructions.` },
  ], { label: "ai-focus", maxTokens: 2500 }));
}
FIN.focus = async (sb, { lang, symbols, rows }, msg, model) => {
  const content = msg.content ?? "";
  await sb.from("ai_reports").insert({ kind: "focus", day: today(), lang, subject: "focus", title: "Focus list review", content, data: { symbols, rows }, model });
  return { content, model };
};

// ---------------------------------------------------------------- nightly report
async function report(sb: any, body: any) {
  const lang = body.lang === "he" ? "he" : "en";
  // reuse today's digest if the other language already gathered it
  const { data: prev } = await sb.from("ai_reports").select("data").eq("kind", "market").eq("day", today()).limit(1).maybeSingle();
  const digest = prev?.data && !body.fresh ? prev.data : await marketDigest(sb);
  return json(await go(sb, "report", { lang, digest, day: today() }, [
    { role: "system", content: `${STYLE}\n${langLine(lang)}` },
    { role: "user", content: `Write tonight's market report for ${today()} from the app's data below.
Sections: 1) The market in three sentences (index stages, breadth: how much of the universe is in stage 2 vs 4).
2) Leadership — the strongest industries and themes, and whether leadership is broadening or narrowing.
3) New strength — fresh stage 2 entries, RS-line new highs, the best breakouts of the week (with relative volume).
4) Setups to study — bases near their pivot (label, distance to pivot, stop risk); point out proven-strong businesses among them.
5) Warnings — new stage 4s, weak industries, failed breakouts.
6) One thing to watch tomorrow.
Keep it under ~600 words. Data (JSON):\n${clip(digest, 24000)}` },
  ], { label: "ai-report", maxTokens: 3000 }));
}
FIN.report = async (sb, { lang, digest, day }, msg, model) => {
  const content = msg.content ?? "";
  if (!content.trim()) throw new Error("empty report");
  await sb.from("ai_reports").delete().eq("kind", "market").eq("day", day).eq("lang", lang);
  await sb.from("ai_reports").insert({ kind: "market", day, lang, subject: "market", title: lang === "he" ? `דוח שוק ${day}` : `Market report ${day}`, content, data: digest, model });
  return { ok: true, lang, model, chars: content.length };
};

// ---------------------------------------------------------------- one line per stock in Today's list
async function lines(sb: any, body: any) {
  const lang = body.lang === "he" ? "he" : "en";
  const col = lang === "he" ? "ai_line_he" : "ai_line";
  const { data: last } = await sb.from("today_list").select("day").order("day", { ascending: false }).limit(1).maybeSingle();
  if (!last) return json({ ok: true, note: "no lists yet" });
  const { data: rows } = await sb.from("today_list").select("list, symbol, rank, grp, evidence").eq("day", last.day).lte("rank", 15).order("rank");
  const todo = (rows ?? []).filter((r: any) => r.list !== "redday_group" || r.rank <= 8);
  if (!todo.length) return json({ ok: true, day: last.day, written: 0 });
  return json(await go(sb, "lines", { day: last.day, lang, col }, [
    { role: "system", content: `${STYLE}\n${langLine(lang)}\nReply with JSON only.` },
    { role: "user", content: `For each item below write ONE short line (max ~25 words) for a momentum trader: why it is on this list, using its numbers, and the one thing that would cancel the idea.
Lists: ema21 = pullback to the daily 21 EMA after a big run (run % from the EMA at its last touch to the peak; distAdr = distance from the EMA in average daily ranges; volDryUp < 1 means volume is lighter than during the run).
redday = stock bought on red market days (bought of redDays; avgExcessOnRedDays = points better than SPY on those days). redday_group = an industry/theme bought on red days.
Return {"items":[{"list":"...","symbol":"...","line":"..."}]}.
Items:\n${clip(todo.map((t: any) => ({ list: t.list, symbol: t.symbol, group: t.grp, ...t.evidence })), 20000)}` },
  ], { task: "fast", label: "ai-lines", maxTokens: 4000, json: true }));
}
FIN.lines = async (sb, { day, lang, col }, msg, model) => {
  let items: any[] = [];
  try { items = JSON.parse(extractJson(msg.content ?? "")).items ?? []; } catch { throw new Error("the AI didn't return the lines as JSON"); }
  let written = 0;
  for (const it of items) {
    if (!it?.symbol || !it?.line) continue;
    const { error } = await sb.from("today_list").update({ [col]: String(it.line).slice(0, 400) }).eq("day", day).eq("list", it.list).eq("symbol", it.symbol);
    if (!error) written++;
  }
  return { ok: true, day, lang, written, model };
};

// ---------------------------------------------------------------- the long story (Fundamentals Lens)
async function longStory(sb: any, body: any) {
  const lang = body.lang === "he" ? "he" : "en";
  const symbol = String(body.symbol ?? "").toUpperCase();
  const facts = body.facts;
  if (!symbol || !facts) return json({ error: "symbol and facts required" }, 400);
  const factsAt = String(body.factsAt ?? "");
  if (!body.refresh) {
    const { data } = await sb.from("long_stories").select("content, model, created_at, facts_at").eq("symbol", symbol).eq("lang", lang).maybeSingle();
    if (data?.content && data.facts_at === factsAt) return json({ ...data, cached: true });
  }
  return json(await go(sb, "longstory", { symbol, lang, factsAt }, [
    { role: "system", content: `You are a patient teacher of company analysis in the spirit of Aswath Damodaran, writing for a momentum trader who is a beginner in fundamentals.
${lang === "he" ? "Write in natural, fluent Hebrew (not translated-sounding), gender-neutral when addressing the reader (use plural or impersonal forms). Keep tickers and standard abbreviations (ROIC, EBITDA) as they are." : "Write in warm, clear English."}
Use ONLY the facts given; never invent a number. Every number you mention must appear in the facts. No buy/sell advice and no price targets.` },
    { role: "user", content: `Write "the long story" of ${symbol}: a long, flowing explanation (about 900–1300 words) of what its numbers say, so the reader doesn't have to read each metric.
Not a list of metrics — connect them. Use markdown with these sections:
## The business in one paragraph — what kind of company this is by its numbers, and its stage of life.
## How it makes its money — margins and how hard it works its capital, together; how that compares with its industry; whether it earns more than its capital costs and for how long (the track record).
## How it grows, and what growth costs — growth, reinvestment, the return on that reinvestment; whether growth adds value here.
## Is the profit real? — profit vs cash, stock-based pay, dilution, what happens to the cash.
## How safe is it? — debt and coverage, given how steady it is.
## What the price is betting on — what the price assumes, against the record (good company vs good investment).
## What the numbers can't tell you — the limits for THIS company, and the questions only its story can answer.
## What to watch next — 3 to 5 concrete things in the next reports.
Explain every idea in plain words the first time it appears. Compare with the industry wherever the facts give an industry figure.
FACTS (JSON):\n${clip(facts, 26000)}` },
  ], { label: "ai-longstory", maxTokens: 5000 }));
}
FIN.longstory = async (sb, { symbol, lang, factsAt }, msg, model) => {
  const content = msg.content ?? "";
  if (!content.trim()) throw new Error("empty answer");
  const row = { symbol, lang, facts_at: factsAt, content, model, created_at: new Date().toISOString() };
  await sb.from("long_stories").upsert(row, { onConflict: "symbol,lang" });
  return row;
};

// ---------------------------------------------------------------- journal review (thinking and entries, not execution)
async function journal(sb: any, body: any) {
  const lang = body.lang === "he" ? "he" : "en";
  const { data: trades } = await sb.from("journal_entries").select("*").order("entry_date", { ascending: false }).limit(150);
  if (!trades?.length) return json({ error: "The journal is empty — add trades first." }, 400);
  const syms = [...new Set(trades.map((t: any) => t.symbol))] as string[];
  const { data: arr } = await sb.rpc("bars_arrays", { syms: [...syms, "SPY"], n: 1400 });
  const bars = new Map((arr ?? []).map((r: any) => [r.symbol, { d: r.d, h: r.h, l: r.l, c: r.c, v: (r.v ?? []).map((x: any) => Number(x ?? 0)) }]));
  const spy: any = bars.get("SPY");
  const { data: uni } = await sb.from("qualified_rs_universe").select("symbol, sector").in("symbol", syms);
  const industry = new Map((uni ?? []).map((u: any) => [u.symbol, u.sector]));
  const rows: any[] = [];
  for (const t of trades) {
    const b: any = bars.get(t.symbol);
    const ctx = b && spy ? tradeContext(b, spy, { ...t, entry_price: t.entry_price != null ? Number(t.entry_price) : null, exit_price: t.exit_price != null ? Number(t.exit_price) : null }) : null;
    // how strong was its industry, and how many similar setups were there that week (pattern samples)
    let peers: any = null;
    if (ctx) {
      const lo = new Date(Date.parse(t.entry_date) - 7 * 864e5).toISOString().slice(0, 10), hi = new Date(Date.parse(t.entry_date) + 3 * 864e5).toISOString().slice(0, 10);
      const sim = await sql(sb, `select count(*) n, round(100.0*avg(win::int),1) win_pct from pattern_samples where d between '${lo}' and '${hi}' and f[2] >= 40 and abs(f[1]) <= 0.6 and win is not null`, 1).catch(() => []);
      const ind = industry.get(t.symbol);
      const indRs = ind ? await sql(sb, `select round(percentile_cont(0.5) within group (order by f[3])::numeric,1) ind_rs, (select round(percentile_cont(0.5) within group (order by f[3])::numeric,1) from pattern_samples where d between '${lo}' and '${hi}') all_rs from pattern_samples where d between '${lo}' and '${hi}' and industry = '${String(ind).replace(/'/g, "''")}'`, 1).catch(() => []) : [];
      peers = { industry: ind ?? null, industryMedianRs3m: indRs[0]?.ind_rs ?? null, universeMedianRs3m: indRs[0]?.all_rs ?? null, similar21EmaSetupsThatWeek: sim[0]?.n ?? null, theirBigWinnerRatePct: sim[0]?.win_pct ?? null };
    }
    rows.push({ symbol: t.symbol, entry: t.entry_date, exit: t.exit_date, setup: t.setup, thesis: t.thesis, conviction: t.conviction, invalidation: t.invalidation, notes: t.notes, ...(ctx ?? { context: "no price history" }), peers });
  }
  const closed = rows.filter((r) => r.outcome && !r.outcome.open);
  const summary = { trades: rows.length, closed: closed.length, winners: closed.filter((r) => r.outcome.returnPct > 0).length,
    avgReturn: closed.length ? +(closed.reduce((s, r) => s + r.outcome.returnPct, 0) / closed.length).toFixed(1) : null,
    withThesis: rows.filter((r) => r.thesis).length, withInvalidation: rows.filter((r) => r.invalidation).length };
  return json(await go(sb, "journal", { lang, summary, rows }, [
    { role: "system", content: `You review a momentum trader's journal (21 EMA pullbacks and breakouts). Focus on THINKING and STOCK SELECTION / ENTRY — not on execution, stops or exits. ${langLine(lang)} ${lang === "he" ? "Address the reader in gender-neutral Hebrew (plural or impersonal forms)." : ""} Use only the data; be specific, kind and direct. No buy/sell advice on tickers.` },
    { role: "user", content: `Review my journal. Sections:
## What my good trades had in common at entry (compare the entry context of winners vs losers: run size, distance from the 21 EMA, pullback depth, RS, industry strength, the market's trend, volume).
## What I don't seem to think about — things my notes/thesis never mention but the data shows mattered (e.g. industry strength, the market's trend, earnings timing, how extended the stock was, what would prove me wrong). Quote my own words where useful.
## Setups I passed on — what the similar 21 EMA setups of the same weeks did, compared with mine.
## Questions to ask before the next entry — 5 short questions built from my own patterns.
If there are few trades, say how little can be concluded.
Summary: ${JSON.stringify(summary)}
Trades (newest first; atEntry = the session before entry):\n${clip(rows, 22000)}` },
  ], { label: "ai-journal", maxTokens: 3500 }));
}
FIN.journal = async (sb, { lang, summary, rows }, msg, model) => {
  const content = msg.content ?? "";
  await sb.from("ai_reports").insert({ kind: "journal", day: today(), lang, subject: "journal", title: "Journal review", content, data: { summary, rows }, model });
  return { content, summary, model };
};

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
    if (action === "job") return json(await jobState(sb, Number(body.id), FIN));
    if (action === "finish") return json(await jobState(sb, Number(body.job), FIN));
    if (!hasAnyLlm()) return json({ error: "No AI is set up: start Ollama on the PC or add a GEMINI/GROQ key." }, 503);
    if (action === "ask") return await ask(sb, body);
    if (action === "stock") return await stock(sb, body);
    if (action === "focus") return await focus(sb, body);
    if (action === "report") return await report(sb, body);
    if (action === "lines") return await lines(sb, body);
    if (action === "longstory") return await longStory(sb, body);
    if (action === "journal") return await journal(sb, body);
    return json({ error: `unknown action ${action}` }, 400);
  } catch (e) {
    console.error("[ai-analyst]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
