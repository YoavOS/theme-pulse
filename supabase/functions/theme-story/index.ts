// theme-story — the narrative behind a theme / industry / sector, explained in plain language.
//
// Shown in the "i" panel (Theme Strength Meter). One story per group, saved in theme_narratives
// and reused for 7 days (or until the user presses Refresh), so it costs one AI call per group
// per week at most.
//
// Sources (all free):
//   • Finnhub company news for the group's leading stocks (last 30 days)
//   • Google News RSS for the group's name (last 30 days)
//   • Gemini with Google Search (the existing GEMINI_API_KEY) for background and anything the
//     headlines miss; falls back to the other AI providers without search.
// Recent events must come from those sources and are cited [n]; background concepts (how a
// market or technology works) may use general knowledge, which is what makes it readable.
//
// POST { name, mode, symbols: [{symbol, pct}], stats: {...}, refresh?: boolean, cacheOnly?: boolean }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { extractJson, hasAnyLlm, llmFetch } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY") ?? "";

const MAX_AGE_MS = 7 * 24 * 3600_000;
const DAY = 86_400_000;
const STORY_VERSION = 1;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

interface Item { title: string; summary: string | null; url: string; source: string | null; date: string | null; symbol: string | null }

async function finnhubNews(symbol: string): Promise<Item[]> {
  if (!FINNHUB_KEY) return [];
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  try {
    const r = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${FINNHUB_KEY}`);
    if (!r.ok) { await r.body?.cancel(); return []; }
    // deno-lint-ignore no-explicit-any
    const d: any[] = await r.json();
    return (Array.isArray(d) ? d : [])
      .filter((n) => n?.headline && n?.url)
      .slice(0, 6)
      .map((n) => ({
        title: String(n.headline).slice(0, 200), summary: n.summary ? String(n.summary).slice(0, 280) : null,
        url: String(n.url), source: n.source ?? null, symbol,
        date: n.datetime ? new Date(n.datetime * 1000).toISOString().slice(0, 10) : null,
      }));
  } catch { return []; }
}

const decode = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]+>/g, "").trim();

async function googleNews(query: string): Promise<Item[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query + " when:30d")}&hl=en-US&gl=US&ceid=US:en`;
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) { await r.body?.cancel(); return []; }
    const xml = await r.text();
    const items = xml.split("<item>").slice(1, 16);
    return items.map((it) => {
      const tag = (t: string) => { const m = it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : null; };
      const date = tag("pubDate");
      return {
        title: tag("title") ?? "", summary: null, url: tag("link") ?? "", source: tag("source"), symbol: null,
        date: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString().slice(0, 10) : null,
      };
    }).filter((i) => i.title && i.url);
  } catch { return []; }
}

