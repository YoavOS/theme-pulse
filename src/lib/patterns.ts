// Trait names for the pattern finder (keep in sync with supabase/functions/_shared/patternFeatures.ts).
export const TRAITS_EN = ["distance from the 21 EMA (daily ranges)", "run since the last 21 EMA touch (%)", "RS: 3-month return minus SPY (pts)", "distance from the 52-week high (%)",
  "price vs its 50-day average (%)", "tightening: 10-day / 50-day range", "volume dry-up: 10-day / 50-day volume", "up-volume / down-volume (50 days)",
  "vs SPY on red days (pts)", "stage-2 trend (above a rising 150-day average)", "industry strength (percentile)"];
export const TRAITS_HE = ["מרחק מה-21 EMA (בטווחים יומיים)", "ריצה מאז הנגיעה האחרונה ב-21 EMA (%)", "RS: תשואת 3 חודשים פחות SPY (נק')", "מרחק מהשיא של 52 שבועות (%)",
  "מחיר מול ממוצע 50 יום (%)", "התכווצות: טווח 10 יום / טווח 50 יום", "ייבוש מחזור: מחזור 10 יום / 50 יום", "מחזור בעליות / מחזור בירידות (50 יום)",
  "מול SPY בימים אדומים (נק')", "מגמת שלב 2 (מעל ממוצע 150 יום עולה)", "חוזק הענף (אחוזון)"];
const FIFTH_EN = ["lowest fifth", "2nd fifth", "middle fifth", "4th fifth", "highest fifth"];
const FIFTH_HE = ["החמישית הנמוכה", "החמישית השנייה", "החמישית האמצעית", "החמישית הרביעית", "החמישית הגבוהה"];
export interface Rule { a: number; abin: number; b: number | null; bbin: number | null; n_train: number; rate_train: number; n_test: number; rate_test: number; lift_train: number; lift_test: number; fwd20_test: number | null; held: boolean }
const fmt = (x: number) => (Math.abs(x) >= 10 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(1) : x.toFixed(2));
export function rulePart(k: number, bin: number, th: number[][], he: boolean) {
  const c = th[k - 1] ?? [];
  const lo = bin <= 1 ? null : c[bin - 2], hi = bin >= 5 ? null : c[bin - 1];
  const range = lo == null ? (he ? `מתחת ל-${fmt(hi!)}` : `below ${fmt(hi!)}`) : hi == null ? (he ? `מעל ${fmt(lo)}` : `above ${fmt(lo)}`) : `${fmt(lo)} … ${fmt(hi)}`;
  return { trait: (he ? TRAITS_HE : TRAITS_EN)[k - 1], fifth: (he ? FIFTH_HE : FIFTH_EN)[bin - 1], range };
}
