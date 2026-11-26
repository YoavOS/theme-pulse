import { QuarterlyTrends } from "./QuarterlyChart";
import { flowAmount, flowSteps, IncomeFlowTrend, shareOfRevenue } from "./IncomeFlowTrend";
import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { IncomeFlowWaterfall } from "./IncomeFlowWaterfall";
import type { LensPayload } from "@/lib/lens/types";
import { useLensLang } from "@/lib/lens/i18n";
import type { StatementPeriod } from "../../../supabase/functions/_shared/financialStatements";
const money=(v:number|null)=>v===null?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:1}).format(v);
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const emptyStatement: StatementPeriod = {
 id: "", end: "", kind: "quarter", revenue: null, gross: null, cost: null, operating: null, net: null,
 tax: null, rnd: null, sga: null, ocf: null, capex: null, sbc: null, shares: null,
};
const colors=["hsl(var(--up))","hsl(var(--up))","hsl(var(--up))","hsl(var(--up))"];
export default function FinancialStatements({p,compact=false}:{p:LensPayload;compact?:boolean}) {
 const he=useLensLang()==="he", t=(en:string,h:string)=>he?h:en;
 const periods=p.statements??[];
 const [periodId,setPeriodId]=useState(periods[0]?.id??"");
 const [per100,setPer100]=useState(false),[step,setStep]=useState(0);
 const [hover, setHover] = useState<{step:number; x:number; y:number; above:boolean} | null>(null);
 const tooltipId = useId();
 const hasPeriod = periods.length > 0;
 const row=periods.find(x=>x.id===periodId)??periods[0]??emptyStatement;
 const vals=[row.revenue,row.gross,row.operating,row.net];
 const labels=he?["הכנסות","רווח גולמי","רווח תפעולי","רווח נקי"]:["Revenue","Gross profit","Operating profit","Net profit"];
 const losses=flowSteps.slice(4).map(key=>flowAmount(row,key));
 const lossLabels=he?["עלות ההכנסות","הוצאות תפעול","מס ואחרות, נטו"]:["Cost of revenue","Operating expenses","Tax & other, net"];
 const ratio=(v:number|null)=>shareOfRevenue(v,row.revenue);
 const fmt=(v:number|null)=>per100?(ratio(v)===null?"—":"$"+ratio(v)!.toFixed(1)):money(v);
 const canFlow=vals.every(finite)&&row.revenue!>0&&vals.every(x=>x!>=0)&&losses.every(finite);
 const explanations=[
 t("The starting point: sales recognized in this reporting period. Revenue is not the same as cash collected.","נקודת ההתחלה: מכירות שהוכרו בתקופת הדיווח. הכנסות אינן בהכרח כסף שכבר התקבל."),
 t("Revenue minus the direct cost of delivering products or services. This is what remains to fund research, selling and running the business.","הכנסות פחות העלות הישירה של המוצרים או השירותים. היתרה מממנת מחקר, מכירות וניהול."),
 t("Gross profit minus operating expenses. It describes the operating business before non-operating items and income tax.","הרווח הגולמי פחות ההוצאות התפעוליות. זהו הרווח מהפעילות לפני סעיפים שאינם תפעוליים ומס הכנסה."),
 t("Profit after all reported items. Tax and other items can increase or decrease the bridge; this is not operating cash flow.","הרווח לאחר כלל הסעיפים המדווחים. מס וסעיפים אחרים יכולים להגדיל או להקטין את היתרה; זה אינו תזרים המזומנים מהפעילות.")];
 const flowLabels=[...labels,...lossLabels];
 const flowValues=[...vals,...losses];
 const showTooltip=(index:number, x:number, y:number)=>{
   const gutter=12;
   const halfWidth=Math.min(145, window.innerWidth/2-gutter);
   setHover({step:index,x:Math.min(window.innerWidth-halfWidth-gutter,Math.max(halfWidth+gutter,x)),y,above:y>window.innerHeight/2});
 };
 const stepAction=(index:number, name:string)=>({
   role:"button", tabIndex:0, "aria-label":name, "aria-pressed":step===index,
   "aria-describedby":hover?.step===index?tooltipId:undefined,
   onClick:()=>{setStep(index);setHover(null);},
   onMouseEnter:(event:React.MouseEvent<SVGGElement>)=>showTooltip(index,event.clientX,event.clientY),
   onMouseLeave:()=>setHover(null),
   onFocus:(event:React.FocusEvent<SVGGElement>)=>{
     const rect=event.currentTarget.getBoundingClientRect();
     showTooltip(index,rect.left+rect.width/2,rect.top+rect.height/2);
   },
   onBlur:()=>setHover(null),
   onKeyDown:(event:React.KeyboardEvent<SVGGElement>)=>{
     if(event.key==="Escape") setHover(null);
     if(event.key==="Enter" || event.key===" "){event.preventDefault();setStep(index);setHover(null);}
   },
   className:"group cursor-pointer focus-visible:outline-none",
 });
 const bridgeNotes=[
   t("Direct costs consume part of sales. A smaller share of revenue means more is left as gross profit.","עלויות ישירות צורכות חלק מההכנסות. כשחלקן קטן, נשאר יותר כרווח גולמי."),
   t("This is the difference between gross and operating profit. Expenses can rise in dollars while using a smaller share of sales.","זהו ההפרש בין רווח גולמי לרווח תפעולי. הוצאות יכולות לעלות בדולרים ולצרוך חלק קטן יותר מההכנסות."),
   t("This is operating profit minus net profit. A positive value reduces profit; a negative value adds to it. It includes tax and other items.","זהו הרווח התפעולי פחות הרווח הנקי. ערך חיובי מפחית את הרווח וערך שלילי מגדיל אותו. הוא כולל מס וסעיפים נוספים.")
 ];
 return <section className="overflow-hidden rounded-2xl border border-border bg-card/40">
  <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 p-5">
   <div><p className="text-xs font-medium uppercase tracking-wider text-primary">{t("Follow the money","בעקבות הכסף")}</p><h2 className="mt-1 text-xl font-semibold">{t("How sales become profit","איך מכירות הופכות לרווח")}</h2><p className="mt-1 text-sm text-muted-foreground">{p.symbol} · {!hasPeriod?t("No statement data available","אין נתוני דוחות זמינים"):row.kind==="ttm"?t("12 months ending","12 חודשים עד"):t("Quarter ending","רבעון שהסתיים ב־")} {hasPeriod&&<><bdi>{row.end}</bdi> · USD</>}</p></div>
   {hasPeriod&&<div className="flex flex-wrap items-center gap-2"><label className="text-xs">{t("Period","תקופה")}<select aria-label={t("Statement period","תקופת הדוח")} value={row.id} onChange={e=>setPeriodId(e.target.value)} className="ms-2 rounded-lg border border-border bg-background px-2 py-2 text-sm">{periods.map(x=><option key={x.id} value={x.id}>{x.kind==="ttm"?"TTM":"Q"} · {x.end}</option>)}</select></label><button className="rounded-lg border border-border px-3 py-2 text-sm" aria-pressed={per100} onClick={()=>setPer100(!per100)}>{per100?t("Show dollars","הצגת סכומים"):t("Per $100 of sales","לכל $100 מכירות")}</button></div>}
  </header>
  <div className="p-4 sm:p-5">
   <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{labels.map((label,i)=><button key={label} onClick={()=>setStep(i)} aria-pressed={step===i} className={`rounded-xl border p-3 text-start transition-colors ${step===i?"border-primary/70 bg-primary/10":"border-border hover:bg-muted/40"}`}><span className="text-xs text-muted-foreground">{i+1}. {label}</span><span className="mt-1 block font-mono text-xl font-semibold" dir="ltr" style={{color:(vals[i]??0)<0?"hsl(var(--down))":colors[i]}}>{fmt(vals[i])}</span><span className="text-xs text-muted-foreground">{ratio(vals[i])===null?(finite(vals[i])?"—":t("Not available","לא זמין")):`${ratio(vals[i])!.toFixed(1)}% ${t("of sales","מהמכירות")}`}</span></button>)}</div>
   {canFlow?<div className="mt-4 overflow-x-auto" tabIndex={0} aria-label={t("Income flow diagram; scroll horizontally on narrow screens","תרשים זרימת הרווח; ניתן לגלול אופקית במסך צר")}>
    <svg viewBox="0 0 1020 450" className="min-w-[540px] w-full" role="group" aria-label={t("Interactive income flow","תרשים זרימת רווח אינטראקטיבי")} direction="ltr">
     {vals.slice(0,3).map((v,i)=>{const x=35+i*260,nx=x+260,scale=140/Math.max(...vals as number[]),keep=Math.min(v!,vals[i+1]!)*scale,loss=Math.abs(losses[i]!)*scale;
      const band=(sy:number,ty:number,h:number)=>`M ${x+12} ${sy} C ${x+110} ${sy}, ${nx-110} ${ty}, ${nx} ${ty} L ${nx} ${ty+h} C ${nx-110} ${ty+h}, ${x+110} ${sy+h}, ${x+12} ${sy+h} Z`;
      return <g key={i}><path d={band(70,70,keep)} fill={colors[i+1]} opacity={0.3}/>{loss>0&&<g {...stepAction(i+4,lossLabels[i])}><path className="group-hover:opacity-70 group-focus-visible:opacity-70" d={losses[i]!>=0?band(70+keep,290,loss):band(290,70+keep,loss)} fill={losses[i]!>=0?"hsl(var(--down))":"hsl(var(--up))"} opacity={step===i+4?0.6:0.3}/><rect x={losses[i]!>=0?nx:x+12} y={290} width={12} height={Math.max(loss,1)} rx={2} fill={losses[i]!>=0?"hsl(var(--down))":"hsl(var(--up))"}/><text x={losses[i]!>=0?nx-10:x+22} y={270} textAnchor={losses[i]!>=0?"end":"start"} fill="currentColor" fontSize={12}>{losses[i]!>=0?lossLabels[i]:t("Other income / tax, net","הכנסה אחרת / מס, נטו")}</text><text x={losses[i]!>=0?nx-10:x+22} y={286} textAnchor={losses[i]!>=0?"end":"start"} fill={losses[i]!>=0?"hsl(var(--down))":"hsl(var(--up))"} fontSize={13}>{fmt(Math.abs(losses[i]!))}</text></g>}</g>;})}
     {vals.map((v,i)=><g key={i} {...stepAction(i,labels[i])}><rect x={30+i*260} y={15} width={165} height={196} rx={6} fill="currentColor" className={step===i?"opacity-10":"opacity-0 group-hover:opacity-10 group-focus-visible:opacity-15"}/><rect x={35+i*260} y={70} width={12} height={Math.max(1,v!*140/Math.max(...vals as number[]))} rx={3} fill={colors[i]}/><text x={35+i*260} y={30} fill="currentColor" fontSize={13}>{labels[i]}</text><text x={35+i*260} y={50} fill={colors[i]} fontSize={16}>{fmt(v)}</text></g>)}
    </svg>
   </div>:<IncomeFlowWaterfall values={flowValues} labels={flowLabels} format={fmt} selected={step} action={stepAction}
      title={t("Income flow with profit and loss around zero","זרימת הכנסות עם רווח והפסד סביב האפס")} zeroLabel="0" />}
   <p className="mt-2 text-xs text-muted-foreground">{canFlow
      ? t("Blue shows revenue, profit and net additions. Pink shows expenses. Hover or focus for details. Select a step to see its trend.","כחול מציין הכנסות, רווח ותוספות. ורוד מציין הוצאות. העבירו עכבר או התמקדו לפרטים, ובחרו שלב למגמה.")
      : t("The zero line separates profit from loss. Hover or focus for details. Select a step to see its trend. A dash means the figure is unavailable.","קו האפס מפריד בין רווח להפסד. העבירו עכבר או התמקדו לפרטים, ובחרו שלב למגמה. מקף מציין נתון חסר.")}</p>
   {hover&&createPortal(<div id={tooltipId} role="tooltip" className="pointer-events-none fixed z-[100] w-[min(290px,calc(100vw-24px))] rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
     dir={he?"rtl":"ltr"} style={{left:hover.x,top:hover.y,transform:hover.above?"translate(-50%, calc(-100% - 12px))":"translate(-50%, 12px)"}}>
      <div className="flex items-baseline justify-between gap-2 font-semibold"><span>{flowLabels[hover.step]}</span><bdi>{money(flowValues[hover.step])}</bdi></div>
      {ratio(flowValues[hover.step])!==null&&<p className="text-xs text-muted-foreground"><bdi>{ratio(flowValues[hover.step])!.toFixed(1)}%</bdi> {t("of sales","מהמכירות")}</p>}
      <p className="mt-1 text-xs leading-relaxed">{hover.step<4?explanations[hover.step]:bridgeNotes[hover.step-4]}</p>
   </div>, document.body)}
   <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("Expense trends","מגמות הוצאות")}>
    {lossLabels.map((label,i)=><button key={label} type="button" aria-pressed={step===i+4} onClick={()=>setStep(i+4)}
      className={`rounded-lg border px-3 py-1.5 text-xs ${step===i+4?"border-primary/60 bg-primary/10 text-foreground":"border-border text-muted-foreground hover:bg-muted/40"}`}>
      {label}
    </button>)}
   </div>
   <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-4" aria-live="polite">
    <h3 className="font-semibold">{flowLabels[step]} · <bdi>{fmt(flowValues[step])}</bdi></h3>
    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step<4?explanations[step]:bridgeNotes[step-4]}</p>
   </div>
   {hasPeriod&&<IncomeFlowTrend periods={periods} period={row} step={flowSteps[step]} label={flowLabels[step]} onSelect={setPeriodId} />}
   {row.sourceUrl && <a href={row.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 block text-xs text-primary underline">{t("Open the SEC 6-K for this quarter","פתיחת דוח 6-K לרבעון זה")}</a>}
   {hasPeriod&&<p className="mt-3 text-xs leading-relaxed text-muted-foreground">{p.sec.sourceUrl ? t("Source: SEC Form 6-K quarterly releases. A 12-month view sums four consecutive quarters. Figures without verified inputs are blank.","מקור: פרסומים רבעוניים בטופס 6-K של ה־SEC. תצוגת 12 חודשים מסכמת ארבעה רבעונים רצופים. נתונים שלא אומתו נשארים ריקים.") : t("SEC US-GAAP company facts. Gross and operating expense bridges are calculated by subtraction. Tax & other is the net difference between operating and net profit; it is not tax alone. Segment sales are unavailable in this source and are not estimated.","מקור: נתוני US-GAAP של SEC. ההפרשים מחושבים בחיסור. מס ואחרות הם ההפרש הכולל בין הרווח התפעולי לנקי, ולא מס בלבד. פילוח מכירות לפי מגזרים אינו זמין במקור זה ולא הושלם בהערכה.")}</p>}
   {!compact&&hasPeriod&&<><details className="mt-4 rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-medium">{t("Statement details and reconciliation","פירוט הדוח והתאמת הסכומים")}</summary><table className="mt-3 w-full text-sm"><caption className="text-start text-xs text-muted-foreground">{t("Reported or derived from reported totals; — means unavailable.","נתונים מדווחים או מחושבים מסכומים מדווחים; — מציין מידע חסר.")}</caption><tbody>{[[t("Revenue","הכנסות"),row.revenue],[t("Cost of revenue","עלות ההכנסות"),row.cost],[t("Gross profit","רווח גולמי"),row.gross],[t("Operating expenses (derived)","הוצאות תפעול, מחושב"),losses[1]],[t("R&D (included in operating expenses)","מו״פ, נכלל בהוצאות התפעול"),row.rnd],[t("Selling, general & administrative (included above)","מכירות, הנהלה וכלליות, נכלל לעיל"),row.sga],[t("Operating profit","רווח תפעולי"),row.operating],[t("Income tax expense / benefit","הוצאת מס / הטבת מס"),row.tax],[t("Other contribution (net − operating + tax)","תרומה אחרת (נקי פחות תפעולי ועוד מס)"),finite(row.net)&&finite(row.operating)&&finite(row.tax)?row.net-row.operating+row.tax:null],[t("Net profit","רווח נקי"),row.net]].map(([label,v])=><tr key={String(label)} className="border-b border-border/40"><th scope="row" className="py-2 text-start font-normal">{label}</th><td className="text-end font-mono" dir="ltr">{fmt(v as number|null)}</td></tr>)}</tbody></table></details>
   {!p.financial && <CashBridge row={row} he={he}/>}
   <div className="mt-6"><h3 className="text-base font-semibold">{t("The direction matters","גם המגמה חשובה")}</h3><p className="mb-3 text-xs text-muted-foreground">{t("Quarterly values, oldest to newest. Gaps are missing data; quarter labels are fiscal period ends.","נתונים רבעוניים מהישן לחדש. פערים מציינים מידע חסר; התאריכים הם סופי תקופות הדיווח.")}</p><QuarterlyTrends periods={periods} financial={p.financial}/></div></>}
  </div>
 </section>;
}
function CashBridge({row,he}:{row:StatementPeriod;he:boolean}) {const fcf=finite(row.ocf)&&finite(row.capex)?row.ocf-row.capex:null;const after=finite(fcf)&&finite(row.sbc)?fcf-row.sbc:null;return <div className="mt-5 rounded-xl border border-border p-4"><h3 className="font-semibold">{he?"הרווח אינו המזומן":"Profit is not cash"}</h3><div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">{[[he?"תזרים מפעילות":"Operating cash",row.ocf],[he?"השקעה בציוד ונכסים":"Capital spending",row.capex],[he?"תזרים חופשי":"Free cash flow",fcf],[he?"לאחר עלות תגמול במניות":"After stock compensation",after]].map(([k,v])=><div key={String(k)}><p className="text-xs text-muted-foreground">{k}</p><p className="mt-1 font-mono text-lg" dir="ltr">{money(v as number|null)}</p></div>)}</div><p className="mt-3 text-xs text-muted-foreground">{he?"תזרים חופשי = תזרים מפעילות פחות השקעות הוניות. הפחתת תגמול במניות היא התאמה כלכלית, לא תשלום מזומן נוסף.":"Free cash flow = operating cash flow − capital spending. Subtracting stock compensation is an economic adjustment, not another cash payment."}</p></div>}
