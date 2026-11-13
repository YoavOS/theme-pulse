// Damodaran's ideas as questions to ask of any company — in the app's own words, each linked to where he
// says it. Sources were checked in the Nov 2026 research (see reports/Proven strong companies Damodaran.md).

export interface Source { title: string; date: string; url: string; note?: string }
export interface Principle {
  id: string; question: string; idea: string; seeIt: string; trap: string; sources: Source[];
}

const PARADOX: Source = { title: "Explaining a Paradox: Why Good (Bad) Companies can be Bad (Good) Investments", date: "Mar 2017", url: "https://aswathdamodaran.blogspot.com/2017/03/explaining-paradox-why-good-bad.html" };
const DATA6: Source = { title: "Data Update 6 for 2026: In Search of Profitability", date: "Feb 2026", url: "https://aswathdamodaran.substack.com/p/data-update-6-for-2026-in-search" };
const MYTH53: Source = { title: "Myth 5.3: Growth is good, more growth is better", date: "Nov 2016", url: "https://aswathdamodaran.substack.com/p/myth-53-growth-is-good-more-growth-16-11-30" };
const CLC: Source = { title: "The Corporate Life Cycle (short deck)", date: "2024", url: "https://pages.stern.nyu.edu/~adamodar/pdfiles/country/CorpLifeCycleReallyShort2024.pdf" };
const TRILLION: Source = { title: "Trillion Dollar Market Caps: Fairy Tale Pricing or Business Marvels?", date: "Dec 2025", url: "https://aswathdamodaran.substack.com/p/trillion-dollar-market-caps-fairy" };
const AI_SCEN: Source = { title: "The AI Disruption: From Doomsday Destruction to Do-Nothing Bots", date: "Mar 2026", url: "https://aswathdamodaran.substack.com/p/the-ai-disruption-from-doomsday-destruction" };
const DATA8: Source = { title: "Data Update 8 for 2026: Dividends and Buybacks", date: "Feb 2026", url: "https://aswathdamodaran.substack.com/p/data-update-8-for-2026-dividends" };
const ACQ: Source = { title: "Damodaran on acquisitions: just say no (CFA Institute write-up of his talk)", date: "Feb 2019", url: "https://rpc.cfainstitute.org/blogs/enterprising-investor/2019/aswath-damodaran-on-acquisitions-just-say-no", note: "second-hand summary" };
const SAP: Source = { title: "Valuation class, session 8 (R&D and lease adjustments, SAP example)", date: "Spring 2021", url: "https://pages.stern.nyu.edu/~adamodar/podcasts/valspr21/session8slides.pdf" };

