const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),cache=new Map();
function load(rel){const file=path.resolve(root,rel);if(cache.has(file))return cache.get(file).exports;const m={exports:{}};cache.set(file,m);const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;new Function('require','module','exports',js)(id=>{if(!id.startsWith('.'))return require(id);let p=path.resolve(path.dirname(file),id);if(!path.extname(p))p+='.ts';return load(p);},m,m.exports);return m.exports;}
const v=load('src/lib/lens/valuation.ts');
for(const margin of [-5,20,80]){const rows=v.buildScenarios({revenue:100,opMargin:margin,taxRate:.25,costOfCapital:10,industryOpMargin:15,industrySalesToCapital:2,salesToCapital:2},100);assert(rows[2].story.targetMargin>=Math.max(margin,15));assert.equal(rows[2].story.terminalEdge,0);assert.equal(rows[1].story.targetMargin,15);}
const s={revenue:100,opMargin:20,targetMargin:25,taxRate:.25,costOfCapital:10,salesToCapital:3,riskFree:3,terminalEdge:0};const ev=v.valueOf(s,12).value;const im=v.impliedGrowth(s,ev);assert.equal(im.kind,'ok');assert(Math.abs(im.growth-12)<1e-6);assert.throws(()=>v.impliedGrowth(s,-1));
const {statements}=load('supabase/functions/_shared/financialStatements.ts');
const quarters=['2026-09-30','2026-06-30','2026-03-31','2025-12-31'].map(end=>({end,shares:5,flow:{revenue:100,grossProfit:60,operatingIncome:20,netIncome:-5,ocf:30,capex:10,sbc:2,tax:4,rnd:6,sga:8}}));let rows=statements({quarters});assert.equal(rows[0].revenue,400);assert.equal(rows[0].net,-20);assert.equal(rows[0].cost,160);assert.equal(rows[0].shares,5);quarters[0].flow.ocf=null;assert.equal(statements({quarters})[0].ocf,null);quarters[0].end='2027-09-30';assert.equal(statements({quarters})[0].kind,'quarter');
const {validateExplanation}=load('supabase/functions/_shared/lensPayload.ts');const facts=[{id:'revenue',label:'Revenue',display:'$1.2B'}];const check=text=>validateExplanation({sentences:[{text,fact_ids:['revenue']}]},facts).ok;assert(check('Revenue was $1.2B.'));assert(!check('Revenue was $1.2M.'));assert(!check('Revenue was 1.2%.'));
console.log('PASS: scenario direction, terminal assumptions, DCF inversion, invalid EV, TTM completeness, missing values, losses, unit-aware explanations.');

const {parseReleaseQuarter}=load('supabase/functions/_shared/earningsRelease.ts');
const releaseTable='<table>'+[
  ['Three Months Ended','Nine Months Ended'],
  ['Dollars in Millions','October 31, 2026','November 1, 2025','October 31, 2026','November 1, 2025'],
  ['Total revenue','$','3,638','$','3,575','$','10,320','$','10,354'],
  ['Operating income','217','73','524','412'],
  ['Net income','254','(8',')','391','147'],
].map(row=>'<tr>'+row.map(text=>'<td>'+text+'</td>').join('')+'</tr>').join('')+'</table>';
const release=(html,asOf='2026-08-01')=>parseReleaseQuarter(html,asOf,'2026-11-24');
assert.deepEqual(release(releaseTable),{end:'2026-10-31',revenue:3638e6,priorRevenue:3575e6,operatingIncome:217e6,netIncome:254e6});
assert.equal(release(releaseTable,'2026-10-31'),null);
assert.equal(release(releaseTable.replace('Dollars in Millions','Percent change')),null);
assert.equal(release(releaseTable.replace('Total revenue','Adjusted revenue')),null);
assert.equal(release(releaseTable+releaseTable),null);
console.log('PASS: SEC earnings release quarter selection, units, and ambiguous report rejection.');

