import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { groupKeyForIndustry } from "@/lib/groupColors";
import { buildLeaderInputs, rankIndustries, rsRatings } from "@/lib/industryLeaders";
import { useSuperperformance } from "@/hooks/useSuperperformance";
import type { PeerRow } from "@/lib/lens/compare";

/**
 * The stock's industry, ranked exactly like the Industry Leaders panel (RS Alpha): same universe
 * (OTC names out), same industry grouping, same fundamental score. Plus market cap for "largest".
 */
interface URow { symbol: string; sector: string | null; rs_overall: number | null; market_cap: number | null; company_name: string | null }
let universeCache: { at: number; rows: URow[] } | null = null;
let inflight: Promise<URow[]> | null = null;
const isOtc = (s: string) => /\.(PK|OTC|OB)$/i.test(s) || (/^[A-Z]{5}$/.test(s) && s.endsWith("F"));

async function loadUniverse(): Promise<URow[]> {
  if (universeCache && Date.now() - universeCache.at < 30 * 60_000) return universeCache.rows;
  if (inflight) return inflight;
  inflight = (async () => {
    const out: URow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("qualified_rs_universe").select("symbol, sector, rs_overall, market_cap, company_name").range(from, from + 999);
      if (error) throw error;
      out.push(...((data ?? []) as URow[]));
      if (!data || data.length < 1000) break;
    }
    universeCache = { at: Date.now(), rows: out };
    return out;
  })().finally(() => { inflight = null; });
  return inflight;
}

export function useIndustryPeers(symbol: string | null) {
  const [universe, setUniverse] = useState<URow[] | null>(universeCache?.rows ?? null);
  const [fund, setFund] = useState<Map<string, { eps_quarterly_yoy: number | null; revenue_quarterly_yoy: number | null; roe: number | null; net_margin: number | null }>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const { rows: saved } = useSuperperformance();
  useEffect(() => { loadUniverse().then(setUniverse).catch((e) => setError(e instanceof Error ? e.message : String(e))); }, []);

  const sym = symbol?.toUpperCase() ?? null;
  const base = useMemo(() => (universe ?? []).filter((r) => !isOtc(r.symbol)), [universe]);
  const me = useMemo(() => base.find((r) => r.symbol.toUpperCase() === sym) ?? null, [base, sym]);
  const group = me ? groupKeyForIndustry(me.sector, "industry") : null;
  const members = useMemo(() => group ? base.filter((r) => groupKeyForIndustry(r.sector, "industry") === group) : [], [base, group]);
  const memberKey = members.map((m) => m.symbol).join(",");

  useEffect(() => {
    if (!members.length) return;
    let live = true;
    (async () => {
      const m = new Map<string, { eps_quarterly_yoy: number | null; revenue_quarterly_yoy: number | null; roe: number | null; net_margin: number | null }>();
      const syms = members.map((x) => x.symbol);
      for (let i = 0; i < syms.length; i += 300) {
        const { data } = await supabase.from("stock_fundamentals").select("symbol, eps_quarterly_yoy, revenue_quarterly_yoy, roe, net_margin").in("symbol", syms.slice(i, i + 300));
        for (const r of (data ?? []) as Array<{ symbol: string; eps_quarterly_yoy: number | null; revenue_quarterly_yoy: number | null; roe: number | null; net_margin: number | null }>) m.set(r.symbol, r);
      }
      if (live) setFund(m);
    })();
    return () => { live = false; };
  }, [memberKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const peers = useMemo<PeerRow[]>(() => {
    if (!members.length) return [];
    const rating = rsRatings(base.map((r) => ({ symbol: r.symbol, sector: r.sector, rsOverall: r.rs_overall })));
    const savedBy = new Map(saved.map((r) => [r.symbol.toUpperCase(), r]));
    const items = buildLeaderInputs(members.map((r) => ({ symbol: r.symbol, sector: r.sector, rsOverall: r.rs_overall })), () => group!, fund, savedBy, rating);
    const g = rankIndustries(items, 1)[0];
    if (!g) return [];
    const info = new Map(members.map((r) => [r.symbol.toUpperCase(), r]));
    return [...g.leaders, ...g.unranked].map((l) => ({
      symbol: l.symbol, company: info.get(l.symbol)?.company_name ?? null, rank: l.rank, ranked: g.ranked, score: l.score, rsRating: l.rsRating, marketCap: info.get(l.symbol)?.market_cap ?? null,
    }));
  }, [members, base, saved, fund, group]);

  return { group, peers, inUniverse: !!me, loading: universe == null, error };
}