export const PRINCIPLES: Principle[] = [
  { id: "value_price", question: "Am I judging the business — or just reading its price?",
    idea: "Value comes from cash flows, growth and risk; price comes from trading, mood and momentum. The two can sit far apart for a long time, and every opportunity is a gap between them. Know which game you're playing.",
    seeIt: "Lens → “What the price is betting on” turns the price into the story it needs.",
    trap: "Treating a rising price as proof the business is getting better (or a falling one as proof it's worse).",
    sources: [PARADOX] },
  { id: "excess_return", question: "Does it earn more on its capital than that capital costs?",
    idea: "His definition of a good business: return on capital above the cost of capital — not growth, not profit margins on their own. It's a high bar: in his January 2026 data only about 28% of ~48,000 companies worldwide cleared it, and 17% by five points or more.",
    seeIt: "Lens → Track record (the bars above or below the cost-of-capital line) and “Returns vs the cost of capital”.",
    trap: "Calling a company good because it's profitable or growing fast — both can destroy value.",
    sources: [DATA6, PARADOX] },
  { id: "moat_fade", question: "What stops competitors from taking that excess return away — and for how long?",
    idea: "Excess returns attract competition, so they fade. A moat — brand, network, scale, switching costs — slows the fade; he lets durable advantages keep a positive spread rather than assuming it goes to zero. He also sees moats eroding over decades while winner-take-all markets grow.",
    seeIt: "Track record trend (“returns easing / falling”) and the “Proven but fading” label.",
    trap: "Assuming today's high return is permanent — or that every high return must collapse.",
    sources: [MYTH53, DATA6] },
  { id: "growth_value", question: "Does growth add value here, or just size?",
    idea: "Growth has to be paid for with reinvestment, and sustainable growth is reinvestment × return on capital. If the return is above the cost of capital, growth adds value; equal, it adds nothing; below, more growth makes the company worth less.",
    seeIt: "Growth lab below; Lens → Reinvestment, sales-to-capital and “new capital earns …” in the stage check.",
    trap: "Rewarding any growth, whatever it costs to buy.",
    sources: [MYTH53] },
  { id: "life_cycle", question: "Which stage of life is it in — and what should matter at this stage?",
    idea: "Companies age through six stages, from start-up to decline. What to look at changes with age: product economics early, scaling and operating margin in growth, returns and cash in maturity. Valuation shifts from mostly story when young to mostly numbers when old.",
    seeIt: "Lens → Life-cycle stage card and “What matters most for a … company”.",
    trap: "Judging a young company by a mature company's yardstick — or the other way round.",
    sources: [CLC] },
  { id: "act_age", question: "Is it acting its age?",
    idea: "Each stage has a right way to use capital and a typical way to fail: young firms that borrow or pay dividends too early, growth firms reinvesting below their cost of capital, mature-growth firms hoarding cash, stable firms buying growth with acquisitions, declining firms betting on a comeback. Growing old is inevitable; growing up is optional.",
    seeIt: "Track record → “How it was judged” → the Acting-its-age line.",
    trap: "Seeing dividends as a sign of quality, or cash burn as a sign of failure, without asking the company's age.",
    sources: [CLC] },
  { id: "narrative", question: "What story does the price need — and does every number trace back to it?",
    idea: "A valuation is a story told in numbers. Every input — growth, margin, reinvestment, risk — should come from the story, and every story should be checked against numbers. Change the story, and the value changes with it.",
    seeIt: "Lens → “What the price is betting on”: your margin and capital story, and the growth the price then needs.",
    trap: "Running numbers with no story behind them, or telling a story with no numbers that could prove it wrong.",
    sources: [TRILLION] },
  { id: "three_p", question: "Is the story possible, plausible — and probable?",
    idea: "Possible: could it happen at all (is the market even that big)? Plausible: do the economics work at that scale — margins, capital needs? Probable: is it likely to be delivered, given competition and management? Many stories pass the first test and fail the last.",
    seeIt: "Lens → “What the price is betting on” → Test the story.",
    trap: "Treating “possible” as if it were “probable”.",
    sources: [TRILLION, AI_SCEN] },
  { id: "big_market", question: "If every company in this hot market is priced to win, can the market hold all the winners?",
    idea: "The big market delusion: each company's story can pass on its own while the stories together need more revenue than the market will ever have. His 2025 example was AI language-model companies priced at $1.5 trillion+ on under $100 billion of combined revenue.",
    seeIt: "Leading themes and industries — add up what the leaders' prices need before chasing all of them.",
    trap: "Judging each name alone when the whole group is betting on the same pie.",
    sources: [TRILLION] },
  { id: "good_vs_investment", question: "Is it a good company — or a good investment at this price?",
    idea: "Business quality, management and price are separate questions. A great business priced for perfection is “admire, but don't buy”; a weak one can be a good investment if it's cheap enough. He'd rather own a weaker business at the right price than a great one at the wrong price.",
    seeIt: "Lens → “What the price is betting on” → the business × price matrix.",
    trap: "Assuming a great company is a great stock — the market usually knows it's great.",
    sources: [PARADOX] },
  { id: "capital_allocation", question: "What does it do with the cash it can't reinvest well?",
    idea: "Cash returned should match what the company can afford (its free cash flow to equity) and its age. Buybacks at a fair price neither create nor destroy value. Acquisitions are, on the evidence he cites, the most reliable way companies destroy value.",
    seeIt: "Lens → Cash return & dilution; Track record → acting its age; the “Grows by acquisition” tag.",
    trap: "Cheering every buyback or dividend; believing announced deal synergies.",
    sources: [DATA8, ACQ] },
  { id: "accounting", question: "Do the accounting numbers show the real economics?",
    idea: "Accounting expenses R&D that is really investment and (until recently) hid leases that are really debt. He moves both into capital before judging returns — and treats stock-based pay as a real cost, not something to add back.",
    seeIt: "Lens → “Adjusted for R&D and leases”; Track record uses the R&D-adjusted return where R&D is material.",
    trap: "Taking reported return on capital at face value for R&D-heavy or lease-heavy companies.",
    sources: [SAP] },
];

/** His dated views on specific companies — verdicts change with price; each is a snapshot. */
export interface Take { tickers: string[]; date: string; text: string; source: Source }
export const TAKES: Take[] = [
  { tickers: ["NVDA"], date: "Dec 2025", source: TRILLION,
    text: "A business marvel by its results, but he expected its very high margins and returns to fall as competition and big customers push back. The story behind the price looked possible and plausible to him; probable was the hard part." },
  { tickers: ["TSLA"], date: "Dec 2025", source: TRILLION,
    text: "With manufacturing economics and thin net margins, the price needed revenue growth near the limit of what's possible." },
  { tickers: ["BRK-B", "BRK.B"], date: "Dec 2025", source: TRILLION,
    text: "Like Aramco, a company whose current revenue already roughly supports its price — it needs little growth to justify it." },
  { tickers: ["AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "NVDA", "TSLA"], date: "Feb 2024", source: { title: "The Seven Samurai: The Stocks that Saved the Market", date: "Feb 2024", url: "https://pages.stern.nyu.edu/~adamodar/pdfiles/blog/MagSeven.pdf" },
    text: "Excellent businesses — pricing power, strong profits, little debt, winner-take-all economics — but with prices that already reflected much of that quality; Nvidia looked the most stretched. His advice to those who didn't own them was to be patient." },
];