const {computeAdjusted}=load('src/lib/lens/adjust.ts'); const a={ebitTtm:20,revenueTtm:100,rndTtm:12,taxRate:.2,icBase:50,rndAnnual:[{end:'2025-12-31',val:8},{end:'2024-12-31',val:6}],costOfDebt:5,leaseNow:null,leaseBase:null}; assert.equal(computeAdjusted(a,{life:2,rnd:true,lease:false}).rnd.current,12); assert.equal(computeAdjusted({...a,rndTtm:null},{life:2,rnd:true,lease:false}).rnd,null); console.log('PASS: R&D TTM alignment and missing-period guard.');
const {parseForeignRelease}=load('supabase/functions/_shared/foreignEarnings.ts');
const foreignHeader='<tr><td></td><td colspan="4">Nine months ended September 30,</td><td colspan="3">Three months ended September 30,</td><td></td></tr>';
const years='<tr><td></td><td colspan="2">2026</td><td colspan="2">2025</td><td colspan="2">2026</td><td>2025</td><td></td></tr>';
const units='<tr><td></td><td colspan="4">U.S. dollars</td><td colspan="3">U.S. dollars</td><td></td></tr>';
const line=(name,a,b,c,d,paren='')=>'<tr>'+[name,a,'',b,'',c,'',d,paren].map(x=>'<td>'+x+'</td>').join('')+'</tr>';
const foreignHtml='<p>Condensed consolidated statement of income (unaudited) (in thousands)</p><table>'+foreignHeader+years+units+
  line('Revenues','416,196','367,948','161,294','125,993')+line('Cost of revenues','207,963','181,731','80,692','62,951')+
  line('Gross profit','208,233','186,217','80,602','63,042')+line('Net income (loss)','97,785','14,825','42,835','(53,181',')')+'</table>'+
  '<table>'+foreignHeader.replace('<td></td>','<td>Earnings (loss) per share information:</td>')+years+units+
  line('Diluted net earnings (loss) per share (in US dollars)','1.94','0.32','0.84','(1.16',')')+'</table>';
const foreignSource={filed:'2026-11-04',url:'https://www.sec.gov/example.htm'};
const foreignQuarters=parseForeignRelease(foreignHtml,foreignSource);
assert.deepEqual(foreignQuarters.map(({end,revenue,net,dilutedEPS})=>[end,revenue,net,dilutedEPS]),[
  ['2026-09-30',161294000,42835000,.84],['2025-09-30',125993000,-53181000,-1.16],
]);
assert.deepEqual(parseForeignRelease(foreignHtml.replaceAll('U.S. dollars','NT dollars'),foreignSource),[]);
console.log('PASS: foreign quarter columns, USD scale, negative comparative and separate reported EPS table.');
const {lensConnection}=load('supabase/functions/_shared/lensConnections.ts');
const beforeCash={end:'2026-03-31',flow:{revenue:100},inst:{cashOnly:50,contractLiability:7,receivables:9},fallback:[]};
const newCash={end:'2026-06-30',flow:{revenue:115,ocf:10,borrowingProceeds:18},inst:{cashOnly:55,contractLiability:9,receivables:10},fallback:[]};
let connection=lensConnection([newCash,beforeCash]);
assert.equal(connection.cashChange,5);
assert.equal(connection.customerAdvancesChange,2);
assert.equal(connection.borrowing,18);
assert.equal(connection.repaid,null);
assert.equal(lensConnection([{...newCash,fallback:['contractLiability']},beforeCash]).customerAdvancesChange,null);
assert.equal(lensConnection([newCash,{...beforeCash,end:'2025-12-31'}]).cashChange,null);
console.log('PASS: matching quarters, direct borrowing evidence and missing/mismatched advances.');
const {parseLensHistory}=load('supabase/functions/_shared/lensMetrics.ts');
const quarter={start:'2026-04-01',end:'2026-06-30',form:'10-Q',filed:'2026-08-01'};
const yearToDate={...quarter,start:'2026-01-01'};
const fact=(unit,observations)=>({units:{[unit]:observations}});
const report={'us-gaap':{
  Revenues:fact('USD',[{...quarter,val:150}]),
  EarningsPerShareDiluted:fact('USD/shares',[{...yearToDate,val:8},{...quarter,val:2}]),
  WeightedAverageNumberOfDilutedSharesOutstanding:fact('shares',[{...yearToDate,val:90},{...quarter,val:100}]),
}};
const parsedQuarter=parseLensHistory({facts:report}).quarters[0];
assert.equal(parsedQuarter.dilutedEPS,2);
assert.equal(parsedQuarter.dilutedShares,100);
report['us-gaap'].EarningsPerShareDiluted.units['USD/shares'].pop();
assert.equal(parseLensHistory({facts:report}).quarters[0].dilutedEPS,null);
console.log('PASS: per-share comparison uses reported quarterly EPS and share count, never YTD subtraction.');

