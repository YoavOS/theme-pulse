// Data the local AI reads: a guide to the tables, a safe SQL door, a per-stock profile and a
// market digest. Everything here is plain SELECTs through public.ai_readonly_query (always rolled back).
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type Rows = Record<string, any>[];

/** Run one read-only SELECT. Throws with the database's message on a bad query. */
export async function sql(sb: SupabaseClient, q: string, maxRows = 200): Promise<Rows> {
  const { data, error } = await sb.rpc("ai_readonly_query", { q, max_rows: maxRows });
  if (error) throw new Error(error.message);
  return (data ?? []) as Rows;
}
const safe = async (sb: SupabaseClient, q: string, maxRows = 50): Promise<Rows | { error: string }> => {
  try { return await sql(sb, q, maxRows); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
};
const sym = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);

/** What the AI needs to know to write good queries. Columns are listed by the live database. */
export const DATA_GUIDE = `You are looking at Theme Pulse, a momentum-trading app's database (PostgreSQL). Main tables:
- qualified_rs_universe: the stock universe (liquid US stocks). symbol, company_name, sector (industry text), market_cap, current_price,
  adr_percent (average daily range %), return_1d/1w/1m/3m/6m (%), rs_1d/1w/1m/3m/6m and rs_overall (relative strength vs SPY; higher = stronger),
  rs_nh_20d / rs_nh_6m (RS line at a new 20-day / 6-month high) with *_days_ago.
- stock_stages: Weinstein stage per stock, latest week. stage 1 basing, 2 advancing, 3 topping, 4 declining; substage; confidence 0-100;
  weeks_in_stage; event_kind (e.g. a new stage 2 entry) and event_weeks_ago (0 = this week); history = one char per week, oldest first; as_of.
- market_stages: the same for index/market symbols (SPY, QQQ, IWM, sector ETFs and the broad market list).
- stock_bases: base / setup scanner. state (ready, qualified, developing, watch, triggered, extended, failed), primary_label (vcp, htf, flat, cup…),
  score 0-100, pivot, dist_to_pivot (% below the pivot), support, stop_risk (%), earnings_date.
- base_breakouts: recent breakouts. breakout_date, pivot, label, rvol (relative volume), status, ext_pct (% above pivot), failed_date.
- superperformance_stocks: fundamentals growth scores. minervini_score, oneil_score, ryan_score, current_score, last_report, next_report.
- proven_strength: 10-year track record of return on capital vs cost of capital. label (elite, proven, proven_caveat, fading, provisional,
  emerging, emerging_early, was_strong, not_proven, insufficient), sentence, median_spread (pp above the cost of capital), years_above, years_valid, archetype.
- stock_fundamentals: eps/revenue growth (ttm_yoy, quarterly_yoy, quarterly_qoq, annual_yoy in %), margins (%), pe_ratio, forward_pe, ps_ratio, roe, debt_to_equity.
- insider_trades: Form 4 trades. code 'P' = open-market purchase, 'S' = sale; trade_date, value ($), owner, title.
- themes / theme_tickers: the user's own theme lists (theme_tickers.ticker_symbol, theme_id → themes.id, themes.name).
- ticker_performance: latest dashboard scan: perf_1d/1w/1m/3m/ytd (%) per symbol.
- signal_log: weekly stage/base signals with forward returns fwd4/fwd8/fwd13 (%) and spy4/spy8/spy13 for comparison.
- trade_positions: the user's trades (entry, stop, exit).
Join on symbol. Percent columns are already in %. Prefer the universe for "stocks"; use stock_stages.as_of for freshness.`;

/** Live column lists for the main tables (keeps the guide honest if a table changes). */
export async function liveColumns(sb: SupabaseClient): Promise<string> {
  const rows = await safe(sb, `select table_name, string_agg(column_name, ', ' order by ordinal_position) cols from information_schema.columns
    where table_schema = 'public' and table_name in ('qualified_rs_universe','stock_stages','market_stages','stock_bases','base_breakouts',
    'superperformance_stocks','proven_strength','stock_fundamentals','insider_trades','themes','theme_tickers','ticker_performance','signal_log','trade_positions')
    group by 1`, 50);
  return Array.isArray(rows) ? rows.map((r) => `${r.table_name}(${r.cols})`).join("\n") : "";
}

