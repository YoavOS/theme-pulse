// Quick test against FMP stable endpoint using our key
const key = Deno.env.get("FMP_API_KEY");
const r = await fetch(`https://financialmodelingprep.com/stable/economic-calendar?from=2026-06-17&to=2026-06-19&apikey=${key}`);
console.log("status", r.status);
const text = await r.text();
console.log(text.slice(0, 1000));
