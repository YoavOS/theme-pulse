import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, CheckCircle2, XCircle, MinusCircle, Search, Trophy, AlertTriangle } from "lucide-react";
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

interface MinerviniReport {
  symbol: string;
  companyName: string;
  sector: string | null;
  overallScore: number;
  verdict: "PASS" | "FAIL" | "BORDERLINE";
  headline: string;
  criteria: Criterion[];
  bullCase: string[];
  bearCase: string[];
  finalVerdict: string;
}

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

function VerdictBadge({ verdict, score }: { verdict: string; score: number }) {
  const isPass = verdict === "PASS";
  const isFail = verdict === "FAIL";
  const cls = isPass
    ? "bg-gain-medium/15 text-gain-medium border-gain-medium/40"
    : isFail
    ? "bg-loss-medium/15 text-loss-medium border-loss-medium/40"
    : "bg-[hsl(40,90%,55%)]/15 text-[hsl(40,90%,55%)] border-[hsl(40,90%,55%)]/40";
  return (
    <div className={`inline-flex flex-col items-center justify-center rounded-xl border-2 px-8 py-6 ${cls}`}>
      <div className="text-5xl font-extrabold tracking-tight tabular-nums">{score}</div>
      <div className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">Minervini Score</div>
      <div className="mt-3 text-3xl font-extrabold tracking-widest">{verdict}</div>
    </div>
  );
}

export default function MinerviniChecker() {
  const [symbol, setSymbol] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<MinerviniReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = async () => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("minervini-analysis", {
        body: { symbol: sym },
      });
      if (fnErr) throw new Error(fnErr.message);
      if (data?.error) throw new Error(data.error);
      if (!data?.report) throw new Error("No report returned");
      setReport(data.report as MinerviniReport);
      toast.success(`Analysis complete for ${sym}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(`Failed: ${msg}`);
    } finally {
      setLoading(false);
    }
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
              Minervini Checker
            </h1>
          </div>
          <div className="text-xs text-muted-foreground">SEPA Fundamentals · Groq Llama 3.3 70B</div>
        </div>
      </header>

      <main className="container space-y-6 py-6">
        {/* Search */}
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
              onClick={runAnalysis}
              disabled={loading || !symbol.trim()}
              size="lg"
              className="bg-[hsl(280,70%,60%)] text-white hover:bg-[hsl(280,70%,55%)] font-bold"
            >
              {loading ? (
                <><Loader2 size={18} className="mr-2 animate-spin" /> Analyzing…</>
              ) : (
                <><Trophy size={18} className="mr-2" /> Run Minervini Analysis</>
              )}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Analyzes quarterly EPS/sales growth, ROE, margins, debt, cash flow, and institutional sponsorship against Mark Minervini's SEPA criteria.
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

        {loading && !report && (
          <Card className="p-10 text-center text-sm text-muted-foreground">
            <Loader2 size={28} className="mx-auto mb-3 animate-spin text-[hsl(280,70%,60%)]" />
            Fetching financials and running SEPA analysis (~10–20s)…
          </Card>
        )}

        {report && (
          <>
            {/* Header card with verdict */}
            <Card className="p-6">
              <div className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">{report.sector || "—"}</div>
                  <h2 className="mt-1 text-3xl font-extrabold tracking-tight">
                    {report.symbol} <span className="text-base font-medium text-muted-foreground">· {report.companyName}</span>
                  </h2>
                  <p className="mt-2 text-base text-foreground/90">{report.headline}</p>
                </div>
                <VerdictBadge verdict={report.verdict} score={report.overallScore} />
              </div>
            </Card>

            {/* Criteria breakdown */}
            <Card className="p-5">
              <h3 className="mb-4 text-sm font-bold uppercase tracking-widest text-muted-foreground">
                Fundamental Criteria Breakdown
              </h3>
              <div className="grid gap-2 md:grid-cols-2">
                {report.criteria.map((c, i) => (
                  <div key={i} className={`rounded-md p-3 ${STATUS_BG[c.status]}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 font-semibold">
                        {STATUS_ICON[c.status]}
                        <span>{c.name}</span>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        Target: <span className="font-mono">{c.target}</span>
                      </div>
                    </div>
                    <div className="mt-1 ml-7 font-mono text-base font-bold">
                      {c.value}
                    </div>
                    <div className="mt-1 ml-7 text-xs text-muted-foreground">{c.comment}</div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Bull / Bear */}
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="border-gain-medium/30 bg-gain-medium/5 p-5">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-gain-medium">
                  <CheckCircle2 size={16} /> Bull Case
                </h3>
                <ul className="space-y-2 text-sm">
                  {report.bullCase.map((b, i) => (
                    <li key={i} className="flex gap-2"><span className="text-gain-medium">▲</span><span>{b}</span></li>
                  ))}
                </ul>
              </Card>
              <Card className="border-loss-medium/30 bg-loss-medium/5 p-5">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-loss-medium">
                  <XCircle size={16} /> Bear Case / Risks
                </h3>
                <ul className="space-y-2 text-sm">
                  {report.bearCase.map((b, i) => (
                    <li key={i} className="flex gap-2"><span className="text-loss-medium">▼</span><span>{b}</span></li>
                  ))}
                </ul>
              </Card>
            </div>

            {/* Final verdict */}
            <Card className="p-5">
              <h3 className="mb-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">Final Verdict</h3>
              <p className="text-base leading-relaxed text-foreground/90">{report.finalVerdict}</p>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
