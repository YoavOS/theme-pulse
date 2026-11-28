import { useState } from 'react';
import type { StatementPeriod } from '../../../supabase/functions/_shared/financialStatements';
import { comparisonQuarter, growthAcceleration, isNumber, lossChange, quarterGrowth, signCrossover } from '@/lib/lens/quarterly';
import { useLensLang } from '@/lib/lens/i18n';
import { AutoTerms, Term } from './Term';

export const CHART = { positive: 'hsl(var(--up))', negative: 'hsl(var(--down))', growth: 'hsl(var(--warn))', neutral: '#94a3b8' };
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const count = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const amount = (v: number | null, shares: boolean) => v === null ? '—' : (shares ? count : money).format(v);
const signed = (v: number) => (v > 0 ? '+' : '') + v.toFixed(1);
const pct = (v: number | null) => v === null ? '—' : signed(v) + '%';

export function QuarterlyChart({ periods, field, label }: {
  periods: StatementPeriod[];
  field: keyof StatementPeriod;
  label: string;
}) {
  const he = useLensLang() === 'he';
  const t = (en: string, hebrew: string) => he ? hebrew : en;
  const [lag, setLag] = useState<1 | 4>(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const all = periods.filter(row => row.kind === 'quarter').sort((a, b) => a.end.localeCompare(b.end));
  const offset = Math.max(0, all.length - 8);
  const read = (row: StatementPeriod | null) => {
    const value = row?.[field];
    return isNumber(value) ? value : null;
  };
  const profitField = field === 'net' || field === 'operating' || field === 'gross';
  const lossColor = 'hsl(195, 80%, 64%)';
  const rows = all.slice(offset).map((row, index) => {
    const prior = comparisonQuarter(all, offset + index, lag);
    const value = read(row), priorValue = read(prior);
    return {
      id: row.id, end: row.end, value, priorEnd: prior?.end, priorValue,
      crossover: signCrossover(value, priorValue),
      rate: quarterGrowth(all, offset + index, field, lag),
      lossRate: profitField ? lossChange(value, priorValue) : null,
    };
  });
  const selectedIndex = rows.findIndex(row => row.id === selected);
  const chosen = selectedIndex < 0 ? rows.length - 1 : selectedIndex;
  const detail = rows[chosen];
  const showingLoss = isNumber(detail?.lossRate);
  const acceleration = growthAcceleration(all, offset + chosen, field, lag, showingLoss ? lossChange : undefined);
  const shares = field === 'shares';
  const formatAmount = (value: number | null) => amount(value, shares);
  const baseLabel = lag === 1 ? t('Previous quarter', 'הרבעון הקודם') : t('Same quarter last year', 'אותו רבעון אשתקד');
  const mode = lag === 1 ? 'QoQ' : 'YoY';
  const modeTerm = <Term id={lag === 1 ? 'qoq' : 'yoy'}>{mode}</Term>;
  const hasCrossovers = rows.some(row => row.crossover !== null);
  const hasLoss = rows.some(row => row.lossRate !== null);
  const hasGrowth = rows.some(row => row.rate !== null);
  const lossLabel = (v: number) => v > 0 ? t('Loss narrowed', 'ההפסד הצטמצם')
    : v < 0 ? t('Loss widened', 'ההפסד גדל') : t('Loss unchanged', 'ההפסד לא השתנה');
  const lossDetail = (v: number) => v === 0 ? lossLabel(v) : lossLabel(v) + ' ' + Math.abs(v).toFixed(1) + '%';
  const upLabel = profitField ? t('Loss → profit', 'מהפסד לרווח') : t('Negative → positive', 'משלילי לחיובי');
  const downLabel = profitField ? t('Profit → loss', 'מרווח להפסד') : t('Positive → negative', 'מחיובי לשלילי');
  const crossoverLabel = (direction: 'up' | 'down') => direction === 'up' ? upLabel : downLabel;
  const crossoverColor = (direction: 'up' | 'down') => direction === 'up' ? CHART.positive : CHART.negative;

  const amounts = rows.flatMap(row => [row.value, row.priorValue]).filter(isNumber);
  const lo = Math.min(0, ...amounts);
  const hi = Math.max(0, ...amounts);
  const y = (v: number) => 124 - (v - lo) / (hi - lo || 1) * 96;
  const amountTicks = hi === lo ? [0] : lo < 0 && hi > 0 ? [lo, 0, hi] : [lo, (lo + hi) / 2, hi];

  const maxRate = Math.max(5, ...rows.flatMap(row => [row.rate, row.lossRate]).filter(isNumber).map(Math.abs));
  const step = 10 ** Math.floor(Math.log10(maxRate));
  const bound = Math.ceil(maxRate / step) * step;
  const ry = (v: number) => 200 - v / bound * 37;
  const plotLeft = 62;
  const plotRight = 476;
  const x = (i: number) => plotLeft + (i + 0.5) * (plotRight - plotLeft) / Math.max(1, rows.length);
  const series = [
    { key: 'rate', color: CHART.growth, dash: undefined },
    { key: 'lossRate', color: lossColor, dash: '5 4' },
  ] as const;
  const line = (key: 'rate' | 'lossRate') => rows.map((row, i) => row[key] === null ? '' :
    (i === 0 || rows[i - 1][key] === null ? 'M' : 'L') + x(i) + ' ' + ry(row[key])).join(' ');
  const textStyle = { fontSize: 14, fill: 'currentColor', opacity: 0.78 };
  const bar = (value: number | null, position: number, active: boolean, comparison: boolean) => {
    if (value === null) return null;
    const color = value < 0 ? CHART.negative : CHART.positive;
    return <rect x={position} y={Math.min(y(value), y(0))} width="13"
      height={Math.max(1, Math.abs(y(value) - y(0)))} rx="2"
      fill={comparison ? 'none' : color} stroke={comparison ? CHART.neutral : 'none'}
      strokeWidth="1.5" opacity={active ? 1 : 0.72} />;
  };

  return <section className="min-w-0 rounded-2xl border border-border bg-card/50 p-4">
    <div className="flex min-h-11 items-start justify-between gap-2">
      <h3 className="min-w-0 font-semibold leading-5"><AutoTerms text={label}/></h3>
      <div role="group" aria-label={t(label + ' growth comparison', label + ' השוואת צמיחה')} className="flex shrink-0 rounded-lg border border-border p-0.5">
        {([1, 4] as const).map(n => <button key={n} aria-pressed={lag === n} onClick={() => setLag(n)}
          className={'rounded-md px-2 py-1 text-xs ' + (lag === n ? 'bg-primary/20 text-primary' : 'text-muted-foreground')}>
          {n === 1 ? t('QoQ', 'רבעוני') : t('YoY', 'שנתי')}
        </button>)}
      </div>
    </div>
    {detail ? <>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <bdi className="font-mono text-2xl">{formatAmount(detail.value)}</bdi>
        {detail.crossover
          ? <span className="text-sm font-medium" style={{ color: crossoverColor(detail.crossover) }}>
              {detail.crossover === 'up' ? '↑' : '↓'} {crossoverLabel(detail.crossover)}
            </span>
          : detail.lossRate !== null
            ? <span className="text-sm font-medium" style={{ color: lossColor }}><Term id="loss_change">{lossDetail(detail.lossRate)}</Term> <bdi>{modeTerm}</bdi></span>
            : <bdi className="font-mono text-sm" style={{ color: CHART.growth }}>{pct(detail.rate)} {modeTerm}</bdi>}
        <bdi className="text-xs text-muted-foreground">{detail.end}</bdi>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        <Term id={lag === 1 ? 'qoq' : 'yoy'}>{baseLabel}</Term>{' · '}<bdi>{detail.priorEnd ?? '—'}</bdi>{' · '}<bdi>{formatAmount(detail.priorValue)}</bdi>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {showingLoss
          ? <AutoTerms text={t('Loss change vs previous quarter’s rate', 'השינוי בהפסד מול קצב הרבעון הקודם')} />
          : <AutoTerms text={t('Growth vs previous quarter’s rate', 'קצב הצמיחה מול קצב הרבעון הקודם')} />}{' · '}
        <bdi style={{ color: acceleration === null ? undefined : acceleration < 0 ? CHART.negative : CHART.positive }}>
          {acceleration === null ? '—' : <>{signed(acceleration)} <Term id="percentage_points">pp</Term></>}
        </bdi>
      </p>
      <div className="relative mt-2" dir="ltr" onPointerLeave={() => setHover(null)}>
      <svg viewBox={hasCrossovers ? "0 0 540 300" : "0 0 540 278"} role="img" direction="ltr" className="w-full"
        aria-label={t('Paired quarterly amounts and ' + mode + ' percentage changes with a zero baseline. Exact data below.',
          'סכומי רבעון מול תקופת ההשוואה ושינויים באחוזים עם קו אפס. נתונים מדויקים בהמשך.')}>
        <text x={plotLeft} y="15" {...textStyle}>{t('Quarterly amounts', 'סכומים רבעוניים')}</text>
        <text x={plotLeft} y="151" fill={hasLoss ? lossColor : CHART.growth} fontSize="14">
          {hasLoss ? (hasGrowth ? t('Growth and loss change', 'צמיחה ושינוי בהפסד') : t('Loss change', 'שינוי בהפסד')) : t('Growth', 'צמיחה')} · <Term svg id={lag === 1 ? 'qoq' : 'yoy'}>{mode}</Term>
        </text>
        <rect x={x(chosen) - 23} y="23" width="46" height="215" rx="4" fill={CHART.positive} opacity=".08" />
        {hover !== null && hover !== chosen && <rect x={x(hover) - 23} y="23" width="46" height="215" rx="4" fill="currentColor" opacity=".05" />}
        {amountTicks.map(n => <g key={n}>
          <line x1={plotLeft} x2={plotRight} y1={y(n)} y2={y(n)} stroke="currentColor" opacity={n === 0 ? '.35' : '.14'} />
          {(n === 0 || Math.abs(y(n) - y(0)) >= 22) &&
            <text x={plotLeft - 6} y={y(n) + 4} textAnchor="end" {...textStyle}>{formatAmount(n)}</text>}
        </g>)}
        {[bound, 0, -bound].map(n => <g key={n}>
          <line x1={plotLeft} x2={plotRight} y1={ry(n)} y2={ry(n)} stroke={n === 0 ? CHART.growth : 'currentColor'}
            strokeDasharray={n === 0 ? '5 4' : undefined} opacity={n === 0 ? '.68' : '.18'} />
          <text x={plotRight + 6} y={ry(n) + 4} fontSize="14" fill={CHART.growth}>{n > 0 ? '+' : ''}{count.format(n)}%</text>
        </g>)}
        {rows.map((row, i) => <g key={row.id}>
          {bar(row.priorValue, x(i) - 15, chosen === i, true)}
          {bar(row.value, x(i) + 2, chosen === i, false)}
          <text x={x(i)} y={hasCrossovers ? "281" : "258"} textAnchor="middle" {...textStyle}>{row.end.slice(2, 7)}</text>
        </g>)}
        {rows.map((row, i) => {
          if (!row.crossover) return null;
          const color = crossoverColor(row.crossover);
          return <g key={row.id} transform={`translate(${x(i)} 252)`}>
            <title>{row.end} · {crossoverLabel(row.crossover)} · {formatAmount(row.priorValue)} → {formatAmount(row.value)}</title>
            <rect x="-10" y="-90" width="20" height="75" rx="4" fill={color} opacity=".12" />
            <line x1="0" x2="0" y1="-89" y2="-10" stroke={color} strokeDasharray="3 4" opacity=".48" />
            <circle r="10" fill={color} fillOpacity=".18" stroke={color} />
            <path d={row.crossover === 'up' ? 'M0 5V-5M-4 -1L0 -5L4 -1' : 'M0 -5V5M-4 1L0 5L4 1'}
              stroke={color} fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </g>;
        })}
        {series.map(({ key, color, dash }) => <g key={key}>
          <path d={line(key)} fill="none" stroke={color} strokeWidth="2.5" strokeDasharray={dash} />
          {rows.map((row, i) => {
            const value = row[key];
            if (value === null) return null;
            return <circle key={row.id} cx={x(i)} cy={ry(value)} r={i === chosen || i === hover ? 5 : 3.5} fill={color}
              stroke={i === hover ? 'hsl(var(--background))' : undefined} strokeWidth={i === hover ? 1.5 : undefined} />;
          })}
        </g>)}
        {!hasGrowth && !hasLoss && <text x="269" y="184" textAnchor="middle" {...textStyle}>
          {t('Growth unavailable', 'אין נתוני צמיחה')}
        </text>}
        {/* one hover/click area per quarter: covers both bars and the growth dot */}
        {rows.map((row, i) => <rect key={row.id} x={x(i) - (plotRight - plotLeft) / rows.length / 2} y="20" width={(plotRight - plotLeft) / rows.length} height="222"
          fill="transparent" style={{ cursor: 'pointer' }} onPointerEnter={() => setHover(i)} onClick={() => setSelected(row.id)} />)}
      </svg>
      {hover !== null && rows[hover] && (() => {
        const row = rows[hover], h = hasCrossovers ? 300 : 278;
        const dotY = row.lossRate ?? row.rate;
        const top = (isNumber(dotY) ? ry(dotY) : y(Math.max(row.value ?? 0, row.priorValue ?? 0, 0))) / h * 100;
        const left = x(hover) / 540 * 100;
        const g = row.crossover ? crossoverLabel(row.crossover) : row.lossRate !== null ? lossDetail(row.lossRate) : pct(row.rate);
        const gColor = row.crossover ? crossoverColor(row.crossover) : row.lossRate !== null ? lossColor : row.rate === null ? undefined : row.rate < 0 ? CHART.negative : CHART.growth;
        return <div role="tooltip" className="pointer-events-none absolute z-10 w-max min-w-[150px] rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11.5px] leading-snug text-popover-foreground shadow-lg"
          style={{ left: `${Math.min(Math.max(left, 18), 82)}%`, top: `${top}%`, transform: 'translate(-50%, calc(-100% - 10px))' }} dir={he ? 'rtl' : 'ltr'}>
          <div className="font-semibold"><bdi>{row.end}</bdi></div>
          <div className="mt-0.5 flex justify-between gap-3"><span className="text-muted-foreground">{t('This quarter', 'הרבעון הזה')}</span><bdi className="font-mono" style={{ color: row.value !== null && row.value < 0 ? CHART.negative : CHART.positive }}>{formatAmount(row.value)}</bdi></div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">{baseLabel}</span><bdi className="font-mono">{formatAmount(row.priorValue)}</bdi></div>
          <div className="mt-0.5 flex justify-between gap-3 border-t border-border/60 pt-0.5"><span className="text-muted-foreground">{row.lossRate !== null ? t('Loss change', 'שינוי בהפסד') : t('Growth', 'צמיחה')} · {mode}</span><bdi className="font-mono font-semibold" style={{ color: gColor }}>{g}</bdi></div>
        </div>;
      })()}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span><span style={{ color: CHART.positive }}>■</span> {t('Each quarter', 'כל רבעון')}</span>
        <span><span style={{ color: CHART.neutral }}>□</span> {baseLabel}</span>
        <span><span style={{ color: CHART.negative }}>■</span> {t('Negative amount', 'סכום שלילי')}</span>
      </div>
      {hasLoss && <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {hasGrowth && <span><span style={{ color: CHART.growth }}>━</span> {t('Growth', 'צמיחה')}</span>}
        <span><span style={{ color: lossColor }}>┄</span> <AutoTerms text={t('Loss change: above zero means a smaller loss', 'שינוי בהפסד: מעל האפס ההפסד הצטמצם')}/></span>
      </div>}
      {hasCrossovers && <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span><span style={{ color: CHART.positive }}>↑</span> {upLabel}</span>
        <span><span style={{ color: CHART.negative }}>↓</span> {downLabel}</span>
        <span>{t('Arrows mark a crossover with no growth %.', 'החצים מסמנים מעבר ללא שיעור צמיחה.')}</span>
      </div>}
      <div className="mt-3 grid gap-1" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }} role="group" aria-label={t(label + ' quarter details', label + ' בחירת רבעון')}>
        {rows.map((row, i) => <button key={row.id} onClick={() => setSelected(row.id)} aria-pressed={chosen === i}
          className={'rounded px-0 py-1 text-center font-mono text-[10.5px] tabular-nums ' + (chosen === i ? 'bg-primary/20 text-primary' : 'bg-muted/30 text-muted-foreground')}>
          {row.end.slice(2, 7)}
        </button>)}
      </div>
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer">{t('How to read this + exact figures', 'איך לקרוא את התרשים + נתונים מדויקים')}</summary>
        <p className="mt-2 leading-relaxed">{<AutoTerms text={t(
          'Each bar pair compares the two amounts used for the growth point below. Growth below 0% means the amount fell. A positive growth rate can still slow down: going from 20% to 10% is a slowdown of 10 percentage points. Growth is unavailable across losses, a zero base or missing periods.',
          'כל זוג עמודות מציג את שני הסכומים ששימשו לחישוב נקודת הצמיחה שמתחתיו. צמיחה מתחת ל־0% פירושה ירידה בסכום. גם צמיחה חיובית יכולה להאט: מעבר מ־20% ל־10% הוא האטה של 10 נקודות אחוז. אין שיעור צמיחה כשיש הפסד, בסיס אפס או תקופה חסרה.'
        )}/>}</p>
        {hasLoss && <p className="mt-2 leading-relaxed">{<AutoTerms text={t(
          'When both periods report a loss, the dashed line measures the dollar change as a share of the earlier loss. A move from −$100M to −$80M gives +20%. Changes in the rate are shown in percentage points when both rates measure loss change.',
          'כשבשתי התקופות יש הפסד, הקו המקווקו מודד את השינוי בסכום ביחס לגודל ההפסד הקודם. מעבר מ־100 מיליון דולר הפסד ל־80 מיליון נותן 20%+. ההפרש בין הקצבים מוצג בנקודות אחוז כששניהם מודדים שינוי בהפסד.'
        )}/>}</p>}
        <div className="overflow-x-auto">
          <table className="mt-2 w-full text-start">
            <thead><tr><th>{t('Period', 'תקופה')}</th><th>{t('Amount', 'סכום')}</th><th>{t('Compared with', 'בהשוואה ל־')}</th><th>{modeTerm}</th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.id}>
              <td><bdi>{row.end}</bdi></td><td><bdi>{formatAmount(row.value)}</bdi></td>
              <td><bdi>{row.priorEnd ? row.priorEnd + ' · ' + formatAmount(row.priorValue) : '—'}</bdi></td>
              <td><bdi>{row.crossover ? crossoverLabel(row.crossover) : row.lossRate === null ? pct(row.rate) : <AutoTerms text={lossDetail(row.lossRate)} />}</bdi></td>
            </tr>)}</tbody>
          </table>
        </div>
      </details>
    </> : <p className="mt-2 text-sm text-muted-foreground">{t('Quarterly data unavailable.', 'אין נתוני רבעון זמינים.')}</p>}
  </section>;
}


export function QuarterlyTrends({periods,primary=false,financial=false}:{periods:StatementPeriod[];primary?:boolean;financial?:boolean}) {
 const he=useLensLang()==='he';
 const fields: [keyof StatementPeriod,string][]=[['revenue',he?'הכנסות: האם העסק גדל?':'Revenue: is the business growing?'],['net',he?'רווח: מה נשאר בסוף?':'Profit: what is left over?'],[financial?'shares':'ocf',financial?(he?'בעלות: האם מספר המניות משתנה?':'Ownership: is share count changing?'):(he?'מזומן: מה הפעילות מייצרת?':'Cash: what does the business generate?')],['operating',he?'רווח מהפעילות':'Operating profit'],['sbc',he?'תגמול במניות':'Stock compensation'],['shares',he?'מספר המניות בדילול':'Diluted average shares']];
 return <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">{(primary?fields.slice(0,3):fields.filter(([f],i)=>!financial || i<3 || (f!=="operating" && f!=="shares"))).map(([field,label])=><QuarterlyChart key={field} periods={periods} field={field} label={label}/>)}</div>;
}
