// ─────────────────────────────────────────────────────────────
// Fundamentals Lens — the curriculum.
// Concepts taught in the panel, written in the app's own words, built on the frameworks Aswath
// Damodaran teaches in his NYU Stern MBA Valuation and Corporate Finance courses (Spring 2025
// recordings) and his Corporate Life Cycle class. Nothing here is quoted from the lectures; each
// concept links to the sessions where he covers it (session-level links — timestamps are curated
// by hand later, never scraped). Session placements marked `inferred` were not checked against slides.
// PURE module (no imports beyond types) — used by the fundamentals-lens edge function, which sends
// the relevant pieces to the panel and to the explanation model.
// ─────────────────────────────────────────────────────────────

import type { Pillar, Stage } from "./lensMetrics.ts";

export interface Lecture { course: "Valuation" | "Corporate Finance" | "Life Cycle"; session: number | null; videoId: string | null; playlist?: string; title: string; inferred?: boolean }
export interface Concept {
  id: string;
  pillar: Pillar | "foundations";
  title: string;
  metricIds: string[];          // metrics shown on this card (lensMetrics ids)
  primary: string;              // the metric the collapsed row shows
  question: string;             // self-explanation prompt shown before the answer
  what: string;                 // L1: what it is, plain words
  why: string;                  // L1: why it matters for value (the Damodaran lens)
  industry: string;             // why this number differs across industries
  stages: Partial<Record<Stage, string>>; // what to expect at each life-cycle stage
  caveats: string[];            // L3: traps, adjustments, what it can't tell you
  lectures: Lecture[];
  higherIsBetter: boolean | null; // for neutral wording of peer position (null = depends)
}

export const PLAYLISTS = {
  valuation: "https://www.youtube.com/playlist?list=PLUkh9m2BorqkgpNyRpP-NL3BS4yvFabXk",
  corpFin: "https://www.youtube.com/playlist?list=PLUkh9m2Borqn549nqiEOyFRIvqs4_P3d0",
  lifeCycle: "https://www.youtube.com/playlist?list=PLUkh9m2BorqlpbJBd26UEawPHk0k9y04",
};

const V = (session: number, videoId: string, title: string, inferred = false): Lecture => ({ course: "Valuation", session, videoId, title, inferred });
const CF = (session: number, videoId: string, title: string, inferred = false): Lecture => ({ course: "Corporate Finance", session, videoId, title, inferred });
const CLC: Lecture = { course: "Life Cycle", session: null, videoId: null, playlist: PLAYLISTS.lifeCycle, title: "Corporate Life Cycle class (20 short sessions)" };

export const L = {
  v1: V(1, "eIcyARH3FiM", "Valuation priors and preconceptions"),
  v3: V(3, "Hf4niCYe1R8", "Cash flow consistency"),
  v8: V(8, "MtsRSkV4HUg", "Cost of debt and capital; measuring earnings"),
  v9: V(9, "EOwEdlva1Rc", "Free cash flows; normalizing earnings"),
  v10: V(10, "BH66ZpTVTdg", "Historical and fundamental growth"),
  v11: V(11, "so6vCWKCiXE", "More on growth; terminal value"),
  v12: V(12, "JOJWcEs0uWw", "Loose ends: cash, cross holdings, debt"),
  v13: V(13, "nmPDxY7Q3lk", "Stock-based compensation; stories and numbers"),
  v14: V(14, "WEgelyAqeeA", "Storytelling and valuation"),
  v15: V(15, "oBLZ-tPH9X0", "Young, mature and declining firms"),
  v16: V(16, "knln8-Ni9OA", "Distressed, financial and commodity firms"),
  v17: V(17, "ldTsmcTNJE8", "Multiples and consistency tests"),
  v19: V(19, "rjqwM6ZTpA0", "Multiples analytics; peer groups"),
  cf2: CF(2, "CqwuN4dLLFg", "Objective of the firm; value vs price"),
  cf10: CF(10, "RNeCC28qbVI", "Cost of capital"),
  cf11: CF(11, "0FeHGmeqcX0", "Earnings vs cash flows"),
  cf12: CF(12, "CncUmN65lDs", "Measuring investment returns; hurdle rates"),
  cf16: CF(16, "4ZWSccnMaa4", "Debt vs equity; the financing trade-off"),
  cf17: CF(17, "fdEnaqWUYzM", "The cost of capital approach to debt"),
  cf19: CF(19, "jv-mk7lpIdg", "Optimal debt ratio; peer-group debt"),
  cf21: CF(21, "Ka_oFIhWmwo", "Designing financing; first steps on dividends"),
  cf22: CF(22, "HwmBqsMySTg", "Dividend policy: facts and schools of thought"),
  cf24: CF(24, "bm1zE4wCQvI", "Assessing dividend policy"),
  clc: CLC,
};

