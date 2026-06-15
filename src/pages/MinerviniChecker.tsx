import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
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

type ProfileId = "minervini" | "oneil" | "ryan";

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

interface MultiReport {
  reports: Record<ProfileId, ProfileReport>;
  cumulative: { averageScore: number; verdict: "PASS" | "FAIL" | "BORDERLINE"; passCount: number; profileCount: number };
  dataQuality?: { sources?: string[]; warnings?: string[]; fmpCalls?: number; yahooCalls?: number; finnhubCalls?: number; dbCacheHit?: boolean; coverage?: DataCoverage };
}

const PROFILES: { id: ProfileId; label: string; short: string }[] = [
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

const CACHE_KEY = (sym: string) => `minervini:v6-coverage:${sym}`;
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
  try { localStorage.setItem(CACHE_KEY(sym), JSON.stringify({ ts: Date.now(), data })); } catch {}
}

function ProfileReportCard({ report }: { report: ProfileReport }) {
  return (
    <Card className="p-5 space-y-4">
      <div className="flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">{report.profileLabel}</div>
          <p className="mt-2 text-sm text-foreground/90">{report.headline}</p>
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
  const [activeProfiles, setActiveProfiles] = useState<ProfileId[]>(["minervini", "oneil", "ryan"]);

  const runAnalysis = async (force = false) => {
    const sym = symbol.trim().toUpperCase();
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
      const result: MultiReport = { reports: data.reports, cumulative: data.cumulative, dataQuality: data.dataQuality };
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
          <div className="text-xs text-muted-foreground">Minervini · O'Neil · Ryan · FMP + Yahoo</div>
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
                    return <VerdictBadge key={p} verdict={r.verdict} score={r.overallScore} label={PROFILES.find(x => x.id === p)?.short} />;
                  })}
                </div>
              </div>
            </Card>

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

            {activeProfiles.map(p => (
              <ProfileReportCard key={p} report={multi.reports[p]} />
            ))}

            {cumulativeActive && (
              <Card className={`border-2 p-6 ${verdictClasses(cumulativeActive.verdict)}`}>
                <div className="flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-widest text-muted-foreground">Cumulative Score</div>
                    <h3 className="mt-1 text-2xl font-extrabold tracking-tight">
                      Average across {cumulativeActive.profileCount} active profile{cumulativeActive.profileCount > 1 ? "s" : ""}
                    </h3>
                    <p className="mt-1 text-sm text-foreground/90">
                      {cumulativeActive.passCount}/{cumulativeActive.profileCount} profiles rated PASS individually.
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
