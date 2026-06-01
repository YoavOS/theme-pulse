import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Sparkles, TrendingUp, Briefcase, Scale } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  symbol: string;
  companyName?: string | null;
  sector?: string | null;
  price?: number | null;
  return1d?: number | null;
  return1w?: number | null;
  return1m?: number | null;
  rsRating?: number | null;
}

interface Analysis {
  shortTerm: string[];
  longTerm: string[];
  outlook: string;
  generatedAt?: string;
}

const cacheKey = (s: string) => `stockDrivers:${s}`;
const TTL_MS = 1000 * 60 * 60 * 6; // 6h

export default function StockDriversCard(props: Props) {
  const { symbol } = props;
  const [data, setData] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (force = false) => {
    if (!force) {
      try {
        const raw = localStorage.getItem(cacheKey(symbol));
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.ts && Date.now() - parsed.ts < TTL_MS && parsed.data) {
            setData(parsed.data);
            return;
          }
        }
      } catch {}
    }
    setLoading(true);
    setError(null);
    try {
      const { data: resp, error: fnErr } = await supabase.functions.invoke("stock-drivers-analysis", {
        body: {
          symbol,
          companyName: props.companyName,
          sector: props.sector,
          price: props.price,
          return1d: props.return1d,
          return1w: props.return1w,
          return1m: props.return1m,
          rsRating: props.rsRating,
        },
      });
      if (fnErr) throw new Error(fnErr.message);
      if ((resp as any)?.error) throw new Error((resp as any).error);
      setData(resp as Analysis);
      try { localStorage.setItem(cacheKey(symbol), JSON.stringify({ ts: Date.now(), data: resp })); } catch {}
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setData(null);
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  return (
    <div className="rounded-xl border border-border/60 p-5" style={{ background: "rgba(255,255,255,0.03)" }}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-primary" />
          <h3 className="font-['Syne',sans-serif] text-base font-semibold">Stock Drivers — {symbol}</h3>
          <span className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">AI</span>
        </div>
        <button onClick={() => load(true)} disabled={loading}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </button>
      </div>

      {loading && !data && (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Generating analysis…
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{error}</div>
      )}

      {data && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-border/40 bg-background/40 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[hsl(160,80%,45%)]">
              <TrendingUp size={13} /> Short-Term Drivers
            </div>
            <ul className="space-y-1.5 text-[13px] leading-relaxed text-foreground/90">
              {data.shortTerm.map((b, i) => <li key={i} className="flex gap-1.5"><span className="text-primary">•</span><span>{b}</span></li>)}
            </ul>
          </div>
          <div className="rounded-lg border border-border/40 bg-background/40 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[hsl(210,80%,60%)]">
              <Briefcase size={13} /> Long-Term Drivers
            </div>
            <ul className="space-y-1.5 text-[13px] leading-relaxed text-foreground/90">
              {data.longTerm.map((b, i) => <li key={i} className="flex gap-1.5"><span className="text-primary">•</span><span>{b}</span></li>)}
            </ul>
          </div>
          <div className="rounded-lg border border-[hsl(40,85%,55%)]/30 bg-[hsl(40,85%,55%)]/5 p-3 md:col-span-2">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[hsl(40,85%,55%)]">
              <Scale size={13} /> Overall Outlook
            </div>
            <p className="text-[13px] leading-relaxed text-foreground/90">{data.outlook}</p>
          </div>
        </div>
      )}
    </div>
  );
}
