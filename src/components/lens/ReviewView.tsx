import { useMemo, useState } from "react";
import { ArrowLeft, Check, RotateCcw, X as XIcon } from "lucide-react";
import type { QuizQ } from "@/lib/lens/quizBank";
import type { LensPayload } from "@/lib/lens/types";
import { dueQuestions, readReview, recordAnswer, reviewStats, tickerQuestions } from "@/lib/lens/review";

const SESSION = 8;

/** One review session: due concept questions first, then up to three about the ticker on screen. */
export default function ReviewView({ opened, payload, onExit }: { opened: Set<string>; payload: LensPayload | null; onExit: () => void }) {
  const [round, setRound] = useState(0);
  const queue = useMemo<QuizQ[]>(() => {
    void round;
    return [...dueQuestions(opened).slice(0, SESSION), ...(payload ? tickerQuestions(payload).slice(0, 3) : [])];
  }, [opened, payload, round]);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const q = queue[i];
  const done = i >= queue.length;

  const choose = (k: number) => {
    if (picked !== null || !q) return;
    setPicked(k);
    const ok = k === q.answer;
    if (ok) setScore((s) => s + 1);
    if (!q.id.startsWith("t:")) recordAnswer(q.id, ok);
  };
  const next = () => { setPicked(null); setI((x) => x + 1); };
  const restart = () => { setRound((r) => r + 1); setI(0); setScore(0); setPicked(null); };

  const stats = reviewStats(readReview());
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={onExit} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft size={13} /> Back to {payload?.symbol ?? "the lens"}</button>
        <span className="text-[10.5px] text-muted-foreground">{stats.learned}/{stats.total} questions well learned</span>
      </div>

      {queue.length === 0 && (
        <div className="space-y-2 rounded-lg border border-border p-4 text-center text-sm text-muted-foreground">
          <p>Nothing due right now.</p>
          <p className="text-xs">Questions unlock as you open concepts, and come back at growing intervals (1, 3, 7, 16, 35 days) as you get them right.</p>
        </div>
      )}

      {q && !done && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between text-[10.5px] text-muted-foreground">
            <span>{q.id.startsWith("t:") ? `About ${payload?.symbol}` : "Concept review"}</span>
            <span>{i + 1} / {queue.length}</span>
          </div>
          <p className="text-[14px] font-medium leading-snug">{q.q}</p>
          <div className="space-y-1.5">
            {q.choices.map((c, k) => {
              const state = picked === null ? "idle" : k === q.answer ? "right" : k === picked ? "wrong" : "dim";
              return (
                <button key={c} onClick={() => choose(k)} disabled={picked !== null}
                  className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left text-[13px] leading-snug transition-colors ${
                    state === "right" ? "border-[hsl(150,60%,45%)] bg-[hsl(150,60%,45%)]/10" : state === "wrong" ? "border-[hsl(25,90%,55%)] bg-[hsl(25,90%,55%)]/10" : state === "dim" ? "border-border/50 opacity-60" : "border-border hover:bg-muted/40"}`}>
                  <span className="mt-px w-4 shrink-0 font-mono text-[11px] text-muted-foreground">{state === "right" ? <Check size={13} className="text-[hsl(150,60%,58%)]" /> : state === "wrong" ? <XIcon size={13} className="text-[hsl(25,90%,64%)]" /> : String.fromCharCode(65 + k)}</span>
                  <span>{c}</span>
                </button>
              );
            })}
          </div>
          {picked !== null && (
            <div className="space-y-2">
              <p className={`text-[12.5px] leading-snug ${picked === q.answer ? "text-[hsl(150,60%,58%)]" : "text-[hsl(25,90%,64%)]"}`}>{picked === q.answer ? "Right." : "Not quite."} <span className="text-foreground">{q.why}</span></p>
              <button onClick={next} className="rounded-md bg-primary/15 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/25">{i + 1 < queue.length ? "Next" : "Finish"}</button>
            </div>
          )}
        </div>
      )}

      {done && queue.length > 0 && (
        <div className="space-y-2 rounded-lg border border-border p-4 text-center">
          <p className="text-sm font-medium">{score} of {queue.length} right</p>
          <p className="text-xs text-muted-foreground">Missed questions come back next session; the ones you got right come back later and later.</p>
          <button onClick={restart} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1 text-xs hover:bg-muted/40"><RotateCcw size={12} /> Check for more due</button>
        </div>
      )}
    </div>
  );
}
