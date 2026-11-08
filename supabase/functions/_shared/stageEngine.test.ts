// Synthetic checks of the stage engine's method. Run: deno test supabase/functions/_shared/stageEngine.test.ts
// (Not deployed — tests only.)
import { classifyStage, type WeeklyBar } from "./stageEngine.ts";

const W = 7 * 86400, T0 = Date.UTC(2023, 0, 2) / 1000;
const bars = (cl: number[]): WeeklyBar[] => cl.map((c, i) => {
  const p = i ? cl[i - 1] : c;
  return { t: T0 + i * W, o: p, h: Math.max(c, p) * 1.02, l: Math.min(c, p) * 0.98, c, v: 1e6 } as unknown as WeeklyBar;
});
const spy = bars(Array.from({ length: 220 }, (_, i) => 400 + i));
/** Stage path as the engine labels each prefix of the series (what the weekly scan saw at the time). */
const path = (cl: number[], from = 25) => {
  const out: string[] = [];
  for (let n = from; n <= cl.length; n++) {
    const r = classifyStage(bars(cl).slice(0, n), spy.slice(0, n), 2);
    out.push(r ? r.substage : "-");
  }
  return out;
};
const assert = (ok: boolean, msg: string) => { if (!ok) throw new Error(msg); };
const stageOf = (s: string) => (s === "T" ? 0 : Number(s[0]));

Deno.test("no direct 4 → 2: a V-shaped rebound goes through Stage 1", () => {
  const p = path([...Array.from({ length: 60 }, (_, i) => 100 - (i * 50) / 59), ...Array.from({ length: 15 }, (_, i) => 52 + i * 2)]);
  for (let k = 1; k < p.length; k++) assert(!(stageOf(p[k - 1]) === 4 && stageOf(p[k]) === 2), `4→2 at ${k}: ${p.join(" ")}`);
});

Deno.test("base then a steady climb out of it reaches Stage 2 as a fresh breakout (2A)", () => {
  const cl = [...Array.from({ length: 50 }, (_, i) => 100 - i), ...Array.from({ length: 20 }, (_, i) => 50 + (i % 2 ? 1 : -1)),
    56, 58, 60, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72];
  const p = path(cl, 60);
  assert(p.includes("2A"), `never 2A: ${p.join(" ")}`);
});

Deno.test("young listing: classified without throwing, and earlier weeks don't repaint", () => {
  const cl = Array.from({ length: 40 }, (_, i) => 20 * Math.pow(1.02, i) * (1 + 0.03 * Math.sin(i)));
  const a = classifyStage(bars(cl).slice(0, 30), spy.slice(0, 30), 2);
  const b = classifyStage(bars(cl), spy.slice(0, 40), 2);
  assert(!!a && !!b, "null result");
  // history is newest-last; the first weeks of the shorter run must match the longer run's
  const ha = a!.history, hb = b!.history;
  assert(hb.startsWith(ha.slice(0, Math.min(ha.length, 8))), `repainted: ${ha} vs ${hb}`);
});

Deno.test("flat price (zero ATR) does not produce NaN features", () => {
  const r = classifyStage(bars(Array(80).fill(10)), spy.slice(0, 80), 2);
  assert(!!r && Number.isFinite(r!.features.closeVsMaAtr), `closeVsMaAtr=${r?.features.closeVsMaAtr}`);
});