/** Everything the app knows about one stock, compact. */
export async function stockProfile(sb: SupabaseClient, symbolIn: string) {
  const s = sym(symbolIn);
  const [u, st, b, bo, sp, pr, f, ins, peers] = await Promise.all([
    safe(sb, `select symbol, company_name, sector, round(market_cap/1e9,2) cap_b, current_price, adr_percent, return_1d, return_1w, return_1m, return_3m, return_6m,
      rs_1w, rs_1m, rs_3m, rs_6m, rs_overall, rs_nh_20d, rs_nh_20d_days_ago, rs_nh_6m from qualified_rs_universe where symbol = '${s}'`, 1),
    safe(sb, `select stage, substage, confidence, quality, weeks_in_stage, event, event_kind, event_weeks_ago, right(history, 26) last_26_weeks, reasons, as_of from stock_stages where symbol = '${s}'`, 1),
    safe(sb, `select state, primary_label, labels, score, pivot, dist_to_pivot, support, stop_risk, warnings, earnings_date, as_of from stock_bases where symbol = '${s}'`, 1),
    safe(sb, `select breakout_date, pivot, label, rvol, status, ext_pct, max_ext_pct, failed_date from base_breakouts where symbol = '${s}' order by breakout_date desc limit 3`, 3),
    safe(sb, `select minervini_score, oneil_score, ryan_score, current_score, last_report, next_report from superperformance_stocks where symbol = '${s}'`, 1),
    safe(sb, `select label, sentence, median_spread, years_above, years_valid, archetype, life_stage from proven_strength where symbol = '${s}'`, 1),
    safe(sb, `select eps_quarterly_yoy, eps_ttm_yoy, revenue_quarterly_yoy, revenue_ttm_yoy, gross_margin, operating_margin, net_margin, pe_ratio, forward_pe, ps_ratio, roe, debt_to_equity from stock_fundamentals where symbol = '${s}'`, 1),
    safe(sb, `select code, count(*) n, round(sum(value)) total_value, max(trade_date) last from insider_trades where symbol = '${s}' and trade_date > current_date - 90 group by code`, 5),
    safe(sb, `select p.symbol, p.rs_overall, p.return_1m, s.stage from qualified_rs_universe p left join stock_stages s using (symbol)
      where p.sector = (select sector from qualified_rs_universe where symbol = '${s}') and p.symbol <> '${s}' order by p.rs_overall desc nulls last limit 6`, 6),
  ]);
  const one = (x: Rows | { error: string }) => (Array.isArray(x) ? x[0] ?? null : x);
  return { symbol: s, universe: one(u), stage: one(st), base: one(b), breakouts: bo, superperformance: one(sp), provenStrength: one(pr),
    fundamentals: one(f), insiders90d: ins, industryPeersByRs: peers };
}

