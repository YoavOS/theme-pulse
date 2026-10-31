import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BottomLine, HowItWorks, SectionHead } from "@/components/Explainer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStockStages } from "@/hooks/useStockStages";
import { useStockBases } from "@/hooks/useStockBases";
import { useUniverseSectors } from "@/hooks/useUniverseSectors";
import { groupKeyForIndustry } from "@/lib/groupColors";
import { computeLeadership, type GroupLead } from "@/lib/leadership";
import { marketTypeFromCache, rsRanks, sepaPillars, type Mark } from "@/lib/sepa";
import { EARN_LABELS, type StockBase } from "@/lib/bases";
import type { StockStage } from "@/lib/stageAnalysis";
import { breakoutSetup, shortTermMomentum } from "@/lib/superperfProfiles";
import { ArrowLeft, Loader2, CheckCircle2, XCircle, MinusCircle, Search, Trophy, AlertTriangle, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { WeekSpark } from "@/components/stages/StageStockTable";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
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
  revisions?: { thisYear?: Rev; nextYear?: Rev; thisQuarter?: Rev } | null;
  shortInterest?: { floatShares: number | null; sharesShort: number | null; shortPctFloat: number | null; daysToCover: number | null } | null;
  analystRec?: { buyPct: number | null; buyPct3mAgo: number | null; analysts: number } | null;
  revSurprises?: number[]; nextEarnings?: string | null;
  scoreParts?: { label: string; earned: number; max: number }[] | null; scoreCoveragePct?: number | null;
  profiles?: Profiles | null;
  history?: History | null;
}
interface HProfile {
  key: string; label: string; horizon: string; question: string; score: number | null; coverage: number; verdict: "Strong" | "Mixed" | "Weak" | "Limited data";
  parts: { label: string; earned: number; max: number; value: string; good: boolean | null; tested?: boolean }[]; strengths: string[]; weaknesses: string[];
}
interface RedFlag { key: string; label: string; detail: string; tested: boolean }
interface CompanyType { key: "speculative" | "established" | "large"; label: string; detail: string; winPct: number; lossPct: number; medianVsSpy: number }
interface Profiles { momentum?: HProfile; quality?: HProfile; growth?: HProfile; margins?: HProfile; cash?: HProfile; turnaround?: HProfile; type?: CompanyType | null; redFlags?: RedFlag[] }
interface History {
  quarters: { end: string; revenue: number | null; eps: number | null; opMargin: number | null; revenueYoY: number | null; epsYoY: number | null }[];
  years: { end: string; revenue: number | null; eps: number | null; netIncome: number | null; fcf: number | null; opMargin: number | null; shares: number | null }[];
  source: string;
}
interface Rev { period: string; now: number | null; chg90: number | null; chg30: number | null; up30: number | null; down30: number | null; growth: number | null; analysts: number | null }

interface MultiReport {
  series?: Series;
  reports: Record<ProfileId, ProfileReport>;
  cumulative: { averageScore: number; verdict: "PASS" | "FAIL" | "BORDERLINE"; passCount: number; profileCount: number };
  dataQuality?: { sourceStatus?: Record<string, string>; sources?: string[]; warnings?: string[]; fmpCalls?: number; yahooCalls?: number; finnhubCalls?: number; dbCacheHit?: boolean; coverage?: DataCoverage };
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
  if (verdict === "LIMITED") return "bg-muted/30 text-muted-foreground border-border";
  return "bg-[hsl(40,90%,55%)]/15 text-[hsl(40,90%,55%)] border-[hsl(40,90%,55%)]/40";
}

function VerdictBadge({ verdict, score, label, tone }: { verdict: string; score: number; label?: string; tone?: string }) {
  return (
    <div className={`inline-flex flex-col items-center justify-center rounded-xl border-2 px-6 py-4 ${verdictClasses(tone ?? verdict)}`}>
      <div className="text-4xl font-extrabold tracking-tight tabular-nums">{score}</div>
      {label && <div className="mt-0.5 text-[10px] text-muted-foreground">{label}</div>}
      <div className="mt-2 text-2xl font-extrabold tracking-widest">{verdict}</div>
    </div>
  );
}

