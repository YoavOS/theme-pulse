export function normalizeCalendar(raw: any[], date: string) {
 const rows = new Map<string,any>();
 const number=(x:unknown)=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))?Number(x):null;
 for(const r of raw) {
  const symbol=String(r?.symbol??'').trim().toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(symbol)||String(r.date??date).slice(0,10)!==date)continue;
  const hour=String(r.hour??r.time??'').toLowerCase();
  const row={symbol,date,company:r.companyName??r.name??null,marketCap:number(r.marketCap),
   reportTime:hour==='bmo'||hour.includes('before')?'BMO':hour==='amc'||hour.includes('after')?'AMC':hour==='dmh'||hour.includes('during')?'DMH':null,
   epsEstimate:number(r.epsEstimate??r.epsEstimated),epsActual:number(r.epsActual??r.eps),revenueEstimate:number(r.revenueEstimate??r.revenueEstimated),revenueActual:number(r.revenueActual??r.revenue),currentPrice:null,previousClose:null,gapPct:null};
  const existing=rows.get(symbol);
  if(existing) {for(const key of Object.keys(row)) if(existing[key]==null)existing[key]=(row as any)[key];}
  else rows.set(symbol,row);
 }
 return [...rows.values()];
}
export function filterCalendar<T extends {symbol:string;marketCap:number|null}>(rows:T[], universe:string[]|null,minMarketCap:number) {
 const allowed=universe===null?null:new Set(universe.map(x=>x.toUpperCase()));
 return rows.filter(r=>(!allowed||allowed.has(r.symbol))&&(r.marketCap===null||r.marketCap>=minMarketCap));
}