const SYSTEM = `You explain stock-market themes to a smart reader who is NOT a finance or industry expert.
Your job: tell the whole story behind a group of stocks — what it is, how it works, why it is moving now, how that reaches these companies, and what could change it — so anyone can understand it.

RULES
- Plain language. When you use a term (e.g. "private credit", "HBM", "net interest margin", "PPA", "backlog"), explain it in the "concepts" list in one or two simple sentences, with an everyday analogy when it helps.
- Background (how an industry, a technology or a financial mechanism works) may come from your general knowledge.
- Anything RECENT (an event, a deal, a number, a date, a policy) must come from the numbered headlines or your search results. Cite headlines as [n]. Never invent figures, dates or quotes. If the sources don't explain the move, say so honestly.
- Be specific: name companies and tickers, say who benefits and who doesn't.
- Use the price facts given (performance, breadth, leaders) to judge whether the story is confirmed by the market or not.
- Write in English. No hype, no investment advice.

Reply with ONE JSON object, no markdown fences:
{
  "headline": "the theme's story in one sentence",
  "phase": "early" | "building" | "mature" | "fading" | "unclear",
  "phase_reason": "one or two sentences: why this phase, using the price facts",
  "story": ["3 to 6 paragraphs telling the narrative from the start: what this group is, the mechanism, what changed recently, why it matters now"],
  "concepts": [{ "term": "...", "explain": "plain-language explanation, how it works" }],
  "drivers": [{ "title": "short name of the driver", "detail": "what happened and why it matters, 2-4 sentences", "date": "YYYY-MM-DD or null", "refs": [1, 4] }],
  "how_it_reaches_stocks": [{ "who": "company / ticker or sub-group", "how": "the business link: how the driver turns into revenue, margins or valuation" }],
  "price_check": "2-3 sentences: does the market confirm the story? broad or narrow, leaders, how long it has run",
  "risks": [{ "risk": "what could break the story", "explain": "how it would hurt these stocks" }],
  "watch": [{ "event": "what to watch next", "when": "date or period or null", "why": "why it matters" }]
}
Keep 3-6 concepts, 2-5 drivers, 3-6 how_it_reaches_stocks, 2-4 risks, 2-4 watch items.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({})) as {
      name?: string; mode?: string; symbols?: { symbol: string; pct?: number | null }[];
      stats?: Record<string, unknown>; refresh?: boolean; cacheOnly?: boolean;
    };
    const name = String(body.name ?? "").trim().slice(0, 120);
    if (!name) return json({ error: "name is required" }, 400);
    const mode = String(body.mode ?? "theme").slice(0, 20);
    const key = `${mode}:${name.toLowerCase()}`;
    const sb = createClient(SB_URL, SB_KEY);

    const { data: cached } = await sb.from("theme_narratives").select("story, sources, created_at, version").eq("key", key).maybeSingle();
    const fresh = cached && cached.version === STORY_VERSION && Date.now() - Date.parse(cached.created_at) < MAX_AGE_MS;
    if (cached && (body.cacheOnly || (fresh && !body.refresh))) {
      return json({ ok: true, cached: true, story: cached.story, sources: cached.sources, createdAt: cached.created_at });
    }
    if (body.cacheOnly) return json({ ok: true, cached: false, story: null });
    if (!hasAnyLlm()) return json({ error: "No AI key configured (GEMINI_API_KEY)" }, 503);

    // Leading stocks: the ones the client sent first (biggest movers), at most 6 news calls.
    const syms = (body.symbols ?? []).filter((s) => s?.symbol).slice(0, 12);
    const newsSyms = syms.slice(0, 6).map((s) => s.symbol.toUpperCase());
    const [perStock, google] = await Promise.all([
      Promise.all(newsSyms.map(finnhubNews)),
      googleNews(mode === "theme" ? `${name} stocks` : `${name} stocks industry`),
    ]);
    // Merge and de-duplicate by headline; newest first; keep 30.
    const seen = new Set<string>();
    const items = [...perStock.flat(), ...google]
      .filter((i) => { const k = i.title.toLowerCase().replace(/\W+/g, " ").slice(0, 80); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, 30);

    const stats = body.stats ?? {};
    const user = `Group: ${name} (${mode})
Today: ${new Date().toISOString().slice(0, 10)}
Price facts: ${JSON.stringify(stats)}
Stocks in the group (ticker: performance % for the dashboard's timeframe): ${syms.map((s) => `${s.symbol}${typeof s.pct === "number" ? ` ${s.pct >= 0 ? "+" : ""}${s.pct.toFixed(1)}%` : ""}`).join(", ") || "n/a"}

Numbered headlines (last 30 days):
${items.length ? items.map((it, i) => `[${i + 1}] ${it.date ?? "?"} · ${it.source ?? "?"}${it.symbol ? ` · ${it.symbol}` : ""} · ${it.title}${it.summary ? ` — ${it.summary}` : ""}`).join("\n") : "(no headlines found)"}

Tell the full story of this group as JSON.`;

    const ai = await llmFetch({
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 4000,
    }, { task: "grounded", label: "theme-story" });
    if (!ai.ok) return json({ error: `AI unavailable (${ai.status})` }, ai.status === 429 ? 429 : 502);
    const aj = await ai.json();
    // deno-lint-ignore no-explicit-any
    let story: any;
    try { story = JSON.parse(extractJson(String(aj?.choices?.[0]?.message?.content ?? ""))); } catch { story = null; }
    if (!story || !Array.isArray(story.story) || !story.headline) return json({ error: "The AI reply could not be read — try Refresh." }, 502);

    const sources = {
      headlines: items.map((it, i) => ({ n: i + 1, title: it.title, url: it.url, source: it.source, date: it.date })),
      // deno-lint-ignore no-explicit-any
      web: (Array.isArray(aj?.sources) ? aj.sources : []).slice(0, 8).map((s: any) => ({ title: s.title, url: s.url })),
      provider: aj?.provider ?? null,
    };
    const createdAt = new Date().toISOString();
    await sb.from("theme_narratives").upsert({ key, name, mode, story, sources, version: STORY_VERSION, created_at: createdAt }, { onConflict: "key" });
    return json({ ok: true, cached: false, story, sources, createdAt });
  } catch (e) {
    console.error("theme-story error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
