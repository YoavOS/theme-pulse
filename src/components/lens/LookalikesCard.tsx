import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { LABEL_SHORT, type ProvenLabel } from "@/lib/proven/types";
import { useLensLang } from "@/lib/lens/i18n";
import { TRAIT_HE } from "@/lib/lens/he/traits";
import { HE_LABEL_SHORT } from "@/lib/lens/he/proven";
import { AutoTerms } from "./Term";

/**
 * Look-alikes: proven companies whose 10-K fingerprint (returns vs cost of capital, how they earn them,
 * growth, reinvestment, R&D, debt) is closest to this company's — today, and as they looked years ago.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
interface Row { mode: "now" | "before"; rank: number; peer: string; peer_year: string | null; distance: number; peer_label: ProvenLabel | null; shared: { trait?: string; text: string; self: number | null; peer: number | null }[] }

export default function LookalikesCard({ symbol, onOpen }: { symbol: string; onOpen: (s: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error,setError] = useState(false), [attempt,setAttempt] = useState(0);
  const he = useLensLang() === "he";
  useEffect(() => {
    let alive = true;
    setRows(null); setError(false);
    db.from("lookalikes").select("mode, rank, peer, peer_year, distance, peer_label, shared").eq("symbol", symbol).order("rank")
      .then(({ data,error }: { data: Row[] | null; error: unknown }) => { if (alive) { setError(Boolean(error)); setRows(data ?? []); } });
    return () => { alive = false; };
  }, [symbol,attempt]);
  if (error) return <p role="alert" className="text-sm">{he?"השוואות אינן זמינות.":"Look-alike comparisons unavailable."} <button className="underline" onClick={()=>setAttempt(x=>x+1)}>{he?"ניסיון נוסף":"Retry"}</button></p>;
  if (!rows?.length) return null;
  const list = (mode: "now" | "before") => rows.filter((r) => r.mode === mode).slice(0, 4);
  const Item = ({ r }: { r: Row }) => (
    <li>
      <button onClick={() => onOpen(r.peer)} className="font-mono font-semibold hover:text-primary">{r.peer}</button>
      {r.mode === "before" && r.peer_year && <span className="text-muted-foreground">{he ? " ב-" : " in "}{r.peer_year.slice(0, 4)}</span>}
      {r.peer_label && <span className="text-muted-foreground"> · {he ? `${HE_LABEL_SHORT[r.peer_label] ?? r.peer_label} היום` : `${LABEL_SHORT[r.peer_label] ?? r.peer_label} now`}</span>}
      <div className="text-[11.5px] text-muted-foreground">{he ? "דומות ב: " : "alike in: "}<AutoTerms text={r.shared.map((s) => (he && s.trait ? TRAIT_HE[s.trait] ?? s.text : s.text)).join("; ")} /></div>
    </li>
  );
  return (
    <section className="rounded-lg border border-border p-3 text-[12.5px]">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><Users size={13} /> {he ? "חברות מוכחות שדומות לה" : "Look-alikes among proven companies"}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><div className="mb-1 text-[11.5px] font-semibold">{he ? "דומות לה היום" : "Look like it today"}</div><ul className="space-y-1.5">{list("now").map((r) => <Item key={`n${r.rank}`} r={r} />)}</ul></div>
        <div><div className="mb-1 text-[11.5px] font-semibold">{he ? "נראו כמוה לפני שנים" : "Looked like it years ago"}</div><ul className="space-y-1.5">{list("before").map((r) => <Item key={`b${r.rank}`} r={r} />)}</ul></div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{<AutoTerms text={he ? "מספרים דומים, לא עתיד דומה: רוב החברות שנראו כמו חברות מצוינות לא הפכו למצוינות. הסיכויים מופיעים ב\"מה המספרים לא יכולים לספר\"." : "Similar numbers, not a similar future: most look-alikes of great companies did not become great. The odds are in \"What the numbers can't tell you\"."}/>}</p>
    </section>
  );
}
