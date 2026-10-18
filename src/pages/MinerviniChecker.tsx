import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStockStages } from "@/hooks/useStockStages";
import { useStockBases } from "@/hooks/useStockBases";
import { useUniverseSectors } from "@/hooks/useUniverseSectors";
import { groupKeyForIndustry } from "@/lib/groupColors";
import { computeLeadership, type GroupLead } from "@/lib/leadership";
import { marketTypeFromCache, rsRanks, sepaPillars, type Mark } from "@/lib/sepa";
import { EARN_LABELS, type StockBase } from "@/lib/bases";
import type { StockStage } from "@/lib/stageAnalysis";
import { ArrowLeft, Loader2, CheckCircle2, XCircle, MinusCircle, Search, Trophy, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "sonner";

interface Criterion {
  name: string;
  value: string;
  target: string;
  status: "pass" | "fail" | "neutral";
  comment: string;
}

type ProfileId = "minervini" | "oneil" | "ryan" | "current";

interface ProfileReport {
  symbol: string;
  companyName: string;
  sector: string | null;
  profile: ProfileId;
  profileLabel: string;
  overallScore: number;
  verdict: "PASS" | "FAIL" | "BORDERLINE";
  headline: string;
  criteria: Criterion[];
  bullCase: string[];
  bearCase: string[];
  finalVerdict: string;
  subScores?: { label: string; score: number; max: number }[];
}

interface DataCoverage {
  quartersAvailable: number;
  quarterTarget: number;
  quarterlyRevenueYoY: number;
  quarterlyEpsYoY: number;
  quarterlyMargins: number;
  quarterlyCashFlow: number;
  annualAvailable: number;
  annualTarget: number;
  annualRevenueYoY: number;
  annualEpsYoY: number;
}

interface Series {
  quarters: { date: string; revenue: number | null; eps: number | null; revenueYoY: number | null; epsYoY: number | null; margin: number | null; turnaround: boolean }[];
  code33: { eps: boolean; sales: boolean; margin: boolean; count: number } | null;
  roePct: number | null; debtToEquity: number | null; surprises: number[]; beatRate: number | null; institutionalPct: number | null;
}

interface MultiReport {
  series?: Series;
  reports: Record<ProfileId, ProfileReport>;
  cumulative: { averageScore: number; verdict: "PASS" | "FAIL" | "BORDERLINE"; passCount: number; profileCount: number };
  dataQuality?: { sources?: string[]; warnings?: string[]; fmpCalls?: number; yahooCalls?: number; finnhubCalls?: number; dbCacheHit?: boolean; coverage?: DataCoverage };
}

const PROFILES: { id: ProfileId; label: string; short: string }[] = [
  { id: "current", label: "Current Fundamentals Strength", short: "Current" },
  { id: "minervini", label: "Mark Minervini (SEPA)", short: "Minervini" },
  { id: "oneil", label: "William O'Neil (CAN SLIM)", short: "O'Neil" },
  { id: "ryan", label: "David Ryan (Momentum)", short: "Ryan" },
];


const STATUS_ICON = {
  pass: <CheckCircle2 className="text-gain-medium" size={18} />,
  fail: <XCircle className="text-loss-medium" size={18} />,
  neutral: <MinusCircle className="text-muted-foreground" size={18} />,
};
const STATUS_BG = {
  pass: "border-l-4 border-l-gain-medium bg-gain-medium/5",
  fail: "border-l-4 border-l-loss-medium bg-loss-medium/5",
  neutral: "border-l-4 border-l-muted bg-muted/5",
};

function verdictClasses(verdict: string) {
  if (verdict === "PASS") return "bg-gain-medium/15 text-gain-medium border-gain-medium/40";
  if (verdict === "FAIL") return "bg-loss-medium/15 text-loss-medium border-loss-medium/40";
  return "bg-[hsl(40,90%,55%)]/15 text-[hsl(40,90%,55%)] border-[hsl(40,90%,55%)]/40";
}

function VerdictBadge({ verdict, score, label }: { verdict: string; score: number; label?: string }) {
  return (
    <div className={`inline-flex flex-col items-center justify-center rounded-xl border-2 px-6 py-4 ${verdictClasses(verdict)}`}>
      <div className="text-4xl font-extrabold tracking-tight tabular-nums">{score}</div>
      {label && <div className="mt-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>}
      <div className="mt-2 text-2xl font-extrabold tracking-widest">{verdict}</div>
    </div>
  );
}

const CACHE_KEY = (sym: string) => `minervini:v9-sepa:${sym}`;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;


function readCache(sym: string): MultiReport | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY(sym));
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return data as MultiReport;
  } catch { return null; }
}
function writeCache(sym: string, data: MultiReport) {
  try { localStorage.setItem(CACHE_KEY(sym), JSON.stringify({ ts: Date.now(), data })); } catch { /* quota */ }
}