export const STAGES: Record<Stage, { label: string; question: string; signature: string; focus: string[]; pricing: string; lectures: Lecture[] }> = {
  startup: {
    label: "Start-up",
    question: "Is there a real product and a big enough market?",
    signature: "Tiny or no revenue, large losses, cash coming from investors rather than customers.",
    focus: ["rev_growth_ttm", "op_margin", "cash_runway", "share_change"],
    pricing: "Priced almost entirely on the story — users, market size, promises. The gap between price and any estimate of value is widest here.",
    lectures: [L.v15, CLC],
  },
  young_growth: {
    label: "Young Growth",
    question: "Is the business model working, and how long can it fund itself?",
    signature: "Revenue growing fast, operating losses, negative free cash flow, new shares issued to raise money or pay staff.",
    focus: ["rev_growth_ttm", "gross_margin", "cash_runway", "share_change"],
    pricing: "Mostly priced on revenue multiples and the story. Small changes in expectations move the price a lot — which is why traders dominate these names.",
    lectures: [L.v15, CLC],
  },
  high_growth: {
    label: "High Growth",
    question: "Can growth keep scaling while margins rise toward where they'll settle?",
    signature: "Revenue still growing quickly, margins positive and improving, heavy reinvestment; free cash flow can still be thin or negative.",
    focus: ["rev_growth_ttm", "op_margin_change", "sales_to_capital", "sbc_intensity"],
    pricing: "Priced on revenue or forward earnings. The key question is whether the margin improvement the price assumes is actually showing up.",
    lectures: [L.v15, L.v13, CLC],
  },
  mature_growth: {
    label: "Mature Growth",
    question: "Does each dollar reinvested earn more than the cost of capital?",
    signature: "Growth slowing toward the economy's pace, solid margins, free cash flow turning reliably positive, room to carry some debt.",
    focus: ["rev_growth_ttm", "roic", "reinvestment_rate", "fcf_margin"],
    pricing: "Priced on earnings multiples (P/E, EV/EBIT). The price-to-value gap narrows as numbers matter more than stories.",
    lectures: [L.v15, L.cf12, CLC],
  },
  mature_stable: {
    label: "Mature Stable",
    question: "Is the cash being returned and the debt being used sensibly?",
    signature: "Low growth, high and steady margins, strong free cash flow, large buybacks or dividends, possibly acquisitions.",
    focus: ["roic", "fcf_margin", "cash_return_vs_fcf", "interest_coverage"],
    pricing: "Priced on earnings and cash yields. Surprises tend to be small, so price moves are slower.",
    lectures: [L.v15, L.cf21, L.cf24, CLC],
  },
  decline: {
    label: "Decline",
    question: "Is management shrinking gracefully — or burning cash trying to grow again?",
    signature: "Revenue shrinking, margins under pressure, cash returned or used to pay down debt; acquisitions to 'buy growth' are a warning sign.",
    focus: ["rev_growth_ttm", "op_margin_change", "cash_return", "interest_coverage"],
    pricing: "Priced on book value or break-up value. Cheap-looking multiples can stay cheap.",
    lectures: [L.v15, L.v16, CLC],
  },
};