const {foreignQuarterHistory}=load('supabase/functions/_shared/foreignEarnings.ts');
const {buildPayload}=load('supabase/functions/_shared/lensPayload.ts');
const balanceLine=(label,latest,prior)=>'<tr>'+[label,'','',latest,'','','',prior,''].map(x=>'<td>'+x+'</td>').join('')+'</tr>';
const balance='<p>Condensed Interim Consolidated Balance Sheets (Unaudited) (In thousands)</p><table>'+
  '<tr><td></td><td></td><td colspan="2">September 30,</td><td></td><td></td><td colspan="2">December 31,</td><td></td></tr>'+
  '<tr><td></td><td></td><td colspan="2">2026</td><td></td><td></td><td colspan="2">2025</td><td></td></tr>'+
  '<tr><td></td><td></td><td colspan="6">U.S. dollars</td><td></td></tr>'+
  balanceLine('Cash and cash equivalents','280,647','177,848')+
  balanceLine('Total current assets','911,748','896,995')+balanceLine('Total assets','1,415,213','1,259,833')+
  balanceLine('Total current liabilities','155,781','107,425')+balanceLine('Total liabilities','660,733','642,830')+
  balanceLine("Total shareholders' equity",'754,480','617,003')+'</table>';
const filing=balance+foreignHtml.replace(line('Net income (loss)','97,785','14,825','42,835','(53,181',')'),
  line('Operating income','94,329','96,519','39,836','31,845')+
  line('Research and development','48,920','35,289','17,913','13,453')+
  line('Income (loss) before income taxes','116,545','12,488','46,926','(62,561',')')+
  line('Income tax benefit (expense)','(18,760)','2,337','(4,091)','9,380')+
  line('Net income (loss)','97,785','14,825','42,835','(53,181',')'));
const filingWithShares=filing.slice(0,-8)+line('ordinary shares outstanding:','','','','')+
  line('Diluted','51,462','49,502','51,498','45,755')+'</table>';
const imported=foreignQuarterHistory(parseForeignRelease(filingWithShares,foreignSource));
assert.equal(imported[0].inst.cash,280647000);
assert.equal(imported[0].flow.tax,4091000);
assert.equal(imported[0].dilutedShares,51498000);
assert.equal(imported[1].inst.cash,undefined); // Latest release's balance sheet uses a fiscal year-end comparator.
assert.equal(imported[1].flow.tax,-9380000);
assert.equal(parseForeignRelease(filingWithShares.replace('660,733','660,000'),foreignSource)[0].inst.equity,undefined);
const evidenceDates=['2026-09-30','2026-06-30','2026-03-31','2025-12-31','2025-09-30','2025-06-30','2025-03-31','2024-12-31'];
const evidenceQuarters=evidenceDates.map((end,i)=>({
  ...imported[i < 4 ? 0 : 1], end, flow:{...imported[i < 4 ? 0 : 1].flow,netIncome:(i<4?25:20)*1e6},
  inst:i===0?imported[0].inst:i===4?{equity:617003000}:{},
}));
const evidence=quarters=>buildPayload({symbol:'CAMT',company:'Camtek',classification:{sector:'Technology'},financial:false,
  history:{quarters,annual:[],firstFiled:null,ifrsOnly:false},market:{price:null,marketCap:4.4e9,asOf:null},
  secStatus:'SEC Form 6-K',peers:{}});
const payload=evidence(evidenceQuarters);
const findMetric=(p,id)=>p.cards.flatMap(c=>c.metrics).find(m=>m.id===id);
assert.equal(payload.sec.asOf,'2026-09-30');
assert.equal(payload.sec.sourceUrl,foreignSource.url);
assert.equal(payload.statements[0].kind,'ttm');
assert.equal(payload.statements[1].sourceUrl,foreignSource.url);
assert.ok(Math.abs(findMetric(payload,'rev_growth_ttm').value-28.018) < .01);
assert.ok(Math.abs(findMetric(payload,'op_margin').value-24.697) < .01);
assert.ok(findMetric(payload,'roe').value>16);
assert.ok(findMetric(payload,'share_change').value>12);
assert.equal(findMetric(payload,'fcf').value,null);
assert.equal(findMetric(payload,'roic').value,null);
assert.equal(findMetric(payload,'interest_coverage').display,'n/m');
const partial=evidence(evidenceQuarters.filter((_,i)=>i!==2));
assert.equal(findMetric(partial,'rev_growth_ttm').value,null);
assert.ok(findMetric(partial,'rev_growth_q').value>28);
console.log('PASS: 6-K release quarters populate Evidence with filing metadata, signed taxes, equity and share counts, while gaps and missing inputs stay unavailable.');

