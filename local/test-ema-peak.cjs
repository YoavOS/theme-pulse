// Exercise the actual edge-function calculation without network or database access.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'supabase/functions/clean-21-ema-scan/index.ts'), 'utf8').split('function requiredDailyBars')[0].replace(/^import .*;\r?\n/gm, '');
const ctx = vm.createContext({});
vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText, ctx);
function scan(closes, {length=21, weekly=false, highs={}, gainStart}={}) {
  const bars = closes.map((close, i) => ({ts: 1704067200 + i * (weekly ? 7 : 1) * 86400, open:close, high:Object.hasOwn(highs,i) ? highs[i] : close, low:1, close, volume:100}));
  return ctx.computeRow('TEST', bars, 50, 5, length, weekly ? 'weekly' : 'daily', 'cache', gainStart);
}
let checks=0;
for (const length of [9,21,50,200]) for (const weekly of [false,true]) {
  const base=[...Array(length+10).fill(100),80,100];
  const values=[...base,110,120,140,150,145];
  const highIndex=values.length-2;
  const result=scan(values,{length,weekly,highs:{[highIndex]:160}});
  assert.equal(result.startClose,100);
  assert.equal(result.latestClose,145);
  assert.equal(result.gainPct,60); // Intrabar high, not highest close or latest close.
  assert.equal(result.qualifies,true); // Latest-close gain would fail the 50% threshold.
  assert.equal(result.periodsWithoutBelow,6); // Low=1 wicks do not reset.
  const broken=scan([...values,50],{length,weekly,highs:{[highIndex]:160}});
  assert.equal(broken.gainPct,null);
  assert.equal(broken.qualifies,false);
  const restarted=scan([...values,50,110,120,125,130,125],{length,weekly,highs:{[highIndex]:900}});
  assert.equal(restarted.startClose,110);
  assert.equal(restarted.periodsWithoutBelow,5);
  assert.equal(restarted.gainPct,18.2); // Old peak must not leak across a reset.
  const missing=scan(values,{length,weekly,highs:{[highIndex]:null}});
  assert.equal(missing.gainPct,50);
  const equal=scan(Array(length+10).fill(128),{length,weekly});
  assert.equal(equal.periodsWithoutBelow,11);
  const priorClose = scan(values,{length,weekly,gainStart:'previousClose',highs:{[highIndex]:160,[length+10]:900}});
  assert.equal(priorClose.startClose,80);
  assert.equal(priorClose.gainPct,100); // Earlier close is the denominator, its wick is excluded.
  assert.equal(priorClose.periodsWithoutBelow,result.periodsWithoutBelow);
  const previousAfterReset = scan([...values,50,110,120,125,130,125],{
    length,weekly,gainStart:'previousClose',highs:{[highIndex]:900},
  });
  assert.equal(previousAfterReset.startClose,50);
  assert.equal(previousAfterReset.gainPct,160);
  assert.equal(previousAfterReset.qualifies,true);
  assert.equal(restarted.qualifies,false);
  const touch = scan([...Array(length+10).fill(100),120,123,125],{
    length,weekly,gainStart:'previousClose',highs:{[length+9]:900},
  });
  assert.equal(touch.startClose,100);
  assert.equal(touch.gainPct,25); // Exact EMA touch before the strict crossover.
  for (const sequence of [
    Array(length+10).fill(128),
    [...Array(length-1).fill(80),...Array(12).fill(100)], // EMA warm-up starts above.
    [...values,50], // Current run was broken.
  ]) {
    const noCross = scan(sequence,{length,weekly,gainStart:'previousClose'});
    assert.equal(noCross.startClose,null);
    assert.equal(noCross.gainPct,null);
    assert.equal(noCross.qualifies,false);
  }
  checks++;
}
console.log(`PASS: ${checks} EMA/timeframe combinations; intrabar peak, threshold, reset, prior-peak exclusion, missing highs, equality, both gain bases and unconfirmed crossovers.`);