export const CONCEPTS: Concept[] = [
  // ── Foundations
  {
    id: "value_vs_price", pillar: "foundations", title: "Value vs price", metricIds: [], primary: "",
    question: "If a stock's price doubles, did the company's value double?",
    what: "Price is what the market pays today; value is what the business's future cash flows are worth, given their growth and risk.",
    why: "Price is driven by mood, momentum and flows; value by fundamentals. They can drift apart for a long time — a trader profits from price, but knowing the fundamentals tells you what story the price is betting on.",
    industry: "",
    stages: {},
    caveats: ["Fundamentals rarely tell you when a price will move — they tell you what has to happen for the price to be justified."],
    lectures: [L.cf2, L.v1], higherIsBetter: null,
  },
  {
    id: "life_cycle", pillar: "foundations", title: "Corporate life cycle", metricIds: [], primary: "",
    question: "Why would losing money be normal for one company and alarming for another?",
    what: "Companies move through six stages — start-up, young growth, high growth, mature growth, mature stable, decline — and each stage has its own normal numbers.",
    why: "The same reading means different things at different ages: negative free cash flow is the expected cost of growth for a young company and a red flag for a mature one. Placing the company first tells you which numbers matter most.",
    industry: "Whole industries also age — but individual companies inside them can be at different stages.",
    stages: {},
    caveats: ["The stage tag here is the app's rule of thumb from growth, margins and cash flow — Damodaran gives no numeric cut-offs.", "Tech companies tend to age faster: they rise, peak and fade in fewer years."],
    lectures: [L.v15, CLC], higherIsBetter: null,
  },
  {
    id: "story_numbers", pillar: "foundations", title: "Story and numbers", metricIds: [], primary: "",
    question: "What would have to be true for today's price to make sense?",
    what: "Every valuation is a story turned into four inputs: how fast revenue grows, what margins it reaches, how much it must reinvest to grow, and how risky it is.",
    why: "If a piece of the story doesn't change one of those inputs, it isn't really part of the valuation. Checking what the price implies — growth, margins — is a quick way to see how much hope is priced in.",
    industry: "",
    stages: {},
    caveats: ["A bigger market only helps if the company can win a share of it profitably."],
    lectures: [L.v13, L.v14], higherIsBetter: null,
  },

  // ── Growth
  {
    id: "revenue_growth", pillar: "growth", title: "Revenue growth", metricIds: ["rev_growth_ttm", "rev_growth_q", "rev_cagr_3y"], primary: "rev_growth_ttm",
    question: "Is fast revenue growth always good for shareholders?",
    what: "How much more the company sold than a year earlier. Trailing-twelve-month growth smooths seasons; the latest quarter shows the direction now; the 3-year figure shows the longer pattern.",
    why: "Growth only creates value when the money reinvested to get it earns more than it costs. Growth is the first lever in any valuation story, but it's never free.",
    industry: "Young industries (cloud software, new energy) grow fast as a whole; mature ones (food, utilities) grow near the economy's pace. Compare growth with peers, not with the market.",
    stages: {
      startup: "Growth percentages are huge but meaningless off a tiny base — watch the absolute revenue.",
      young_growth: "Fast growth (often 25%+) is expected; slowing growth here is a much bigger deal than for a mature firm.",
      high_growth: "Still fast, usually 15–40%. The question is whether it's slowing gradually or falling off a cliff.",
      mature_growth: "Single digits to mid-teens is normal.",
      mature_stable: "Growth near inflation and the economy is normal — don't expect more.",
      decline: "Shrinking revenue is the defining sign. The question is how fast and whether margins hold.",
    },
    caveats: ["Acquisitions can make growth look organic when it was bought — check whether acquisitions show up in reinvestment.", "One strong quarter after a weak one (easy comparison) can exaggerate the latest-quarter rate."],
    lectures: [L.v10, L.v11], higherIsBetter: true,
  },
  {
    id: "earnings_growth", pillar: "growth", title: "Earnings growth", metricIds: ["opinc_growth_ttm", "ni_growth_ttm"], primary: "opinc_growth_ttm",
    question: "Why can earnings grow much faster than revenue — and why doesn't that last?",
    what: "Growth in operating income (before interest and taxes) and in net income (what's left for shareholders).",
    why: "When margins expand, earnings outgrow revenue; that's what momentum traders often see in leaders. But margins can't expand forever, so long-run earnings growth comes back toward revenue growth.",
    industry: "Industries with high fixed costs (chips, airlines) see earnings swing much more than revenue — operating leverage works both ways.",
    stages: {
      young_growth: "Usually not meaningful — earnings are negative or tiny.",
      high_growth: "Earnings growing faster than revenue is the signal that scale is paying off.",
      mature_stable: "Earnings should track revenue; big jumps usually come from buybacks, one-offs or cost cuts.",
    },
    caveats: ["Growth from a near-zero or negative base produces huge, meaningless percentages.", "Net income includes one-off items, interest and tax changes — operating income is the cleaner read of the business."],
    lectures: [L.v10, L.v8], higherIsBetter: true,
  },

  // ── Profitability
  {
    id: "gross_margin", pillar: "profitability", title: "Gross margin", metricIds: ["gross_margin", "gross_margin_change"], primary: "gross_margin",
    question: "What does gross margin tell you that operating margin doesn't?",
    what: "The share of each sales dollar left after paying the direct cost of the product or service.",
    why: "It shows pricing power and the economics of the product itself, before the company spends on growth (R&D, marketing). A high gross margin with a negative operating margin means the product works but the company is spending heavily to grow.",
    industry: "Software and drug makers keep most of each dollar; retailers, distributors and manufacturers keep a small slice. A 30% gross margin is weak for software and strong for a grocer.",
    stages: {
      young_growth: "The most useful profitability number at this stage: it shows what margins could become once growth spending slows.",
      decline: "A falling gross margin often means losing pricing power to competitors.",
    },
    caveats: ["Companies decide what goes into cost of revenue differently, so compare within the industry only."],
    lectures: [L.v8, L.v13], higherIsBetter: true,
  },
  {
    id: "operating_margin", pillar: "profitability", title: "Operating margin", metricIds: ["op_margin", "op_margin_change"], primary: "op_margin",
    question: "If two companies grow equally fast, why might the one with lower margins be worth less?",
    what: "Operating income as a share of revenue — what the business earns from its operations before interest and taxes.",
    why: "It's the profitability input in a valuation story. The direction matters as much as the level: rising margins as the company grows is the payoff of scale; falling margins can signal competition or rising costs.",
    industry: "In Damodaran's January 2026 US data the pre-tax operating margin was about 33% for system & application software and about 2% for grocery retail — so 'good' depends entirely on the business.",
    stages: {
      startup: "Deeply negative is expected.",
      young_growth: "Negative is normal; watch whether losses shrink as revenue grows.",
      high_growth: "Positive and rising toward the industry's typical level.",
      mature_growth: "Near its long-run level; small changes matter for value.",
      mature_stable: "High and steady. A drop is a warning.",
      decline: "Shrinking margins are the usual sign that decline is accelerating.",
    },
    caveats: ["Damodaran treats R&D as an investment, not an expense — for R&D-heavy firms reported operating margins understate true profitability.", "Under US accounting, operating lease costs sit inside operating income; his adjusted margins move them out. The industry comparison here uses his unadjusted column."],
    lectures: [L.v8, L.v13, L.cf12], higherIsBetter: true,
  },
  {
    id: "net_margin", pillar: "profitability", title: "Net margin", metricIds: ["net_margin"], primary: "net_margin",
    question: "Why can two companies with the same operating margin have very different net margins?",
    what: "Net income as a share of revenue — what's left for shareholders after interest and taxes.",
    why: "It's what drives earnings per share, but it mixes the business (operating margin) with financing (interest) and one-off items, so it's a noisier read than operating margin.",
    industry: "Heavily indebted industries (utilities, telecom) lose more to interest, so their net margins sit further below operating margins.",
    stages: {},
    caveats: ["One-off gains or write-downs can swing net income in a single year.", "Compare with operating margin: a big gap means interest, tax or one-offs are doing the work."],
    lectures: [L.v8], higherIsBetter: true,
  },
  {
    id: "rnd", pillar: "profitability", title: "R&D intensity", metricIds: ["rnd_intensity"], primary: "rnd_intensity",
    question: "Should research spending be treated like rent or like building a factory?",
    what: "Research and development spending as a share of revenue.",
    why: "Accounting subtracts R&D as an expense, but Damodaran argues it's an investment — spending today for products that earn for years. Treating it as capital usually raises margins and lowers return on capital for R&D-heavy firms.",
    industry: "Drug makers, chip designers and software firms spend heavily; retailers and utilities barely spend at all.",
    stages: { young_growth: "High R&D is the investment that builds the future business.", decline: "Cutting R&D can lift margins for a while at the cost of the future." },
    caveats: ["The app doesn't capitalize R&D yet — that adjustment (with an amortization life per industry) comes later."],
    lectures: [L.v8, L.v9], higherIsBetter: null,
  },
  {
    id: "roe", pillar: "profitability", title: "Return on equity", metricIds: ["roe"], primary: "roe",
    question: "Can a company raise its ROE without becoming a better business?",
    what: "Net income as a share of the shareholders' equity on the balance sheet.",
    why: "It measures the return to shareholders on the money they have in the business. It's the main return measure for banks and insurers, where debt is part of the operation.",
    industry: "Asset-light businesses show high ROE; capital-heavy and regulated ones (banks, utilities) show lower ROE. Heavy buybacks shrink book equity and push ROE up mechanically.",
    stages: {},
    caveats: ["More debt raises ROE without improving the business — compare with ROIC.", "Negative book equity (common after large buybacks) makes ROE meaningless."],
    lectures: [L.cf12, L.v10], higherIsBetter: true,
  },
  {
    id: "roic", pillar: "profitability", title: "Return on invested capital", metricIds: ["roic"], primary: "roic",
    question: "Why can growth destroy value?",
    what: "After-tax operating income as a share of the capital invested in the business (debt + equity − cash), measured at the start of the year.",
    why: "This is the heart of Damodaran's corporate finance: a business creates value only when its return on capital beats its cost of capital. Growth at returns below that cost makes the company bigger and less valuable at the same time.",
    industry: "Asset-light businesses (software, brands) earn high returns on little capital; capital-heavy ones (utilities, steel, airlines) earn lower returns on a lot of capital. Compare with the industry and, ideally, with its cost of capital.",
    stages: {
      young_growth: "Usually negative — the capital is invested before the profits arrive. Judge the trend, not the level.",
      high_growth: "Rising return on capital is the sign that growth is becoming profitable.",
      mature_growth: "The key number: returns above the cost of capital mean reinvesting adds value.",
      mature_stable: "Should be steady and above the cost of capital — if not, returning cash beats reinvesting it.",
      decline: "Falling returns are the case for shrinking and paying out.",
    },
    caveats: ["Accounting choices (expensed R&D, leases, write-downs, buybacks) can push it far from the true economic return.", "The next card compares it with what capital costs in the industry."],
    lectures: [L.cf12, L.v10, L.cf11], higherIsBetter: true,
  },
  {
    id: "value_creation", pillar: "profitability", title: "Returns vs the cost of capital", metricIds: ["excess_return", "equity_spread"], primary: "excess_return",
    question: "Two companies both grow 20% a year. How can one be getting more valuable and the other less?",
    what: "The return the business earns on its capital minus the return its investors require for the risk (the cost of capital). For banks and insurers the same test is done on equity: return on equity minus the cost of equity.",
    why: "This spread is the hinge of corporate finance. Positive: every dollar reinvested is worth more than a dollar, so growth adds value. Zero: growth just makes the company bigger. Negative: growth destroys value, and the company would be worth more reinvesting less and returning cash.",
    industry: "Costs of capital differ by industry mainly through risk (beta) and debt: in Damodaran's January data, steady, debt-funded businesses such as utilities sit near the bottom and volatile, equity-funded ones such as semiconductors near the top. A 9% return clears the hurdle in one industry and misses it in another.",
    stages: {
      startup: "Almost always negative — the test that matters is whether the path to a positive spread is believable.",
      young_growth: "Negative is normal; watch for the spread narrowing as margins improve.",
      high_growth: "Turning positive is the moment growth starts creating value rather than just size.",
      mature_growth: "A clearly positive spread is what justifies continuing to reinvest heavily.",
      mature_stable: "A thin or negative spread argues for returning cash rather than reinvesting it.",
      decline: "Negative spreads are common; shrinking the business can create value.",
    },
    caveats: [
      "The hurdle here is the industry's average cost of capital, not the company's own — a company with more debt or a riskier business has a different one.",
      "One year of returns can be distorted by a write-down, a big acquisition or a cyclical peak.",
      "Expensed R&D and leases make returns look different from their economic level, in either direction.",
    ],
    lectures: [L.cf12, L.cf10, L.v8, L.cf2], higherIsBetter: true,
  },

  // ── Reinvestment
  {
    id: "free_cash_flow", pillar: "reinvestment", title: "Free cash flow", metricIds: ["fcf", "fcf_margin", "capex_intensity"], primary: "fcf_margin",
    question: "Why can a profitable company still run out of cash?",
    what: "Cash from operations minus spending on equipment and facilities (capex) — what's left after keeping and growing the asset base.",
    why: "Value comes from cash, not accounting earnings. A company with profits but negative free cash flow is reinvesting (or tying cash up in inventory and receivables); whether that's good depends on what the reinvestment earns.",
    industry: "Capital-heavy industries (chips manufacturing, energy, telecom) spend a lot on capex, so free cash flow trails earnings; software and services convert most earnings into cash.",
    stages: {
      startup: "Negative and funded by investors.",
      young_growth: "Negative is the normal cost of growing — what matters is how long the cash lasts.",
      high_growth: "Often still thin; turning positive is a milestone.",
      mature_growth: "Should be reliably positive.",
      mature_stable: "Strong and steady — the source of buybacks and dividends.",
      decline: "Often still positive as reinvestment shrinks — the question is what management does with it.",
    },
    caveats: ["This is the simple version (operating cash flow − capex). Damodaran's FCFF starts from after-tax operating income and subtracts all reinvestment — shown on the Reinvestment card.", "Operating cash flow adds back stock-based compensation; see the SBC card."],
    lectures: [L.v9, L.v3, L.cf11], higherIsBetter: true,
  },
  {
    id: "reinvestment", pillar: "reinvestment", title: "Reinvestment", metricIds: ["reinvestment", "reinvestment_rate", "fcff"], primary: "reinvestment_rate",
    question: "Where does growth come from, and who pays for it?",
    what: "What the company puts back into the business: capex beyond depreciation, extra working capital, and acquisitions. The reinvestment rate is that amount as a share of after-tax operating income.",
    why: "Damodaran's link between growth and value: sustainable growth ≈ reinvestment rate × return on capital. A company that grows without reinvesting is either very efficient or living off past investment; one that reinvests heavily must earn good returns on it.",
    industry: "Asset-light industries reinvest little per dollar of growth; manufacturing, energy and telecom need a lot.",
    stages: {
      young_growth: "Reinvestment exceeds earnings — the rate is not meaningful while operating income is negative.",
      high_growth: "High (often above 50%).",
      mature_growth: "Moderate.",
      mature_stable: "Low — most earnings can be paid out.",
      decline: "Near zero or negative (selling assets).",
    },
    caveats: ["Acquisitions are lumpy — one deal can swing a single year.", "FCFF here does not add back stock-based compensation, following Damodaran."],
    lectures: [L.v9, L.v10], higherIsBetter: null,
  },
  {
    id: "sales_to_capital", pillar: "reinvestment", title: "Sales to capital", metricIds: ["sales_to_capital"], primary: "sales_to_capital",
    question: "How much does it cost this company to add a dollar of revenue?",
    what: "Revenue per dollar of capital invested in the business.",
    why: "In Damodaran's story-to-numbers approach this ratio sets how much reinvestment a growth forecast needs: a high ratio means growth is cheap; a low one means every dollar of new revenue requires heavy investment.",
    industry: "Retailers and distributors turn capital over quickly (high ratio); utilities and telecom need lots of capital per dollar of sales (low ratio).",
    stages: { high_growth: "The ratio decides how much cash growth will burn.", mature_stable: "Stable — changes usually come from acquisitions or write-downs." },
    caveats: ["Damodaran publishes this ratio by industry without a written formula; revenue ÷ invested capital is the app's reading.", "For forecasts he uses the marginal version — new revenue ÷ new capital — which can differ a lot from the average."],
    lectures: [L.v13, L.v11], higherIsBetter: true,
  },
  {
    id: "sbc", pillar: "reinvestment", title: "Stock-based compensation", metricIds: ["sbc_intensity", "fcf_after_sbc"], primary: "sbc_intensity",
    question: "If a company pays employees in shares instead of cash, is that free?",
    what: "Pay given to employees in shares and options, as a share of revenue.",
    why: "Damodaran is firm that this is a real expense — paying in shares instead of cash still transfers value from existing shareholders. Adding it back to make 'adjusted' earnings or cash flow look better overstates what the business generates.",
    industry: "Heaviest in software and internet companies; small in industrial and consumer businesses.",
    stages: { young_growth: "Often very high — shares are the currency start-ups can afford.", mature_stable: "Should be small; persistent heavy SBC in a mature firm is a cost hidden in plain sight." },
    caveats: ["Buybacks that only offset SBC dilution aren't really returning cash."],
    lectures: [L.v13], higherIsBetter: false,
  },
  {
    id: "cash_runway", pillar: "reinvestment", title: "Cash runway", metricIds: ["cash_runway"], primary: "cash_runway",
    question: "What happens when a cash-burning company's runway gets short?",
    what: "How many years the current cash pile lasts at the current rate of cash burn.",
    why: "For young companies the risk of failure is a real input in valuation. A short runway means new shares or debt soon — on whatever terms the market offers then.",
    industry: "",
    stages: { startup: "The most important survival number.", young_growth: "Under ~2 years usually means a capital raise is coming.", mature_stable: "Not relevant — the company funds itself." },
    caveats: ["Burn can change quickly as growth spending is cut or ramped up."],
    lectures: [L.v15, L.v16], higherIsBetter: true,
  },

  // ── Risk
  {
    id: "interest_coverage", pillar: "risk", title: "Interest coverage", metricIds: ["interest_coverage", "synthetic_rating"], primary: "interest_coverage",
    question: "How much could profits fall before interest payments become a problem?",
    what: "How many times operating income covers the year's interest expense.",
    why: "Damodaran uses coverage to estimate a 'synthetic' credit rating, and from it the company's cost of borrowing. Low coverage means a higher cost of debt and less room for bad years.",
    industry: "Stable businesses (utilities) can live with lower coverage than cyclical ones (chips, autos), whose profits can fall fast.",
    stages: { young_growth: "Usually little debt; if there is debt with losses, that's a serious risk.", mature_stable: "Mature companies carry more debt by design — coverage tells you if it's too much.", decline: "Falling coverage in a shrinking business is the classic distress path." },
    caveats: ["The rating table is Damodaran's January 2026 table for large non-financial firms; smaller, riskier firms use stricter bands.", "Lease costs aren't counted as interest here."],
    lectures: [L.v8, L.cf10], higherIsBetter: true,
  },
  {
    id: "debt_load", pillar: "risk", title: "Debt load", metricIds: ["debt_to_capital", "debt_to_ebitda", "net_debt"], primary: "debt_to_capital",
    question: "Is debt good or bad for a company?",
    what: "How much of the company is financed with debt (at market value), and how many years of operating cash profit (EBITDA) the debt equals.",
    why: "Debt brings a tax benefit and discipline, but adds the risk of distress. Damodaran's financing principle: choose the mix that minimizes the cost of capital — which depends on how stable the cash flows are.",
    industry: "Utilities, telecom and real estate carry lots of debt because their cash flows are steady; young tech firms carry little.",
    stages: { startup: "Little or none — lenders want cash flows.", mature_growth: "Debt capacity grows as cash flows stabilize.", mature_stable: "Peak debt capacity.", decline: "Paying debt down is the healthy path." },
    caveats: ["Damodaran counts operating leases as debt; the app shows them separately.", "Net debt below zero means more cash than debt."],
    lectures: [L.cf16, L.cf17, L.cf19], higherIsBetter: null,
  },
  {
    id: "liquidity", pillar: "risk", title: "Liquidity", metricIds: ["current_ratio", "lease_debt"], primary: "current_ratio",
    question: "Can a company with plenty of assets still struggle to pay its bills?",
    what: "Current assets (cash, receivables, inventory) compared with bills due within a year.",
    why: "A short-term safety check: below 1 means near-term obligations exceed liquid assets.",
    industry: "Retailers and restaurants often run below 1 by design (customers pay before suppliers are paid); manufacturers usually run above it.",
    stages: {},
    caveats: ["Inventory and receivables aren't cash — a high ratio built on slow-moving inventory is weaker than it looks."],
    lectures: [L.v12, L.cf16], higherIsBetter: null,
  },

  // ── Cash return
  {
    id: "dilution", pillar: "cash_return", title: "Share count", metricIds: ["share_change"], primary: "share_change",
    question: "If profits grow 20% but the share count grows 10%, how much did each share's profit grow?",
    what: "How much the diluted number of shares changed in a year.",
    why: "New shares split the company into more pieces — each existing share owns less. Falling share counts (buybacks) do the opposite.",
    industry: "",
    stages: { young_growth: "Rising share counts are common (funding and stock pay).", mature_stable: "Usually falling as the company buys back stock." },
    caveats: ["Convertible debt and options can add shares later."],
    lectures: [L.v13, L.cf21], higherIsBetter: false,
  },
  {
    id: "cash_return", pillar: "cash_return", title: "Cash returned", metricIds: ["cash_return", "cash_return_vs_fcf"], primary: "cash_return_vs_fcf",
    question: "When should a company pay out cash instead of reinvesting it?",
    what: "Buybacks plus dividends over the last year, and that amount compared with free cash flow.",
    why: "Damodaran's dividend principle: return cash when there aren't enough investments that earn more than the cost of capital. Paying out more than the company generates is borrowing to return cash; paying out nothing while sitting on cash raises the question of what management will do with it.",
    industry: "Mature consumer, energy and financial companies return the most; growing tech firms return little.",
    stages: { young_growth: "Little or none — and that's right.", mature_growth: "Starting to return cash.", mature_stable: "Returning most free cash flow is normal.", decline: "Returning cash — even more than earnings, from selling assets — can be the value-maximizing path." },
    caveats: ["Buybacks that just offset stock-based compensation aren't a true return.", "Over 100% of free cash flow is financed by debt or cash on hand."],
    lectures: [L.cf21, L.cf22, L.cf24], higherIsBetter: null,
  },

  // ── Pricing
  {
    id: "pricing", pillar: "pricing", title: "What the market pays", metricIds: ["ps", "pe", "ev_ebit"], primary: "ps",
    question: "Is a company with a P/E of 60 always expensive?",
    what: "How many dollars the market pays for a dollar of revenue, of earnings, and of operating income (counting debt and cash).",
    why: "Multiples are pricing, not valuation — they show what the market is betting on. A high multiple needs high growth, high returns on capital and low risk to be justified; Damodaran's test is to check those fundamentals before calling a multiple high or low.",
    industry: "Multiples are only comparable within an industry and after controlling for growth and risk.",
    stages: { young_growth: "Revenue multiples, since there are no earnings.", mature_growth: "Earnings multiples take over.", decline: "Book value matters more than earnings." },
    caveats: ["The app's peer comparison uses the data provider's multiples for consistency."],
    lectures: [L.v17, L.v19, L.cf2], higherIsBetter: null,
  },
];

export const CONCEPT_BY_ID = new Map(CONCEPTS.map((c) => [c.id, c]));

export function lectureUrl(l: Lecture): string {
  return l.videoId ? `https://www.youtube.com/watch?v=${l.videoId}` : l.playlist ?? PLAYLISTS.valuation;
}