/** Stock title, the three scores as compact pills, and a key-stats strip (the "data panel"). */
function StockHeader({ multi, header, fromCache, loading, onRefresh }: {
  multi: MultiReport; header: ProfileReport; fromCache: boolean; loading: boolean; onRefresh: () => void;
}) {
  const s = multi.series;
  const pills: { label: string; score: number; verdict: string; tone: string }[] = [];
  for (const k of ["momentum", "quality"] as const) {
    const pr = s?.profiles?.[k];
    if (pr && pr.score !== null) pills.push({ label: pr.label, score: pr.score, verdict: pr.verdict, tone: pr.verdict === "Strong" ? "PASS" : pr.verdict === "Mixed" ? "BORDERLINE" : pr.verdict === "Weak" ? "FAIL" : "LIMITED" });
  }
  const mv = multi.reports.minervini;
  if (mv) pills.push({ label: "Minervini", score: mv.overallScore, verdict: mv.verdict === "PASS" ? "Pass" : mv.verdict === "FAIL" ? "Fail" : "Borderline", tone: mv.verdict });
  const flags = s?.profiles?.redFlags?.length ?? null;
  const earnIn = s?.nextEarnings ? Math.round((Date.parse(s.nextEarnings) - Date.now()) / 86400_000) : null;
  const stats: [string, string, string?][] = [
    ["Next earnings", s?.nextEarnings ? `${new Date(s.nextEarnings + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" })}${earnIn !== null && earnIn >= 0 ? ` · ${earnIn}d` : ""}` : "—", earnIn !== null && earnIn >= 0 && earnIn <= 14 ? "text-[hsl(40,90%,60%)]" : ""],
    ["ROE", s?.roePct == null ? "—" : `${s.roePct.toFixed(0)}%`],
    ["Debt / equity", s?.debtToEquity == null ? "—" : `${s.debtToEquity.toFixed(2)}×`],
    ["Beat rate", s?.beatRate == null ? "—" : `${s.beatRate}%`],
    ["Institutions", s?.institutionalPct == null ? "—" : `${s.institutionalPct.toFixed(0)}%`],
    ["Short % float", s?.shortInterest?.shortPctFloat == null ? "—" : `${s.shortInterest.shortPctFloat.toFixed(1)}%`],
    ["Analysts buy", s?.analystRec?.buyPct == null ? "—" : `${Math.round(s.analystRec.buyPct)}%`],
    ["Red flags", flags === null ? "—" : String(flags), flags ? "text-loss-medium" : flags === 0 ? "text-gain-medium" : ""],
  ];
  return (
    <Card className="p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{header.sector || "—"}</div>
          <h2 className="mt-0.5 font-display text-3xl font-bold tracking-tight">
            {header.symbol} <span className="text-base font-medium text-muted-foreground">· {header.companyName}</span>
          </h2>
          {fromCache && (
            <button onClick={onRefresh} disabled={loading} className="mt-1 text-xs text-muted-foreground underline hover:text-foreground">
              Saved result from the last 24h — refresh
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {pills.map((p) => (
            <div key={p.label} className={`rounded-lg border-2 px-3 py-1.5 text-center ${verdictClasses(p.tone)}`}>
              <div className="text-2xl font-extrabold tabular-nums leading-none">{p.score}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">{p.label}</div>
              <div className="text-[11px] font-bold">{p.verdict}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 sm:grid-cols-4 lg:grid-cols-8">
        {stats.map(([k, v, cls]) => (
          <div key={k}>
            <div className="text-[10px] text-muted-foreground">{k}</div>
            <div className={`font-mono text-sm font-semibold ${cls ?? ""}`}>{v}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

const CACHE_KEY = (sym: string) => `minervini:v14-profiles:${sym}`;
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
          <div className="text-xs text-muted-foreground">{report.profileLabel}</div>
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
                    <span className="opacity-80">{s.label}</span>
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
          <h4 className="mb-2 flex items-center gap-2 text-xs font-bold text-gain-medium">
            <CheckCircle2 size={14} /> Bull Case
          </h4>
          <ul className="space-y-1 text-xs">
            {report.bullCase.map((b, i) => (
              <li key={i} className="flex gap-2"><span className="text-gain-medium">▲</span><span>{b}</span></li>
            ))}
          </ul>
        </div>
        <div className="rounded-md border border-loss-medium/30 bg-loss-medium/5 p-3">
          <h4 className="mb-2 flex items-center gap-2 text-xs font-bold text-loss-medium">
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
        <span className="text-xs font-bold text-muted-foreground">Final Verdict · </span>
        <span>{report.finalVerdict}</span>
      </div>
    </Card>
  );
}

export default function MinerviniChecker() {
  const [symbol, setSymbol] = useState("");
  const [loading, setLoading] = useState(false);
  const [multi, setMulti] = useState<MultiReport | null>(null);
  const [tab, setTab] = useState("overview");
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    setTab("overview");
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


  const header = multi ? Object.values(multi.reports)[0] : null;
  const sepaProps: SepaProps = {
    symbol: header?.symbol ?? "", stage: header ? stageBy.get(header.symbol) ?? null : null, base: header ? baseBy.get(header.symbol) ?? null : null,
    rs: header ? rs.get(header.symbol) ?? null : null, groupName: header ? industryOf.get(header.symbol) ?? null : null,
    group: header ? leadBy.get(industryOf.get(header.symbol) ?? "") ?? null : null, market,
    fundamentalScore: multi?.reports.minervini?.overallScore ?? null, code33: multi?.series?.code33?.count ?? null,
  };

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
          <div className="text-xs text-muted-foreground">SEPA · earnings, sales, margins, cash, quality · red flags · Minervini</div>
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
                className="pl-9 text-base font-semibold"
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

          <p className="mt-3 text-xs text-muted-foreground">
            Up to 10 years of SEC filings plus earnings and estimate data, scored only on checks that held up in a 2021–25 backtest — then lined up with your scans (Minervini's SEPA).
          </p>
        </Card>

        <SepaCandidates items={candidates} leadBy={leadBy} onPick={(sym) => runAnalysis(false, sym)} loading={loading} collapsed={!!multi} />

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
            Fetching multi-quarter financials and scoring earnings momentum, quality, red flags and Minervini (~10–20s)…
          </Card>
        )}

        {multi && header && (
          <>
            <StockHeader multi={multi} header={header} fromCache={fromCache} loading={loading} onRefresh={() => runAnalysis(true)} />

            <SummaryLine p={multi.series?.profiles ?? null} sepa={sepaSummary(sepaProps)} base={sepaProps.base} />

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="h-auto flex-wrap justify-start gap-1 bg-muted/30 p-1">
                <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
                <TabsTrigger value="earnings" className="text-xs">Earnings &amp; sales</TabsTrigger>
                <TabsTrigger value="history" className="text-xs">Long history</TabsTrigger>
                <TabsTrigger value="checklist" className="text-xs">Minervini checklist{multi.reports.minervini ? ` · ${multi.reports.minervini.overallScore}` : ""}</TabsTrigger>
                <TabsTrigger value="data" className="text-xs">Data{multi.dataQuality?.warnings?.length ? ` · ${multi.dataQuality.warnings.length} note${multi.dataQuality.warnings.length === 1 ? "" : "s"}` : ""}</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-4 space-y-6">
                {multi.series?.profiles?.momentum && <ProfileCards p={multi.series.profiles} extra={priceCards(sepaProps.stage, sepaProps.rs)} />}
                <SepaCard {...sepaProps} />
              </TabsContent>

              <TabsContent value="earnings" className="mt-4 space-y-6">
                {multi.series && multi.series.quarters.length > 0 && <QuarterTable s={multi.series} />}
                {multi.series && <ExtrasCard s={multi.series} />}
              </TabsContent>

              <TabsContent value="history" className="mt-4 space-y-6">
                {multi.series?.history ? <HistoryCard h={multi.series.history} /> : <Card className="p-5 text-sm text-muted-foreground">No filing history for this stock.</Card>}
              </TabsContent>

              <TabsContent value="checklist" className="mt-4">
                {multi.reports.minervini ? (
                  <Card className="p-5">
                    <div className="space-y-4">
                  {multi.series && <ScoreBuild s={multi.series} />}
                  <ProfileReportCard report={multi.reports.minervini} />
                </div>
                  </Card>
                ) : <Card className="p-5 text-sm text-muted-foreground">No Minervini report.</Card>}
              </TabsContent>

              <TabsContent value="data" className="mt-4">
                <Card className="p-5">
                  <div className="space-y-3 text-xs">
                  {!!multi.dataQuality?.warnings?.length && (
                    <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">{multi.dataQuality.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                  )}
                  {multi.dataQuality?.coverage && (
                    <div className="font-mono">
                      {multi.dataQuality.coverage.quarterlyRevenueYoY}/{multi.dataQuality.coverage.quarterTarget} quarterly revenue YoY · {multi.dataQuality.coverage.quarterlyEpsYoY}/{multi.dataQuality.coverage.quarterTarget} quarterly EPS YoY · {multi.dataQuality.coverage.annualRevenueYoY}/{multi.dataQuality.coverage.annualTarget} annual revenue
                    </div>
                  )}
                  {multi.dataQuality?.sourceStatus && (
                    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                      {Object.entries(multi.dataQuality.sourceStatus).map(([k, v]) => (
                        <Fragment key={k}><span className="text-muted-foreground">{k}</span><span className={v.startsWith("ok") ? "text-gain-medium" : v.startsWith("skipped") || v.startsWith("estimated") ? "" : "text-[hsl(40,90%,60%)]"}>{v}</span></Fragment>
                      ))}
                    </div>
                  )}
                  <div className="text-muted-foreground">
                    Used: {(multi.dataQuality?.sources ?? []).join(" + ") || "cache"} · Calls: FMP {multi.dataQuality?.fmpCalls ?? 0} · Yahoo {multi.dataQuality?.yahooCalls ?? 0} · Finnhub {multi.dataQuality?.finnhubCalls ?? 0}
                  </div>
                </div>
                </Card>
              </TabsContent>
            </Tabs>
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

type SepaProps = {
  symbol: string; stage: StockStage | null; base: StockBase | null; rs: number | null; groupName: string | null; group: GroupLead | null;
  market: { key: string; name: string } | null; fundamentalScore: number | null; code33: number | null;
};
function sepaSummary(props: SepaProps) {
  const pillars = sepaPillars({ ...props, code33Count: props.code33 });
  const known = pillars.filter((p) => p.mark !== "unknown");
  const passes = known.filter((p) => p.mark === "pass").length;
  const fails = known.filter((p) => p.mark === "fail").length;
  const verdict = known.length < 4 ? "Not enough data" : fails === 0 && passes >= known.length - 1 ? "Aligned" : fails <= 1 && passes >= 3 ? "Partly aligned" : "Not aligned";
  return { pillars, known, passes, fails, verdict };
}

function SepaCard(props: {
  symbol: string; stage: StockStage | null; base: StockBase | null; rs: number | null; groupName: string | null; group: GroupLead | null;
  market: { key: string; name: string } | null; fundamentalScore: number | null; code33: number | null;
}) {
  const { pillars, known, passes, verdict } = sepaSummary(props);
  const b = props.base;
  const pivot = b ? (b.pivot ?? b.features.pivot) : null, stop = b ? (b.support ?? b.features.support) : null;
  return (
    <Card className="p-5">
      <SectionHead
        title="SEPA alignment"
        sub="Minervini buys a leader only when trend, fundamentals, setup, group and market all line up."
        right={pivot !== null && stop !== null && stop < pivot ? (
          <div className="rounded-md border border-border bg-muted/20 px-3 py-1.5 text-xs">
            Buy point <b className="font-mono">{pivot.toFixed(2)}</b> · stop <b className="font-mono">{stop.toFixed(2)}</b> · risk {(((pivot - stop) / pivot) * 100).toFixed(1)}%
          </div>
        ) : undefined}
      />
      <div className={`mb-3 font-display text-2xl font-bold tracking-tight ${verdict === "Aligned" ? "text-gain-medium" : verdict === "Partly aligned" || verdict === "Not enough data" ? "text-[hsl(40,90%,60%)]" : "text-loss-medium"}`}>
        {verdict} <span className="font-sans text-sm font-medium text-muted-foreground">{passes} of {known.length} checked pillars pass</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {pillars.map((p) => (
          <div key={p.key} className={`rounded-md border px-3 py-2.5 ${MARK_CLS[p.mark]}`} title={p.detail}>
            <div className="flex items-center justify-between gap-2 text-[13px] font-semibold">
              <span className="truncate">{MARK_ICON[p.mark]} {p.label}</span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] opacity-90">{p.value}</div>
            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-foreground/70">{p.detail}</p>
          </div>
        ))}
      </div>
      <HowItWorks title="What SEPA alignment means" className="mt-3">
        <p>
          Minervini's SEPA buys leaders only when everything lines up: a Stage 2 trend that passes the Trend Template, strong and accelerating
          fundamentals, a low-risk setup (VCP) near its pivot, a strong group, and a healthy market. Trend, setup, group and market come from your
          weekly stage/base scans (as of the last scan), so they cost no extra data calls.
        </p>
      </HowItWorks>
    </Card>
  );
}

function QuarterTable({ s }: { s: Series }) {
  const q = s.quarters;
  const big = (x: number | null) => (x === null ? "—" : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(x));
  const pctCell = (x: number | null) => (x === null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(0)}%`);
  const tone = (x: number | null) => (x === null ? "" : x >= 25 ? "font-semibold text-gain-medium" : x < 0 ? "text-loss-medium" : "");
  // ▲ / ▼ = growth faster / slower than the quarter before by 5+ points (acceleration is what Minervini and O'Neil look for)
  const accel = (now: number | null, prev: number | null | undefined) =>
    now === null || prev === null || prev === undefined ? null : now - prev >= 5 ? <span className="ml-0.5 text-gain-medium">▲</span> : prev - now >= 5 ? <span className="ml-0.5 text-loss-medium">▼</span> : null;
  return (
    <Card className="p-5">
      <SectionHead
        title="Quarter by quarter"
        sub={<>Growth vs the same quarter a year earlier, newest first. <span className="text-gain-medium">Green</span> is 25% or more; ▲▼ means faster or slower than the quarter before.</>}
        right={s.code33 ? <span className="rounded border border-border px-2 py-1 text-[11px]">Code 33: EPS {s.code33.eps ? "✓" : "✗"} · sales {s.code33.sales ? "✓" : "✗"} · margin {s.code33.margin ? "✓" : "✗"}</span> : undefined}
      />
      <GrowthBars q={q} />
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
            {q.map((r, i) => (
              <tr key={r.date} className="border-b border-border/30">
                <td className="px-2 py-1 font-mono">{r.date}</td>
                <td className="px-2 py-1 text-right font-mono">{big(r.revenue)}</td>
                <td className={`px-2 py-1 text-right font-mono ${tone(r.revenueYoY)}`}>{pctCell(r.revenueYoY)}{accel(r.revenueYoY, q[i + 1]?.revenueYoY)}</td>
                <td className="px-2 py-1 text-right font-mono">{r.eps === null ? "—" : r.eps.toFixed(2)}</td>
                <td className={`px-2 py-1 text-right font-mono ${tone(r.epsYoY)}`}>{r.turnaround ? <span className="text-gain-medium">turnaround</span> : <>{pctCell(r.epsYoY)}{accel(r.epsYoY, q[i + 1]?.epsYoY)}</>}</td>
                <td className="px-2 py-1 text-right font-mono">{r.margin === null ? "—" : `${r.margin.toFixed(1)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10.5px] text-muted-foreground">A profit after a year-ago loss shows as "turnaround" instead of a misleading growth %.</p>
    </Card>
  );
}

/** Sales and EPS growth per quarter as bars (oldest → newest) — acceleration is visible at a glance. */
function GrowthBars({ q }: { q: Series["quarters"] }) {
  const rows = [...q].reverse();
  const series: { label: string; vals: (number | null)[]; turn?: boolean[] }[] = [
    { label: "Sales growth vs a year ago", vals: rows.map((r) => r.revenueYoY) },
    { label: "EPS growth vs a year ago", vals: rows.map((r) => (r.turnaround ? null : r.epsYoY)), turn: rows.map((r) => r.turnaround) },
  ];
  const all = series.flatMap((s) => s.vals).filter((x): x is number => x !== null);
  if (rows.length < 3 || all.length < 3) return null;
  const hi = Math.max(25, Math.min(200, Math.max(...all))), lo = Math.max(-100, Math.min(0, ...all));
  const span = hi - lo;
  const zero = (hi / span) * 100;                 // % from the top where 0 sits
  const yPct = (v: number) => ((hi - Math.max(lo, Math.min(hi, v))) / span) * 100;
  const qLabel = (d: string) => { const [y, m] = d.split("-").map(Number); return `Q${Math.ceil(m / 3)} '${String(y).slice(2)}`; };
  return (
    <div className="mb-4 grid gap-4 sm:grid-cols-2">
      {series.map((s) => (
        <div key={s.label} className="rounded-md border border-border/50 bg-background/30 px-3 pb-2 pt-2.5">
          <div className="mb-5 flex items-baseline justify-between text-[11px]">
            <span className="font-medium">{s.label}</span>
            <span className="text-[10px] text-muted-foreground"><span className="mr-1 inline-block w-3 border-t border-dashed border-gain-medium/60 align-middle" />25%</span>
          </div>
          <div className="relative h-24">
            <div className="pointer-events-none absolute inset-x-0 border-t border-border" style={{ top: `${zero}%` }} />
            <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-gain-medium/40" style={{ top: `${yPct(25)}%` }} />
            <div className="absolute inset-0 flex gap-1.5">
              {s.vals.map((v, i) => {
                const turn = s.turn?.[i];
                const txt = turn ? "T/A" : v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(0)}`;
                const top = v === null ? zero : Math.min(zero, yPct(v)), h = v === null ? 0 : Math.abs(yPct(v) - zero);
                const col = v === null ? "" : v >= 25 ? "hsl(150,65%,45%)" : v >= 0 ? "hsla(150,40%,45%,0.55)" : "hsl(344,75%,60%)";
                return (
                  <div key={i} className="relative flex-1" title={`${rows[i].date}: ${turn ? "turnaround (profit after a loss)" : v === null ? "no data" : `${txt}%`}`}>
                    {turn ? (
                      <div className="absolute inset-x-0 rounded-t-sm border border-dashed border-gain-medium/60" style={{ top: `${yPct(25)}%`, height: `${zero - yPct(25)}%` }} />
                    ) : v !== null && (
                      <div className={`absolute inset-x-0 ${v >= 0 ? "rounded-t-sm" : "rounded-b-sm"}`} style={{ top: `${top}%`, height: `max(${h}%, 2px)`, background: col }} />
                    )}
                    <span
                      className={`absolute inset-x-0 -translate-y-full pb-0.5 text-center font-mono text-[9.5px] ${turn ? "text-gain-medium" : v !== null && v >= 25 ? "text-foreground" : "text-muted-foreground"}`}
                      style={{ top: `${turn ? yPct(25) : v !== null && v < 0 ? zero : top}%` }}
                    >{txt}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-1 flex gap-1.5">
            {rows.map((r, i) => <span key={i} className="flex-1 truncate text-center font-mono text-[9px] text-muted-foreground">{qLabel(r.date)}</span>)}
          </div>
        </div>
      ))}
    </div>
  );
}

function SepaCandidates({ items, leadBy, onPick, loading, collapsed }: {
  items: { r: StockStage; b: StockBase | null; rs: number; g: string | null }[];
  leadBy: Map<string, GroupLead>; onPick: (sym: string) => void; loading: boolean; collapsed: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);
  useEffect(() => { setOpen(!collapsed); }, [collapsed]);
  const [onlyBases, setOnlyBases] = useState(true);
  const list = (onlyBases ? items.filter((x) => x.b && x.b.state !== "failed" && x.b.state !== "extended") : items).slice(0, 60);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setOpen(!open)} className="text-sm font-semibold">{open ? "▾" : "▸"} SEPA candidates</button>
        <span className="text-[11px] text-muted-foreground">· {items.length} stocks pass Minervini's trend rules (Stage 2, Trend Template 8/8) in your last scan — click one to analyze it</span>
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
                  <th className="px-2 py-1.5 text-left font-medium">40 weeks</th>
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
                      <td className="px-2 py-1"><WeekSpark r={r} /></td>
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

function ExtrasCard({ s }: { s: Series }) {
  const fmt = (v: number | null | undefined, suf = "%") => (v === null || v === undefined ? "—" : `${v >= 0 && suf === "%" ? "+" : ""}${v.toFixed(1)}${suf}`);
  const big = (x: number | null | undefined) => (x === null || x === undefined ? "—" : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(x));
  const rv = s.revisions;
  const si = s.shortInterest;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-4 text-xs">
        <h3 className="mb-2 font-display text-[15px] font-semibold tracking-tight">Analyst estimates</h3>
        {rv ? (
          <table className="w-full">
            <thead><tr className="text-[10.5px] text-muted-foreground"><th className="text-left font-medium">Period</th><th className="text-right font-medium">EPS est.</th><th className="text-right font-medium">30d</th><th className="text-right font-medium">90d</th><th className="text-right font-medium">Up/down 30d</th></tr></thead>
            <tbody>
              {([["This quarter", rv.thisQuarter], ["This FY", rv.thisYear], ["Next FY", rv.nextYear]] as [string, Rev | undefined][]).map(([l, r]) => (
                <tr key={l} className="border-t border-border/30">
                  <td className="py-1">{l}</td>
                  <td className="py-1 text-right font-mono">{r?.now?.toFixed(2) ?? "—"}</td>
                  <td className={`py-1 text-right font-mono ${(r?.chg30 ?? 0) > 0 ? "text-gain-medium" : (r?.chg30 ?? 0) < 0 ? "text-loss-medium" : ""}`}>{fmt(r?.chg30)}</td>
                  <td className={`py-1 text-right font-mono ${(r?.chg90 ?? 0) > 0 ? "text-gain-medium" : (r?.chg90 ?? 0) < 0 ? "text-loss-medium" : ""}`}>{fmt(r?.chg90)}</td>
                  <td className="py-1 text-right font-mono">{r ? `${r.up30 ?? 0}/${r.down30 ?? 0}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-muted-foreground">Estimate revisions unavailable (Yahoo didn't answer).</p>}
        {s.analystRec && <p className="mt-2 text-muted-foreground">Ratings: {s.analystRec.buyPct ?? "—"}% buy of {s.analystRec.analysts} analysts{s.analystRec.buyPct3mAgo !== null ? ` (3 months ago ${s.analystRec.buyPct3mAgo}%)` : ""}.</p>}
        <p className="mt-1 text-[10.5px] text-muted-foreground">Rising estimates confirm the growth is lasting; ratings themselves carry little signal.</p>
      </Card>
      <Card className="p-4 text-xs">
        <h3 className="mb-2 font-display text-[15px] font-semibold tracking-tight">Earnings track</h3>
        <div>EPS surprises: <span className="font-mono">{s.surprises.length ? s.surprises.slice(0, 6).map((x) => `${x >= 0 ? "+" : ""}${x.toFixed(0)}%`).join(" ") : "—"}</span></div>
        <div className="mt-1">Revenue surprises: <span className="font-mono">{s.revSurprises?.length ? s.revSurprises.slice(0, 6).map((x) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`).join(" ") : "—"}</span></div>
        <div className="mt-1">Next report: <b>{s.nextEarnings ?? "—"}</b></div>
        <p className="mt-2 text-[10.5px] text-muted-foreground">Beats on both EPS and sales have been the more durable kind. Holding through a report is a sizing decision: a gap can jump past your stop.</p>
      </Card>
      <Card className="p-4 text-xs">
        <h3 className="mb-2 font-display text-[15px] font-semibold tracking-tight">Float &amp; short interest</h3>
        {si && (si.floatShares !== null || si.shortPctFloat !== null) ? (
          <>
            <div>Float: <b className="font-mono">{big(si.floatShares)}</b> shares</div>
            <div className="mt-1">Short interest: <b className="font-mono">{si.shortPctFloat === null ? "—" : `${si.shortPctFloat.toFixed(1)}% of float`}</b>{si.daysToCover !== null ? ` · ${si.daysToCover.toFixed(1)} days to cover` : ""}</div>
            <p className="mt-2 text-[10.5px] text-muted-foreground">
              {(si.shortPctFloat ?? 0) >= 20 ? "Crowded short: breakouts can be explosive but fail violently — size from gap risk. " : (si.shortPctFloat ?? 0) >= 10 ? "Elevated short interest: find out why before buying. " : "Little short pressure. "}
              Short sellers are informed on average, so high short interest is a risk factor, not fuel, unless news breaks the bear case. Reported twice a month (delayed).
            </p>
          </>
        ) : <p className="text-muted-foreground">Unavailable (Yahoo didn't answer).</p>}
      </Card>
    </div>
  );
}

function ScoreBuild({ s }: { s: Series }) {
  if (!s.scoreParts?.length) return null;
  return (
    <div className="text-xs">
      <h3 className="mb-2 font-display text-[15px] font-semibold tracking-tight">How the score is built <span className="font-normal text-muted-foreground">· only parts with data count · data coverage {s.scoreCoveragePct ?? "—"}%</span></h3>
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {s.scoreParts.map((p) => (
          <div key={p.label} className="grid grid-cols-[1fr_80px_40px] items-center gap-2">
            <span>{p.label}</span>
            <span className="h-1.5 overflow-hidden rounded bg-muted"><span className="block h-full bg-primary" style={{ width: `${(p.earned / p.max) * 100}%` }} /></span>
            <span className="text-right font-mono text-muted-foreground">{p.earned}/{p.max}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Every number below comes from the point-in-time backtest: ~450 US filers from the app's list,
// 16 quarterly dates (Nov 2021 – Aug 2025), SEC filings as they stood on each date, returns vs SPY.
// Survivorship-biased (only names on today's list), so absolute returns look worse than reality;
// the comparisons between groups are what matter.
const EVIDENCE: Record<string, string> = {
  turnaround:
    "Scored only for companies that lost money (or had a negative operating margin) in the last two years. Checks whether EPS flipped positive, the last 12 months are profitable, margins and cash flow are improving and sales are growing. Rule-based, not backtested.",
  st_momentum:
    "Price strength over the last 1–4 weeks, from the weekly Stages scan's daily snapshot: return vs the market, RS rating, distance from the 52-week high, position vs the 21-day EMA (not stretched) and volume. Rule-based, not backtested.",
  setup:
    "A strong stock pausing in a tight base near its high: Stage 2, Minervini trend template, 10-day range vs normal daily range, distance to the top of the base, volume drying up, RS rating. Rule-based, not backtested.",
  momentum:
    "Tested twice. First test (450 companies, 2021–25): ranked stocks the right way at 13, 26 and 52 weeks; Strong beat Weak by a median 4 pts over 26 weeks. Second test (619 companies, 2019–25): still ranked the right way in both halves, Strong −3 vs Weak −5 vs SPY, with fewer big losses (20% vs 24%). Parts marked * are live data with no history to test (research-backed).",
  growth:
    "Second test (619 companies, Nov 2019 – Aug 2025, 26 weeks ahead): ranked stocks the right way in both 2019–22 and 2023–25. Strong −2 vs Weak −5 vs SPY (median). A modest tilt: it doesn't raise the odds of a big winner.",
  margins:
    "Second test: ranked stocks the right way in both halves (strongest in 2023–25). Strong −3 vs Weak −6 vs SPY, and fewer big losses (21% vs 24% lagged SPY by 25+ pts).",
  cash:
    "Second test: ranked stocks the right way in both halves. Its clearest effect is on risk: 19% of Strong vs 28% of Weak lagged SPY by 25+ pts over 26 weeks (median −3 vs −6).",
  quality:
    "Tested: didn't add return in the 2023–25 rally, but in both halves the Strong group had far fewer big losses (lagging SPY by 25+ pts over 26 weeks, Strong vs Weak: 10% vs 34% in 2021–23, 20% vs 28% in 2023–25).",
  flags:
    "Each flag raised the share of stocks that lagged SPY by 25+ pts over the next 26 weeks (all stocks: 22%). With 3+ flags it was 39%.",
};
const FLAG_EVIDENCE: Record<string, string> = { ps: "42% lagged SPY by 25+ pts (median −18)", assets: "35% lagged by 25+ pts (median −14)", dilution: "33% lagged by 25+ pts (median −10)", burn: "32% lagged by 25+ pts (median −7)", expect: "32% lagged by 25+ pts (median −8)" };

/** Short-term momentum and breakout setup as profile cards (live, from the Stages data). */
function priceCards(stage: StockStage | null, rs: number | null): HProfile[] {
  if (!stage) return [];
  const make = (key: "st_momentum" | "setup", label: string, horizon: string, question: string): HProfile | null => {
    const r = key === "st_momentum" ? shortTermMomentum({ stage, rsRating: rs }) : breakoutSetup({ stage, rsRating: rs });
    if (r.score === null) return null;
    const verdict: HProfile["verdict"] = r.score >= 70 ? "Strong" : r.score >= 40 ? "Mixed" : "Weak";
    return {
      key, label, horizon, question, score: r.score, coverage: 100, verdict,
      parts: r.parts.map((x) => ({ label: x.label, earned: x.earned, max: x.max, value: x.value, good: x.good })),
      strengths: r.parts.filter((x) => x.good === true).map((x) => `${x.label}: ${x.value}`),
      weaknesses: r.parts.filter((x) => x.good === false).map((x) => `${x.label}: ${x.value}`),
    };
  };
  return [
    make("st_momentum", "Short-term momentum", "next 1–4 weeks", "Is the price acting strong right now?"),
    make("setup", "Breakout setup", "ready now?", "Is it pausing in a tight base near its high?"),
  ].filter((x): x is HProfile => !!x);
}

const VERDICT_CLS: Record<HProfile["verdict"], string> = {
  Strong: "border-gain-medium/50 bg-gain-medium/10 text-gain-medium",
  Mixed: "border-[hsl(40,90%,55%)]/50 bg-[hsl(40,90%,55%)]/10 text-[hsl(40,90%,60%)]",
  Weak: "border-loss-medium/50 bg-loss-medium/10 text-loss-medium",
  "Limited data": "border-border bg-muted/20 text-muted-foreground",
};

/** One-line read of momentum × quality × flags, with the tested outcome for that group. */
function combinedRead(m: HProfile | undefined, q: HProfile | undefined, flags: RedFlag[]): { tone: "good" | "bad" | "neutral"; text: string } | null {
  if (!m || m.score === null || m.verdict === "Limited data") return null;
  const qs = q && q.verdict !== "Limited data" ? q.score : null;
  if (flags.length >= 3) return { tone: "bad", text: `${flags.length} red flags. In testing, stocks with 3+ flags lagged SPY by a median 16 pts over 26 weeks, and 39% lagged by 25+ pts.` };
  if (m.score >= 70 && qs !== null && qs >= 55) return { tone: "good", text: "In testing this was the best combination: a median 0 vs SPY over 26 weeks (all stocks −4), and only 13% lagged SPY by 25+ points (all stocks 22%)." };
  if (m.score >= 70 && qs !== null && qs < 40) return { tone: "neutral", text: "In testing this mix had more big losses: 28% lagged SPY by 25+ points over 26 weeks (all stocks 22%). Size the position for it." };
  if (m.score < 40 && qs !== null && qs < 40) return { tone: "bad", text: "The weakest group in testing: a median −9 vs SPY over 26 weeks, and 31% lagged by 25+ points." };
  return null;
}

/** Bottom line for one stock: what the tested fundamentals say, the red flags, and whether SEPA lines up. */
function SummaryLine({ p, sepa, base }: { p: Profiles | null; sepa: ReturnType<typeof sepaSummary>; base: StockBase | null }) {
  const m = p?.momentum, q = p?.quality, flags = p?.redFlags ?? [];
  const ms = m && m.verdict !== "Limited data" ? m.score : null, qs = q && q.verdict !== "Limited data" ? q.score : null;
  const read = combinedRead(m, q, flags);
  let title: string;
  if (ms === null) title = "Not enough filing history to judge the fundamentals.";
  else if (ms >= 70 && qs !== null && qs >= 55) title = "Rising earnings on a solid business.";
  else if (ms >= 70 && qs !== null && qs < 40) title = "Earnings are rising, but it's a low-quality business.";
  else if (ms < 40 && qs !== null && qs < 40) title = "Earnings are fading and the business is low quality.";
  else if (ms >= 70) title = "Earnings are rising strongly.";
  else if (ms < 40) title = "Earnings momentum is weak.";
  else title = "Earnings momentum is mixed.";
  const tone = flags.length >= 3 || (ms !== null && ms < 40) ? "bad" : ms !== null && ms >= 70 && flags.length <= 1 ? "good" : "warn";
  const failing = sepa.pillars.filter((x) => x.mark === "fail" || x.mark === "partial").map((x) => x.label.toLowerCase());
  const pivot = base ? (base.pivot ?? base.features.pivot) : null, stop = base ? (base.support ?? base.features.support) : null;
  return (
    <BottomLine
      tone={tone}
      title={title}
      lines={[
        read ? read.text : null,
        p?.type?.key === "speculative" ? <>Speculative company ({p.type.detail}): in testing {p.type.winPct}% of these beat SPY by 50+ pts over 26 weeks and {p.type.lossPct}% lagged by 25+ — the scores barely changed those odds, so size for the risk.</> : null,
        flags.length ? <>{flags.length} red flag{flags.length === 1 ? "" : "s"}: {flags.map((f) => f.label.toLowerCase()).join("; ")}.</> : <>No red flags.</>,
        sepa.verdict === "Not enough data"
          ? <>SEPA: this stock isn't in your last stage/base scan, so trend, setup and group can't be checked.</>
          : <>SEPA: <b className="text-foreground/90">{sepa.verdict.toLowerCase()}</b>{failing.length && sepa.verdict !== "Aligned" ? ` — not there yet on ${failing.join(", ")}` : ""}{pivot !== null && stop !== null && stop < pivot ? `. Buy point ${pivot.toFixed(2)}, stop ${stop.toFixed(2)}.` : "."}</>,
      ]}
    />
  );
}

function ProfileCards({ p, extra = [] }: { p: Profiles; extra?: HProfile[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const flags = p.redFlags ?? [];
  // Turnaround only when there was something to turn around; price profiles come from the Stages data.
  const cards = [p.momentum, p.growth, p.margins, p.cash, p.quality, p.turnaround?.score != null ? p.turnaround : undefined, ...extra]
    .filter((x): x is HProfile => !!x);
  const growthSet = [p.momentum, p.growth, p.margins, p.cash].filter((x): x is HProfile => !!x && x.verdict !== "Limited data");
  const strongN = growthSet.filter((x) => x.verdict === "Strong").length;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        {p.type && <TypeCard t={p.type} momentum={p.momentum} />}
        {growthSet.length >= 2 && <AgreementCard set={growthSet} strongN={strongN} />}
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((h) => (
          <Card key={h.key} className="flex flex-col p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] text-muted-foreground">{h.label} · {h.horizon}</div>
                <div className="mt-0.5 text-sm font-semibold">{h.question}</div>
              </div>
              <div className={`shrink-0 rounded-lg border px-3 py-1.5 text-center ${VERDICT_CLS[h.verdict]}`}>
                <div className="text-2xl font-extrabold tabular-nums leading-none">{h.score ?? "—"}</div>
                <div className="mt-0.5 text-[10px] font-semibold">{h.verdict}</div>
              </div>
            </div>
            <div className="mt-3 space-y-1 text-xs">
              {h.strengths.slice(0, 3).map((x) => <div key={x} className="flex gap-1.5"><span className="text-gain-medium">▲</span><span>{x}</span></div>)}
              {h.weaknesses.slice(0, 3).map((x) => <div key={x} className="flex gap-1.5"><span className="text-loss-medium">▼</span><span>{x}</span></div>)}
              {!h.strengths.length && !h.weaknesses.length && <div className="text-muted-foreground">No standout readings.</div>}
            </div>
            <button onClick={() => setOpen(open === h.key ? null : h.key)} className="mt-3 self-start text-[11px] text-primary hover:underline">
              {open === h.key ? "Hide" : "Show"} all {h.parts.length} checks · tested data coverage {h.coverage}%
            </button>
            {open === h.key && (
              <div className="mt-2 space-y-1 text-[11px]">
                {h.parts.map((x) => (
                  <div key={x.label} className="grid grid-cols-[1fr_auto] gap-2 border-b border-border/30 pb-1">
                    <span>{x.label}{x.tested === false && <span className="text-muted-foreground"> *</span>}<span className="block font-mono text-muted-foreground">{x.value}</span></span>
                    <span className={`self-center font-mono ${x.earned >= x.max * 0.7 ? "text-gain-medium" : x.earned <= x.max * 0.25 ? "text-loss-medium" : ""}`}>{x.earned}/{x.max}</span>
                  </div>
                ))}
              </div>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="mt-auto inline-flex cursor-help items-center gap-1 self-start pt-3 text-[11px] text-muted-foreground"><Info size={12} /> {CAPTION[h.key] ?? "Backtested"}</span>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm text-xs leading-relaxed">{EVIDENCE[h.key]}</TooltipContent>
            </Tooltip>
          </Card>
        ))}
        <Card className="flex flex-col p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] text-muted-foreground">Red flags · tested warning signs</div>
              <div className="mt-0.5 text-sm font-semibold">What tends to go wrong?</div>
            </div>
            <div className={`shrink-0 rounded-lg border px-3 py-1.5 text-center ${flags.length === 0 ? VERDICT_CLS.Strong : flags.length >= 3 ? VERDICT_CLS.Weak : VERDICT_CLS.Mixed}`}>
              <div className="text-2xl font-extrabold tabular-nums leading-none">{flags.length}</div>
              <div className="mt-0.5 text-[10px] font-semibold">{flags.length === 1 ? "flag" : "flags"}</div>
            </div>
          </div>
          <div className="mt-3 space-y-2 text-xs">
            {flags.map((f) => (
              <div key={f.key}>
                <div className="flex gap-1.5"><span className="text-loss-medium">⚑</span><span className="font-medium">{f.label}</span></div>
                <div className="pl-5 text-[11px] text-muted-foreground">{f.detail}{FLAG_EVIDENCE[f.key] ? ` · tested: ${FLAG_EVIDENCE[f.key]}` : ""}</div>
              </div>
            ))}
            {!flags.length && <div className="text-muted-foreground">None of the tested warning signs: price above 20× sales, assets up 50%+, shares up 10%+, losses with cash burn, or years of 25%+ growth already priced in.</div>}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="mt-auto inline-flex cursor-help items-center gap-1 self-start pt-3 text-[11px] text-muted-foreground"><Info size={12} /> Backtested: each flag raised the odds of a big loss</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm text-xs leading-relaxed">{EVIDENCE.flags}</TooltipContent>
          </Tooltip>
        </Card>
      </div>
      <HowItWorks title="How these scores were tested">
        <p>
        Backtest: ~450 US companies from your list, 16 dates (Nov 2021 – Aug 2025), filings as they stood on each date, returns vs SPY.
        Only names on today's list were tested (survivorship bias), so treat the absolute numbers loosely and compare the groups with each other.
        Dropped because they failed the test: sales-growth level and consistency, multi-year growth records, accruals, debt / equity.
      </p>
      <p>
        Second test (Oct 2026): 619 companies, 24 quarterly dates from Nov 2019 to Aug 2025, 13,008 stock-dates, returns vs SPY 26 weeks later.
        A new profile was kept only if it ranked stocks the right way in both 2019–22 and 2023–25: sales acceleration, margin expansion and cash flow passed.
        Dropped: a turnaround profile (mostly the same stocks earnings momentum already flags, and no better when the two disagreed) and a steady-compounder
        profile (ranked stocks the wrong way in 2019–22). The honest limit: about 1 in 10 stocks beat SPY by 50+ points over 26 weeks whatever their scores —
        big winners came mostly from small or loss-making companies, where these scores barely changed the odds.
      </p>
      </HowItWorks>
    </div>
  );
}

const CAPTION: Record<string, string> = {
  momentum: "Backtested: predicted returns 3–12 months out",
  growth: "Backtested: a modest tilt toward better returns",
  margins: "Backtested: better returns, fewer big losses",
  cash: "Backtested: fewer big losses",
  quality: "Backtested: fewer big losses, not more return",
  turnaround: "Rule-based (not backtested)",
  st_momentum: "Live price check (not backtested)",
  setup: "Live price check (not backtested)",
};
// Second test, 26 weeks ahead vs SPY: median, and share that lagged SPY by 25+ pts, by how many of the four growth checks were Strong.
const AGREE_EVIDENCE = [
  { n: "0", med: -5, loss: 26 }, { n: "1", med: -4, loss: 22 }, { n: "2", med: -3, loss: 21 }, { n: "3–4", med: -2, loss: 19 },
];

/** Company type with the measured odds of a big win and a big loss. Not a score. */
function TypeCard({ t, momentum }: { t: CompanyType; momentum?: HProfile }) {
  const spec = t.key === "speculative";
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] text-muted-foreground">Company type · upside and risk</div>
          <div className="mt-0.5 font-display text-lg font-semibold tracking-tight">{t.label}</div>
          <div className="text-[11px] text-muted-foreground">{t.detail}</div>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 text-center">
          <div className="rounded-md border border-gain-medium/40 bg-gain-medium/10 px-2.5 py-1.5"><div className="font-mono text-lg font-bold text-gain-medium">{t.winPct}%</div><div className="text-[10px] text-muted-foreground">big winners</div></div>
          <div className="rounded-md border border-loss-medium/40 bg-loss-medium/10 px-2.5 py-1.5"><div className="font-mono text-lg font-bold text-loss-medium">{t.lossPct}%</div><div className="text-[10px] text-muted-foreground">big losers</div></div>
        </div>
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
        Of companies like this in the test, {t.winPct}% beat SPY by 50+ points over the next 26 weeks and {t.lossPct}% lagged it by 25+.
        {spec
          ? <> Most big winners came from this group — and most big losers. Here the fundamental scores barely changed the odds{momentum && momentum.verdict === "Weak" ? ", so a Weak score is not a reason to rule it out on its own" : ""}: size for the risk and let the chart decide.</>
          : <> The scores below matter more here: for profitable companies they separated better and worse stocks more clearly.</>}
      </p>
    </Card>
  );
}

/** How many of the four growth-side profiles agree, with what each count did in testing. */
function AgreementCard({ set, strongN }: { set: HProfile[]; strongN: number }) {
  const row = strongN >= 3 ? 3 : strongN;
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] text-muted-foreground">Agreement · earnings, sales, margins, cash</div>
          <div className="mt-0.5 font-display text-lg font-semibold tracking-tight">Strong on {strongN} of {set.length}</div>
          <div className="flex flex-wrap gap-1 pt-1">
            {set.map((h) => <span key={h.key} className={`rounded border px-1.5 py-[1px] text-[10.5px] ${VERDICT_CLS[h.verdict]}`}>{h.label}: {h.verdict}</span>)}
          </div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[10.5px]">
        {AGREE_EVIDENCE.map((e, i) => (
          <div key={e.n} className={`rounded px-1 py-1 ${i === row ? "bg-primary/15 text-foreground ring-1 ring-primary/50" : "bg-muted/20 text-muted-foreground"}`}>
            <div className="font-medium">{e.n} strong</div>
            <div className="font-mono">{e.med} vs SPY</div>
            <div className="font-mono">{e.loss}% big losers</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Tested: the more of these agree, the better the median and the fewer big losses — in both 2019–22 and 2023–25.</p>
    </Card>
  );
}

function HistoryCard({ h }: { h: History }) {
  const [view, setView] = useState<"quarters" | "years">("quarters");
  const big = (x: number | null) => (x === null ? "—" : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(x));
  const q = [...h.quarters].reverse();              // oldest → newest for the chart
  const W = 720, H = 150, pad = 4;
  const revMax = Math.max(1, ...q.map((x) => x.revenue ?? 0));
  const yoy = q.map((x) => x.revenueYoY);
  const yv = yoy.filter((v): v is number => v !== null);
  const yLo = Math.min(0, ...yv), yHi = Math.max(10, ...yv);
  const bw = (W - pad * 2) / Math.max(1, q.length);
  const Y = (v: number) => H - 18 - ((v - yLo) / (yHi - yLo || 1)) * (H - 30);
  const line = yoy.map((v, i) => (v === null ? null : `${(pad + bw * i + bw / 2).toFixed(1)},${Y(v).toFixed(1)}`)).filter(Boolean).join(" ");
  return (
    <Card className="p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="font-display text-[15px] font-semibold tracking-tight">Long history</h3>
        <span className="text-[11px] text-muted-foreground">· from {h.source}</span>
        <div className="ml-auto inline-flex rounded-md border border-border bg-muted/20 p-0.5">
          {(["quarters", "years"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded px-2 py-0.5 text-[11px] ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {v === "quarters" ? `${h.quarters.length} quarters` : `${h.years.length} years`}
            </button>
          ))}
        </div>
      </div>
      {view === "quarters" ? (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" preserveAspectRatio="none" aria-label="Quarterly sales (bars) and sales growth year over year (line)">
            {q.map((x, i) => {
              const hgt = ((x.revenue ?? 0) / revMax) * (H - 30);
              return <rect key={x.end} x={pad + bw * i + bw * 0.15} y={H - 18 - hgt} width={bw * 0.7} height={hgt} fill="hsl(222,70%,60%)" opacity={0.35} />;
            })}
            {yLo < 0 && <line x1={0} x2={W} y1={Y(0)} y2={Y(0)} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
            <polyline points={line} fill="none" stroke="hsl(150,65%,50%)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            {q.map((x, i) => (i % 4 === 0 ? <text key={x.end} x={pad + bw * i} y={H - 4} fontSize="10" fill="currentColor" opacity={0.55}>{x.end.slice(0, 7)}</text> : null))}
          </svg>
          <div className="mt-1 flex flex-wrap gap-x-4 text-[10.5px] text-muted-foreground">
            <span><span className="text-[hsl(222,70%,70%)]">■</span> quarterly sales</span>
            <span><span className="text-gain-medium">—</span> sales growth vs a year earlier (range {yLo.toFixed(0)}% to {yHi.toFixed(0)}%)</span>
            <span>Acceleration = the line rising; a peak and roll-over often comes before the stock tops.</span>
          </div>
        </>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-[10.5px] text-muted-foreground">
                <th className="px-2 py-1.5 text-left font-medium">Fiscal year end</th>
                <th className="px-2 py-1.5 text-right font-medium">Sales</th>
                <th className="px-2 py-1.5 text-right font-medium">Growth</th>
                <th className="px-2 py-1.5 text-right font-medium">EPS</th>
                <th className="px-2 py-1.5 text-right font-medium">Op. margin</th>
                <th className="px-2 py-1.5 text-right font-medium">Free cash flow</th>
                <th className="px-2 py-1.5 text-right font-medium">Shares</th>
              </tr>
            </thead>
            <tbody>
              {h.years.map((y, i) => {
                const prev = h.years[i + 1];
                const g = prev?.revenue && y.revenue !== null ? (y.revenue / prev.revenue - 1) * 100 : null;
                return (
                  <tr key={y.end} className="border-b border-border/30">
                    <td className="px-2 py-1 font-mono">{y.end}</td>
                    <td className="px-2 py-1 text-right font-mono">{big(y.revenue)}</td>
                    <td className={`px-2 py-1 text-right font-mono ${g === null ? "" : g >= 15 ? "text-gain-medium" : g < 0 ? "text-loss-medium" : ""}`}>{g === null ? "—" : `${g >= 0 ? "+" : ""}${g.toFixed(0)}%`}</td>
                    <td className="px-2 py-1 text-right font-mono">{y.eps === null ? "—" : y.eps.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right font-mono">{y.opMargin === null ? "—" : `${y.opMargin.toFixed(1)}%`}</td>
                    <td className={`px-2 py-1 text-right font-mono ${(y.fcf ?? 0) < 0 ? "text-loss-medium" : ""}`}>{big(y.fcf)}</td>
                    <td className="px-2 py-1 text-right font-mono text-muted-foreground">{big(y.shares)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1 text-[10.5px] text-muted-foreground">EPS and share counts are adjusted for stock splits. A rising share count means dilution.</p>
        </div>
      )}
    </Card>
  );
}