/** Recent headlines for a stock (Finnhub), short. */
export async function headlines(symbolIn: string, days = 10): Promise<{ date: string; headline: string; source: string }[]> {
  const key = Deno.env.get("FINNHUB_API_KEY");
  if (!key) return [];
  const to = new Date(), from = new Date(Date.now() - days * 864e5);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  try {
    const r = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${sym(symbolIn)}&from=${d(from)}&to=${d(to)}&token=${key}`);
    if (!r.ok) return [];
    const j = await r.json();
    return (Array.isArray(j) ? j : []).slice(0, 8).map((n: any) => ({ date: new Date(n.datetime * 1000).toISOString().slice(0, 10), headline: String(n.headline ?? "").slice(0, 200), source: n.source }));
  } catch { return []; }
}

/** The state of the market and the universe today, for the nightly report. */
export async function marketDigest(sb: SupabaseClient) {
  const q = (s: string, n = 12) => safe(sb, s, n);
  const [indexes, breadth, industries, laggards, newStage2, toStage4, breakouts, nearPivot, rsHighs, superperf, provenLeaders, insiderBuys, themes] = await Promise.all([
    q(`select symbol, stage, substage, weeks_in_stage, event_kind, event_weeks_ago, as_of from market_stages where symbol in ('SPY','QQQ','IWM','DIA','SMH','XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLU','XLB','XLRE','XLC')`, 20),
    q(`select stage, count(*) n from stock_stages s join qualified_rs_universe u using (symbol) group by stage order by stage`, 6),
    q(`select u.sector industry, count(*) n, round(avg(u.rs_overall)::numeric,1) avg_rs, round(avg(u.return_1m)::numeric,1) avg_ret_1m,
       round(100.0*avg((s.stage = 2)::int),0) pct_stage2 from qualified_rs_universe u left join stock_stages s using (symbol)
       where u.sector is not null group by 1 having count(*) >= 4 order by avg(u.rs_overall) desc nulls last limit 12`),
    q(`select u.sector industry, count(*) n, round(avg(u.rs_overall)::numeric,1) avg_rs, round(avg(u.return_1m)::numeric,1) avg_ret_1m
       from qualified_rs_universe u where u.sector is not null group by 1 having count(*) >= 4 order by avg(u.rs_overall) asc nulls last limit 6`, 6),
    q(`select s.symbol, u.sector, round(u.rs_overall::numeric,1) rs, s.substage, s.event_kind from stock_stages s join qualified_rs_universe u using (symbol)
       where s.stage = 2 and s.event_weeks_ago = 0 order by u.rs_overall desc nulls last limit 15`, 15),
    q(`select s.symbol, u.sector from stock_stages s join qualified_rs_universe u using (symbol) where s.stage = 4 and s.event_weeks_ago = 0 order by u.market_cap desc nulls last limit 10`, 10),
    q(`select b.symbol, u.sector, b.breakout_date, b.label, b.rvol, b.status, b.ext_pct from base_breakouts b left join qualified_rs_universe u using (symbol)
       where b.breakout_date > current_date - 7 order by b.breakout_date desc, b.rvol desc nulls last limit 15`, 15),
    q(`select b.symbol, u.sector, b.primary_label, b.score, b.dist_to_pivot, b.stop_risk from stock_bases b join qualified_rs_universe u using (symbol)
       where b.state in ('ready','qualified') order by b.score desc nulls last limit 15`, 15),
    q(`select symbol, sector, round(rs_overall::numeric,1) rs, return_1m from qualified_rs_universe where rs_nh_6m and rs_nh_6m_days_ago = 0 order by rs_overall desc nulls last limit 15`, 15),
    q(`select p.symbol, u.sector, p.current_score, p.minervini_score from superperformance_stocks p join qualified_rs_universe u using (symbol) order by p.current_score desc nulls last limit 10`, 10),
    q(`select p.symbol, u.sector, p.label, p.median_spread from proven_strength p join qualified_rs_universe u using (symbol) join stock_stages s using (symbol)
       where p.label in ('elite','proven') and s.stage = 2 order by u.rs_overall desc nulls last limit 12`, 12),
    q(`select symbol, count(*) buys, round(sum(value)) total from insider_trades where code = 'P' and trade_date > current_date - 7 group by symbol order by sum(value) desc limit 10`, 10),
    q(`select t.name theme, count(*) n, round(avg(p.perf_1w)::numeric,1) avg_1w, round(avg(p.perf_1m)::numeric,1) avg_1m from themes t join theme_tickers tt on tt.theme_id = t.id
       join ticker_performance p on p.symbol = tt.ticker_symbol group by 1 having count(*) >= 3 order by avg(p.perf_1w) desc nulls last limit 10`, 10),
  ]);
  return { asOf: new Date().toISOString().slice(0, 10), indexes, universeStageBreadth: breadth, strongestIndustries: industries, weakestIndustries: laggards,
    newStage2ThisWeek: newStage2, newStage4ThisWeek: toStage4, breakoutsLast7Days: breakouts, basesNearPivot: nearPivot, rsLineNew6mHighsToday: rsHighs,
    topSuperperformance: superperf, provenStrongStage2Leaders: provenLeaders, insiderBuysLast7Days: insiderBuys, themesByWeek: themes };
}

export const langLine = (lang: string) => (lang === "he"
  ? "Write in natural, fluent Hebrew (עברית). Keep tickers, numbers and standard market abbreviations (RS, ADR, EMA, VCP) as they are."
  : "Write in clear English.");
