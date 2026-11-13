/** Signed percentage, two decimals. */
export const fmtPct = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(2)}%`;

/** Round the scale up to a readable number so bars are comparable at a glance. */
export function niceMax(x: number) {
  if (!(x > 0)) return 1;
  const steps = [0.5, 1, 2, 3, 4, 5, 8, 10, 15, 20, 30, 40, 50, 75, 100, 150, 200, 300, 500, 1000];
  return steps.find((s) => s >= x) ?? Math.ceil(x / 100) * 100;
}
