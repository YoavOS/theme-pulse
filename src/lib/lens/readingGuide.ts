// "How to read these numbers": what each measure says, how it can mislead, and what Damodaran pairs it with.
// Written in the app's own words, from his public teaching (links below each entry).

export interface GuideEntry { id: string; name: string; says: string; misleads: string[]; pairWith: string; link?: { title: string; url: string } }

export const READING_GUIDE: GuideEntry[] = [
  {
    id: "roic", name: "Return on capital vs cost of capital",
    says: "The core of Damodaran's test of a good business: every dollar invested in the business earns more than investors could expect elsewhere at the same risk. The gap (the spread) is the value created.",
    misleads: [
      "R&D and similar spending are booked as expenses, so the capital looks smaller and the return higher than it really is (the Lens corrects for R&D where it can).",
      "Acquisitions add goodwill to capital: the total return can look poor while the business itself earns a lot.",
      "One year proves little — returns swing with the cycle. Look at the 10-year record.",
      "A high return today says nothing about why it is high, or whether competitors will close the gap.",
    ],
    pairWith: "The 10-year track record and the fade odds — how often companies with a record like this kept it.",
    link: { title: "Damodaran — Meta, lesson 2: accounting inconsistencies (2022)", url: "https://aswathdamodaran.substack.com/p/facebook-meta-lesson-2-accounting" },
  },
  {
    id: "margin", name: "Operating margin",
    says: "How much of each dollar of revenue is left after running the business. One of the two routes to a high return.",
    misleads: [
      "Means very different things by industry — a 10% margin is excellent for a retailer and weak for software. Always read it against the industry.",
      "Heavy R&D or marketing that is really investment pushes it down today.",
      "A peak-of-cycle margin for a cyclical company is not the normal level.",
    ],
    pairWith: "Revenue to capital (the other route) and the industry's margin.",
  },
  {
    id: "turnover", name: "Revenue to capital",
    says: "How many dollars of revenue each dollar of capital produces — the other route to a high return (a low-margin business can still earn a lot by turning its capital fast).",
    misleads: [
      "Leases and acquisitions change the capital base, so compare like with like.",
      "For a young company, capital spent now pays off in later revenue — today's ratio understates it.",
    ],
    pairWith: "Operating margin: return on capital ≈ after-tax margin × revenue to capital.",
  },
  {
    id: "growth", name: "Revenue growth",
    says: "How fast the business is getting bigger.",
    misleads: [
      "Growth only creates value when the new capital earns more than it costs — growth at a return below the cost of capital destroys value.",
      "Acquired growth is not the same as growth the business earns itself.",
      "Past growth is a fact; future growth is a story. Big companies grow slower — the bigger it is, the harder.",
    ],
    pairWith: "Reinvestment and the return on new capital.",
  },
  {
    id: "reinvest", name: "Reinvestment",
    says: "How much of its profit the company puts back into the business. Growth has to be paid for: growth ≈ reinvestment rate × return on that reinvestment.",
    misleads: [
      "High reinvestment is good only at a good return. Low reinvestment with high growth claims should make you skeptical.",
    ],
    pairWith: "The return on new capital and the company's stage of life (young companies should reinvest; mature ones should return cash).",
  },
  {
    id: "fcf", name: "Free cash flow",
    says: "The cash left after running and reinvesting in the business — what could be paid out.",
    misleads: [
      "Negative free cash flow is normal for a young company investing well; positive cash flow can come from under-investing.",
      "Stock-based pay doesn't use cash, but it is a real cost: owners are diluted instead.",
    ],
    pairWith: "Stage of life and share-count change (dilution).",
  },
  {
    id: "debt", name: "Debt (net debt / EBITDA, interest coverage)",
    says: "How fragile the company is if things go wrong.",
    misleads: [
      "Leases are debt in disguise (the Lens counts them).",
      "For banks and insurers, debt is raw material — these measures don't apply.",
    ],
    pairWith: "How stable the earnings are: steady businesses can carry more debt.",
  },
  {
    id: "multiples", name: "P/E, EV/EBITDA and other multiples",
    says: "What the market pays for each dollar of earnings or revenue — a quick price check.",
    misleads: [
      "A low multiple is often low for a reason (risk, weak growth, poor returns); a high one may be justified by growth at high returns.",
      "Accounting differences (R&D, leases) make multiples hard to compare across industries.",
    ],
    pairWith: "The price story: what growth and margins the price needs, and whether that is possible, plausible and probable.",
    link: { title: "Damodaran — Screening for bargains (2012)", url: "https://aswathdamodaran.blogspot.com/2012/06/passive-value-investing-screening-for.html" },
  },
  {
    id: "story", name: "Numbers and story together",
    says: "Damodaran's view: numbers without a story become a spreadsheet fantasy; a story without numbers is a fairy tale. The numbers discipline the story, and the story explains the numbers.",
    misleads: [
      "Precise numbers can make uncertainty look smaller than it is.",
      "Numbers can be chosen to support a conclusion reached in advance.",
    ],
    pairWith: "The company's own account in its filings (the business, competition and risk sections), checked against the numbers.",
    link: { title: "Damodaran — Numbers and Narrative (2014)", url: "https://aswathdamodaran.substack.com/p/numbers-and-narrative-modeling-story-14-06-24" },
  },
];
