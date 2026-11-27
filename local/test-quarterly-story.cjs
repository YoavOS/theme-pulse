const fs=require('fs'),vm=require('vm'),ts=require('typescript'),assert=require('node:assert/strict');
const source=ts.transpileModule(fs.readFileSync('src/lib/lens/quarterly.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const ctx={exports:{}};vm.runInNewContext(source,ctx);const q=ctx.exports;
assert(Math.abs(q.percentageChange(120,100)-20)<1e-9);
assert.equal(q.percentageChange(-5,-10),null);assert.equal(q.percentageChange(10,0),null);assert.equal(q.percentageChange(-10,100),null);assert.equal(q.percentageChange(null,100),null);
const dates=['2024-03-31','2024-06-30','2024-09-30','2024-12-31','2025-03-31','2025-06-30'];
const rows=dates.map((end,i)=>({id:end,end,kind:'quarter',revenue:[100,100,100,100,110,130][i]}));
const result=q.latestQuarterSummary(rows.slice().reverse());assert(Math.abs(result.yoy-30)<1e-9);assert(Math.abs(result.priorYoy-10)<1e-9);assert(Math.abs(result.acceleration-20)<1e-9);assert(Math.abs(result.qoq-18.181818)<1e-5);
assert.equal(q.quarterGrowth([{...rows[0],end:'2023-03-31'},rows[1]],1,'revenue',1),null);
assert.equal(q.latestQuarterSummary([]).acceleration,null);
assert.equal(q.comparablePeriods('2025-02-02','2024-02-04',4),true);
console.log('PASS: QoQ/YoY, acceleration in percentage points, reverse ordering, missing periods, zero/negative bases, 52-week reporting and empty data.');
assert.equal(q.comparisonQuarter(rows,5,1).end,'2025-03-31');
assert.equal(q.comparisonQuarter(rows,5,4).end,'2024-06-30');
assert.equal(q.comparisonQuarter(rows,2,4),null);
const slower=rows.concat({id:'2025-09-30',end:'2025-09-30',kind:'quarter',revenue:120});
assert(Math.abs(q.quarterGrowth(slower,6,'revenue',4)-20)<1e-9);
assert(Math.abs(q.growthAcceleration(slower,6,'revenue',4)+10)<1e-9);
assert(q.quarterGrowth(slower,6,'revenue',1)<0);
assert.equal(q.growthAcceleration(slower,4,'revenue',4),null);
console.log('PASS: comparison bars use the selected baseline and slowing growth can stay positive.');
assert.equal(q.signCrossover(12,-8),'up');
assert.equal(q.signCrossover(-8,12),'down');
for(const pair of [[-8,-12],[8,12],[0,-8],[12,0],[12,null],[null,12]]) {
  assert.equal(q.signCrossover(...pair),null);
}
assert.equal(q.percentageChange(12,-8),null);
assert.equal(q.percentageChange(-8,12),null);
console.log('PASS: both sign changes are flagged without introducing growth percentages.');

const losses=rows.map((row,i)=>({...row,net:[-160,-140,-130,-125,-116.5,-110.8][i]}));
const lossQoq=q.quarterGrowth(losses,5,'net',1,q.lossChange);
assert(Math.abs(lossQoq-4.892703863)<1e-8);
assert(q.growthAcceleration(losses,5,'net',1,q.lossChange)<0);
assert(Math.abs(q.quarterGrowth(losses,5,'net',4,q.lossChange)-20.857142857)<1e-8);
assert.equal(q.quarterGrowth(losses,5,'net',1),null);
assert.equal(q.lossChange(-120,-100),-20);
assert.equal(q.lossChange(-100,-100),0);
for(const pair of [[10,-10],[-10,10],[0,-10],[-10,0],[-10,null]]) assert.equal(q.lossChange(...pair),null);
assert.equal(q.growthAcceleration([...losses.slice(0,5),{...losses[5],net:10}],5,'net',1,q.lossChange),null);
console.log('PASS: loss narrowing and widening, separate QoQ/YoY rates and crossover handling.');