function ProfileReportCard({ report }: { report: ProfileReport }) {
  return (
    <Card className="p-5 space-y-4">
      <div className="flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">{report.profileLabel}</div>
          <p className="mt-2 text-sm text-foreground/90">{report.headline}</p>
          {report.subScores && report.subScores.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {report.subScores.map((s, i) => {
                const pct = Math.round((s.score / s.max) * 100);
                const color = pct >= 75 ? "text-gain-medium border-gain-medium/40 bg-gain-medium/10"
                  : pct >= 50 ? "text-[hsl(40,90%,55%)] border-[hsl(40,90%,55%)]/40 bg-[hsl(40,90%,55%)]/10"
                  : "text-loss-medium border-loss-medium/40 bg-loss-medium/10";
                return (
                  <div key={i} className={`inline-flex items-center gap-2 rounded-md border px-2 py-1 text-[11px] ${color}`}>
                    <span className="uppercase tracking-wider opacity-80">{s.label}</span>
                    <span className="font-mono font-bold tabular-nums">{s.score}/{s.max}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <VerdictBadge verdict={report.verdict} score={report.overallScore} />
      </div>


      <div className="grid gap-2 md:grid-cols-2">
        {report.criteria.map((c, i) => (
          <div key={i} className={`rounded-md p-3 ${STATUS_BG[c.status]}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold text-sm">
                {STATUS_ICON[c.status]}
                <span>{c.name}</span>
              </div>
              <div className="text-right text-[11px] text-muted-foreground">
                Target: <span className="font-mono">{c.target}</span>
              </div>
            </div>
            <div className="mt-1 ml-7 font-mono text-sm font-bold">{c.value}</div>
            <div className="mt-0.5 ml-7 text-[11px] text-muted-foreground">{c.comment}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-gain-medium/30 bg-gain-medium/5 p-3">
          <h4 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-gain-medium">
            <CheckCircle2 size={14} /> Bull Case
          </h4>
          <ul className="space-y-1 text-xs">
            {report.bullCase.map((b, i) => (
              <li key={i} className="flex gap-2"><span className="text-gain-medium">▲</span><span>{b}</span></li>
            ))}
          </ul>
        </div>
        <div className="rounded-md border border-loss-medium/30 bg-loss-medium/5 p-3">
          <h4 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-loss-medium">
            <XCircle size={14} /> Bear Case
          </h4>
          <ul className="space-y-1 text-xs">
            {report.bearCase.map((b, i) => (
              <li key={i} className="flex gap-2"><span className="text-loss-medium">▼</span><span>{b}</span></li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-md bg-muted/30 p-3 text-sm">
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Final Verdict · </span>
        <span>{report.finalVerdict}</span>
      </div>
    </Card>
  );
}

export default function MinerviniChecker() {
  const [symbol, setSymbol] = useState("");
  const [loading, setLoading] = useState(false);
  const [multi, setMulti] = useState<MultiReport | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeProfiles, setActiveProfiles] = useState<ProfileId[]>(["current", "minervini", "oneil", "ryan"]);
  const { rows: stages, bySymbol: stageBy } = useStockStages(true);
  const { bySymbol: baseBy } = useStockBases(true);
  const { rows: uni, extra, load: loadUni } = useUniverseSectors();
  useEffect(() => { loadUni(); }, [loadUni]);
  const rs = useMemo(() => rsRanks(stages), [stages]);
  const industryOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of [...extra, ...uni]) m.set(r.symbol.toUpperCase(), groupKeyForIndustry(r.sector ?? null, "industry"));
    return m;
  }, [uni, extra]);
  const leadBy = useMemo(() => {
    const groups = new Map<string, StockStage[]>();
    for (const r of stages) { if (r.symbol === "SPY") continue; const g = industryOf.get(r.symbol); if (!g || g === "Unknown" || g === "Other") continue; groups.set(g, [...(groups.get(g) ?? []), r]); }
    const cnt = new Map<string, number>();
    for (const r of stages) cnt.set(r.as_of, (cnt.get(r.as_of) ?? 0) + 1);
    const week = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    for (const [g, m] of groups) groups.set(g, m.filter((r) => r.as_of === week));
    return new Map(computeLeadership(groups, stages.find((r) => r.symbol === "SPY") ?? null, 5).map((x) => [x.name, x] as [string, GroupLead]));
  }, [stages, industryOf]);
  const market = useMemo(() => marketTypeFromCache(), []);
  // SEPA candidates: Trend Template + RS ≥ 70 + Stage 2, ranked by how ready the base is
  const candidates = useMemo(() => stages.filter((r) => r.symbol !== "SPY" && r.stage === 2 && r.features?.tt?.pass && (rs.get(r.symbol) ?? 0) >= 70)
    .map((r) => ({ r, b: baseBy.get(r.symbol) ?? null, rs: rs.get(r.symbol) ?? 0, g: industryOf.get(r.symbol) ?? null }))
    .sort((a, b) => {
      const rank = (x: typeof a) => (x.b ? (x.b.state === "ready" ? 0 : x.b.state === "triggered" ? 1 : x.b.state === "qualified" ? 2 : 3) : 4);
      return rank(a) - rank(b) || (b.b?.score ?? 0) - (a.b?.score ?? 0) || b.rs - a.rs;
    }), [stages, rs, baseBy, industryOf]);

  const runAnalysis = async (force = false, explicit?: string) => {
    const sym = (explicit ?? symbol).trim().toUpperCase();
    if (explicit) setSymbol(sym);
    if (!sym) return;
    setError(null);

    if (!force) {
      const cached = readCache(sym);
      if (cached) {
        setMulti(cached);
        setFromCache(true);
        toast.success(`${sym} loaded from cache`);
        return;
      }
    }

    setLoading(true);
    setMulti(null);
    setFromCache(false);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("minervini-analysis", {
        body: { symbol: sym, force },
      });
      if (fnErr) throw new Error(fnErr.message);
      if (data?.error) throw new Error(data.error);
      if (!data?.reports) throw new Error("No reports returned");
      const result: MultiReport = { reports: data.reports, cumulative: data.cumulative, dataQuality: data.dataQuality, series: data.series };
      setMulti(result);
      writeCache(sym, result);
      toast.success(`Analysis complete for ${sym}${data.cached ? " (server cache)" : ""}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(`Failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const cumulativeActive = useMemo(() => {
    if (!multi) return null;
    const list = activeProfiles.map(p => multi.reports[p]).filter(Boolean);
    if (!list.length) return null;
    const avg = Math.round(list.reduce((s, r) => s + r.overallScore, 0) / list.length);
    const passCount = list.filter(r => r.verdict === "PASS").length;
    const verdict: "PASS" | "FAIL" | "BORDERLINE" = avg >= 80 ? "PASS" : avg >= 60 ? "BORDERLINE" : "FAIL";
    return { averageScore: avg, verdict, passCount, profileCount: list.length };
  }, [multi, activeProfiles]);

  const header = multi ? Object.values(multi.reports)[0] : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft size={18} />
            </Link>
            <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
              <Trophy size={20} className="text-[hsl(40,90%,55%)]" />
              Fundamentals Checker
            </h1>
          </div>
          <div className="text-xs text-muted-foreground">SEPA · Minervini · O'Neil · Ryan</div>
        </div>
      </header>

      <main className="container space-y-6 py-6">
        <Card className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && !loading && runAnalysis()}
                placeholder="Enter ticker (e.g. NVDA, AAPL, CRWD)"
                className="pl-9 text-base font-semibold tracking-wider uppercase"
                disabled={loading}
                autoFocus
              />
            </div>
            <Button
              onClick={() => runAnalysis(false)}
              disabled={loading || !symbol.trim()}
              size="lg"
              className="bg-[hsl(280,70%,60%)] text-white hover:bg-[hsl(280,70%,55%)] font-bold"
            >
              {loading ? (
                <><Loader2 size={18} className="mr-2 animate-spin" /> Analyzing…</>
              ) : (
                <><Trophy size={18} className="mr-2" /> Run Full Analysis</>
              )}
            </Button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Profiles:</span>
            <ToggleGroup
              type="multiple"
              value={activeProfiles}
              onValueChange={(v) => v.length && setActiveProfiles(v as ProfileId[])}
              className="flex-wrap"
            >
              {PROFILES.map(p => (
                <ToggleGroupItem key={p.id} value={p.id} className="text-xs">
                  {p.short}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            One efficient API call evaluates the stock against all three trader profiles. Toggle profiles above to focus the view; the cumulative score at the bottom averages only what's active.
          </p>
        </Card>

        <SepaCandidates items={candidates} leadBy={leadBy} onPick={(sym) => runAnalysis(false, sym)} loading={loading} />

        {error && (
          <Card className="border-loss-medium/40 bg-loss-medium/5 p-4">
            <div className="flex items-start gap-2 text-sm text-loss-medium">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          </Card>
        )}

        {loading && !multi && (
          <Card className="p-10 text-center text-sm text-muted-foreground">
            <Loader2 size={28} className="mx-auto mb-3 animate-spin text-[hsl(280,70%,60%)]" />
            Fetching multi-quarter financials and running Minervini · O'Neil · Ryan analysis (~10–20s)…
          </Card>
        )}

        {multi && header && (
          <>
            <Card className="p-6">
              <div className="flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">{header.sector || "—"}</div>
                  <h2 className="mt-1 text-3xl font-extrabold tracking-tight">
                    {header.symbol} <span className="text-base font-medium text-muted-foreground">· {header.companyName}</span>
                  </h2>
                  {fromCache && (
                    <button
                      onClick={() => runAnalysis(true)}
                      className="mt-2 text-xs text-muted-foreground underline hover:text-foreground animate-pulse"
                      disabled={loading}
                    >
                      Showing cached result (24h) — click to force refresh
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-3">
                  {activeProfiles.map(p => {
                    const r = multi.reports[p];
                    if (!r) return null;
                    return <VerdictBadge key={p} verdict={r.verdict} score={r.overallScore} label={PROFILES.find(x => x.id === p)?.short} />;
                  })}
                </div>
              </div>
            </Card>

            <SepaCard
              symbol={header.symbol}
              stage={stageBy.get(header.symbol) ?? null}
              base={baseBy.get(header.symbol) ?? null}
              rs={rs.get(header.symbol) ?? null}
              groupName={industryOf.get(header.symbol) ?? null}
              group={leadBy.get(industryOf.get(header.symbol) ?? "") ?? null}
              market={market}
              fundamentalScore={multi.reports.minervini?.overallScore ?? null}
              code33={multi.series?.code33?.count ?? null}
            />

            {multi.series && multi.series.quarters.length > 0 && <QuarterTable s={multi.series} />}

            {!!multi.dataQuality?.warnings?.length && (
              <Card className="border-[hsl(40,90%,55%)]/40 bg-[hsl(40,90%,55%)]/5 p-3 text-xs">
                <div className="mb-1 font-semibold">Data notes</div>
                <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">{multi.dataQuality.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              </Card>
            )}

            {multi.dataQuality?.coverage && (
              <Card className="p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-widest text-muted-foreground">Historical Coverage</div>
                    <div className="mt-1 font-mono text-sm font-bold">
                      {multi.dataQuality.coverage.quarterlyRevenueYoY}/{multi.dataQuality.coverage.quarterTarget} quarterly revenue YoY · {multi.dataQuality.coverage.quarterlyEpsYoY}/{multi.dataQuality.coverage.quarterTarget} quarterly EPS YoY · {multi.dataQuality.coverage.annualRevenueYoY}/{multi.dataQuality.coverage.annualTarget} annual revenue
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground md:text-right">
                    Sources: {(multi.dataQuality.sources ?? []).join(" + ") || "cache"}<br />
                    Calls: FMP {multi.dataQuality.fmpCalls ?? 0} · Yahoo {multi.dataQuality.yahooCalls ?? 0} · Finnhub {multi.dataQuality.finnhubCalls ?? 0}
                  </div>
                </div>
              </Card>
            )}

            {activeProfiles.map(p => {
              const r = multi.reports[p];
              if (!r) return null;
              return <ProfileReportCard key={p} report={r} />;
            })}


            {cumulativeActive && (
              <Card className={`border-2 p-6 ${verdictClasses(cumulativeActive.verdict)}`}>
                <div className="flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-widest text-muted-foreground">Average of the fundamental profiles</div>
                    <h3 className="mt-1 text-2xl font-extrabold tracking-tight">
                      Average across {cumulativeActive.profileCount} active profile{cumulativeActive.profileCount > 1 ? "s" : ""}
                    </h3>
                    <p className="mt-1 text-sm text-foreground/90">
                      {cumulativeActive.passCount}/{cumulativeActive.profileCount} profiles rated PASS individually. The profiles share most inputs, so this is
                      one fundamental view seen four ways — the SEPA alignment above is the fuller picture.
                    </p>
                  </div>
                  <div className="flex flex-col items-center justify-center">
                    <div className="text-5xl font-extrabold tabular-nums">{cumulativeActive.averageScore}</div>
                    <div className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">Cumulative</div>
                    <div className="mt-2 text-3xl font-extrabold tracking-widest">{cumulativeActive.verdict}</div>
                  </div>
                </div>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}

const MARK_CLS: Record<Mark, string> = {
  pass: "border-gain-medium/50 bg-gain-medium/10 text-gain-medium",
  partial: "border-[hsl(40,90%,55%)]/50 bg-[hsl(40,90%,55%)]/10 text-[hsl(40,90%,60%)]",
  fail: "border-loss-medium/50 bg-loss-medium/10 text-loss-medium",
  unknown: "border-border bg-muted/20 text-muted-foreground",
};
const MARK_ICON: Record<Mark, string> = { pass: "✓", partial: "~", fail: "✗", unknown: "?" };

function SepaCard(props: {
  symbol: string; stage: StockStage | null; base: StockBase | null; rs: number | null; groupName: string | null; group: GroupLead | null;
  market: { key: string; name: string } | null; fundamentalScore: number | null; code33: number | null;
}) {
  const pillars = sepaPillars({ ...props, code33Count: props.code33 });
  const known = pillars.filter((p) => p.mark !== "unknown");
  const passes = known.filter((p) => p.mark === "pass").length;
  const fails = known.filter((p) => p.mark === "fail").length;
  const verdict = known.length < 4 ? "Not enough data" : fails === 0 && passes >= known.length - 1 ? "Aligned" : fails <= 1 && passes >= 3 ? "Partly aligned" : "Not aligned";
  const b = props.base;
  const pivot = b ? (b.pivot ?? b.features.pivot) : null, stop = b ? (b.support ?? b.features.support) : null;
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">SEPA alignment · trend, fundamentals, setup, group, market</div>
          <div className={`mt-1 text-2xl font-extrabold ${verdict === "Aligned" ? "text-gain-medium" : verdict === "Partly aligned" || verdict === "Not enough data" ? "text-[hsl(40,90%,60%)]" : "text-loss-medium"}`}>
            {verdict} <span className="text-sm font-medium text-muted-foreground">· {passes}/{known.length} pillars pass</span>
          </div>
        </div>
        {pivot !== null && stop !== null && stop < pivot && (
          <Link to={`/trades?symbol=${encodeURIComponent(props.symbol)}&entry=${pivot.toFixed(2)}&stop=${stop.toFixed(2)}`}
            className="ml-auto rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20">
            Size it in Trade Desk → pivot {pivot.toFixed(2)}, stop {stop.toFixed(2)}
          </Link>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {pillars.map((p) => (
          <div key={p.key} className={`rounded-md border p-3 ${MARK_CLS[p.mark]}`}>
            <div className="flex items-center justify-between gap-2 text-sm font-semibold">
              <span>{MARK_ICON[p.mark]} {p.label}</span>
              <span className="font-mono text-xs">{p.value}</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-foreground/75">{p.detail}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Minervini's SEPA buys leaders only when everything lines up: a Stage 2 trend that passes the Trend Template, strong and accelerating
        fundamentals, a low-risk setup (VCP) near its pivot, a strong group, and a healthy market. Trend, setup, group and market come from your
        weekly stage/base scans (as of the last scan), so they cost no extra data calls.
      </p>
    </Card>
  );
}

function QuarterTable({ s }: { s: Series }) {
  const q = s.quarters;
  const big = (x: number | null) => (x === null ? "—" : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(x));
  const pctCell = (x: number | null) => (x === null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(0)}%`);
  const tone = (x: number | null) => (x === null ? "" : x >= 25 ? "text-gain-medium" : x < 0 ? "text-loss-medium" : "");
  return (
    <Card className="p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Quarter by quarter</h3>
        <span className="text-[11px] text-muted-foreground">· newest first · growth vs the same quarter a year earlier</span>
        {s.code33 && <span className="ml-auto text-[11px]">Code 33: EPS {s.code33.eps ? "✓" : "✗"} · sales {s.code33.sales ? "✓" : "✗"} · margin {s.code33.margin ? "✓" : "✗"}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-[10.5px] text-muted-foreground">
              <th className="px-2 py-1.5 text-left font-medium">Quarter end</th>
              <th className="px-2 py-1.5 text-right font-medium">Sales</th>
              <th className="px-2 py-1.5 text-right font-medium">Sales YoY</th>
              <th className="px-2 py-1.5 text-right font-medium">EPS</th>
              <th className="px-2 py-1.5 text-right font-medium">EPS YoY</th>
              <th className="px-2 py-1.5 text-right font-medium">Margin</th>
            </tr>
          </thead>
          <tbody>
            {q.map((r) => (
              <tr key={r.date} className="border-b border-border/30">
                <td className="px-2 py-1 font-mono">{r.date}</td>
                <td className="px-2 py-1 text-right font-mono">{big(r.revenue)}</td>
                <td className={`px-2 py-1 text-right font-mono ${tone(r.revenueYoY)}`}>{pctCell(r.revenueYoY)}</td>
                <td className="px-2 py-1 text-right font-mono">{r.eps === null ? "—" : r.eps.toFixed(2)}</td>
                <td className={`px-2 py-1 text-right font-mono ${tone(r.epsYoY)}`}>{r.turnaround ? <span className="text-gain-medium">turnaround</span> : pctCell(r.epsYoY)}</td>
                <td className="px-2 py-1 text-right font-mono">{r.margin === null ? "—" : `${r.margin.toFixed(1)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10.5px] text-muted-foreground">
        ROE {s.roePct === null ? "—" : `${s.roePct.toFixed(1)}%`} · debt/equity {s.debtToEquity === null ? "—" : `${s.debtToEquity.toFixed(2)}×`} ·
        beat rate {s.beatRate === null ? "—" : `${s.beatRate}%`}{s.surprises.length ? ` (last surprises ${s.surprises.slice(0, 4).map((x) => `${x >= 0 ? "+" : ""}${x.toFixed(0)}%`).join(", ")})` : ""} ·
        institutions {s.institutionalPct === null ? "—" : `${s.institutionalPct.toFixed(0)}%`}. A profit after a year-ago loss shows as "turnaround" instead of a misleading growth %.
      </p>
    </Card>
  );
}

function SepaCandidates({ items, leadBy, onPick, loading }: {
  items: { r: StockStage; b: StockBase | null; rs: number; g: string | null }[];
  leadBy: Map<string, GroupLead>; onPick: (sym: string) => void; loading: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [onlyBases, setOnlyBases] = useState(true);
  const list = (onlyBases ? items.filter((x) => x.b && x.b.state !== "failed" && x.b.state !== "extended") : items).slice(0, 60);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setOpen(!open)} className="text-sm font-semibold">{open ? "▾" : "▸"} SEPA candidates</button>
        <span className="text-[11px] text-muted-foreground">· Trend Template ✓ (8/8 incl. RS ≥ 70) and Stage 2, from your last scan — click a ticker to check its fundamentals</span>
        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={onlyBases} onChange={(e) => setOnlyBases(e.target.checked)} /> only with a live base
        </label>
      </div>
      {open && (
        !items.length ? <p className="mt-2 text-xs text-muted-foreground">No stage data yet — run a Full Scan or open the Stages tab and press Scan Stages.</p> : (
          <div className="mt-2 max-h-[340px] overflow-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-[10.5px] text-muted-foreground">
                  <th className="px-2 py-1.5 text-left font-medium">Ticker</th>
                  <th className="px-2 py-1.5 text-right font-medium">RS</th>
                  <th className="px-2 py-1.5 text-left font-medium">Stage</th>
                  <th className="px-2 py-1.5 text-left font-medium">Base</th>
                  <th className="px-2 py-1.5 text-right font-medium">Score</th>
                  <th className="px-2 py-1.5 text-right font-medium">To pivot</th>
                  <th className="px-2 py-1.5 text-left font-medium">Group</th>
                  <th className="px-2 py-1.5 text-left font-medium">Earnings</th>
                </tr>
              </thead>
              <tbody>
                {list.map(({ r, b, rs, g }) => {
                  const lead = g ? leadBy.get(g) : undefined;
                  const e = b?.features.earn;
                  return (
                    <tr key={r.symbol} className="cursor-pointer border-b border-border/30 hover:bg-accent/30" onClick={() => !loading && onPick(r.symbol)}>
                      <td className="px-2 py-1 font-mono font-semibold">{r.symbol}</td>
                      <td className="px-2 py-1 text-right font-mono">{rs}</td>
                      <td className="px-2 py-1 font-mono">{r.substage}</td>
                      <td className="px-2 py-1">{b ? `${b.state ?? "—"} · ${b.primary_label ?? "base"}${b.features.daily?.contracting ? " · tight" : ""}` : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-2 py-1 text-right font-mono">{b?.score ?? "—"}</td>
                      <td className="px-2 py-1 text-right font-mono">{b ? `${(b.dist_to_pivot ?? b.features.distToPivotPct).toFixed(1)}%` : "—"}</td>
                      <td className="max-w-[180px] truncate px-2 py-1" title={g ?? ""}>{g ?? "—"}{lead && (lead.state === "confirmed" || lead.state === "emerging") ? <span className="ml-1 text-gain-medium">★</span> : null}</td>
                      <td className="px-2 py-1">{e && e.sessionsAgo <= 45 ? EARN_LABELS[e.label].text : <span className="text-muted-foreground">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </Card>
  );
}
