import { describe, expect, it } from "vitest";
import { GLOSSARY, GLOSSARY_EN, buildMatcher } from "./glossary";
import { GLOSSARY_HE } from "./he/glossary";
import { GLOSSARY_GROUPS, RELATED } from "./glossaryMeta";

const HE = buildMatcher(GLOSSARY_HE, true);
const ids = (list: { id: string }[]) => list.map((e) => e.id);

/** Every term the matcher links in a piece of text, in order. */
function linked(text: string, m = GLOSSARY_EN): string[] {
  const re = new RegExp(m.re.source, m.re.flags), out: string[] = [];
  for (let x = re.exec(text); x; x = re.exec(text)) { const e = m.entryFor(x[2]); if (e) out.push(e.id); }
  return out;
}

describe("glossary integrity", () => {
  it("has unique ids and the same terms in English and Hebrew", () => {
    expect(new Set(ids(GLOSSARY)).size).toBe(GLOSSARY.length);
    expect(new Set(ids(GLOSSARY_HE)).size).toBe(GLOSSARY_HE.length);
    expect([...ids(GLOSSARY_HE)].sort()).toEqual([...ids(GLOSSARY)].sort());
  });

  it("puts every term in exactly one group", () => {
    const grouped = GLOSSARY_GROUPS.flatMap((g) => g.ids);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...ids(GLOSSARY)].sort());
  });

  it("links related terms that exist, never to themselves", () => {
    const known = new Set(ids(GLOSSARY));
    for (const [id, rel] of Object.entries(RELATED)) {
      expect(known.has(id), id).toBe(true);
      for (const r of rel) { expect(known.has(r), `${id} → ${r}`).toBe(true); expect(r).not.toBe(id); }
    }
  });

  it("gives every term a definition and the same extra notes in both languages", () => {
    const he = new Map(GLOSSARY_HE.map((e) => [e.id, e]));
    for (const e of GLOSSARY) {
      const h = he.get(e.id)!;
      expect(e.def && h.def, e.id).toBeTruthy();
      expect(!!h.read, `read: ${e.id}`).toBe(!!e.read);
      expect(!!h.formula, `formula: ${e.id}`).toBe(!!e.formula);
    }
  });
});

describe("labels in the Fundamentals views open the right entry", () => {
  it.each([
    ["QoQ sales", "qoq"], ["YoY sales", "yoy"], ["Same quarter last year", "yoy"],
    ["Reported diluted EPS · YoY", "eps"], ["Cost of revenue", "cost_of_revenue"], ["Operating expenses (derived)", "opex"],
    ["Income tax expense / benefit", "income_tax"], ["Reported interest expense", "interest_expense"],
    ["Current deferred revenue change", "deferred_revenue"], ["Trade receivables change", "receivables"],
    ["Ending cash balance", "cash_balance"], ["Investing cash flow", "investing_cf"], ["Financing cash flow", "financing_cf"],
    ["Operating cash flow", "ocf"], ["Equipment and property spending", "capex"], ["P/B", "pb"], ["P/E", "pe"],
    ["Market cap", "market_cap"], ["Share price", "share_price"], ["Per $100 of sales", "per100"],
    ["Operating profit", "operating_income"], ["Net profit / loss", "net_income"], ["Loss narrowed", "loss_change"],
    ["Operating profit per $1 of interest", "interest_coverage"], ["Tax & other, net", "other_income"], ["Non-interest expenses", "noninterest_expense"], ["Credit-loss provisions", "provision"], ["Pre-provision profit", "ppnr"], ["Fees and other non-interest income", "noninterest_income"], ["Net interest income", "net_interest_income"], ["Profit before tax", "pretax"], ["Average diluted shares · YoY", "share_count"],
  ])("EN %s → %s", (label, id) => {
    expect(linked(label)[0]).toBe(id);
  });

  it.each([
    ["הכנסות מול הרבעון הקודם", "qoq"], ["הכנסות מול השנה הקודמת", "yoy"], ["לעומת אשתקד", "yoy"],
    ["רווח מדולל מדווח למניה", "eps"], ["עלות ההכנסות", "cost_of_revenue"], ["הוצאות תפעול, מחושב", "opex"],
    ["הוצאת מס / הטבת מס", "income_tax"], ["הוצאת ריבית מדווחת", "interest_expense"],
    ["שינוי בהכנסות נדחות שוטפות", "deferred_revenue"], ["שינוי ביתרות לקוחות", "receivables"],
    ["יתרת מזומנים בסוף הרבעון", "cash_balance"], ["תזרים מהשקעה", "investing_cf"], ["תזרים ממימון", "financing_cf"],
    ["תזרים מפעילות", "ocf"], ["מכפיל הון", "pb"], ["מכפיל רווח", "pe"], ["שווי שוק", "market_cap"],
    ["מחיר למניה", "share_price"], ["לכל $100 מכירות", "per100"], ["רווח תפעולי", "operating_income"],
    ["רווח / הפסד נקי", "net_income"], ["ההפסד הצטמצם", "loss_change"], ["מס ואחרות, נטו", "other_income"], ["הוצאות שאינן ריבית", "noninterest_expense"], ["הפרשות להפסדי אשראי", "provision"], ["רווח לפני הפרשות", "ppnr"], ["הכנסות ריבית נטו", "net_interest_income"], ["רווח לפני מס", "pretax"], ["והרווח התפעולי", "operating_income"],
    ["ההון העצמי", "equity"], ["שיעור הרווח התפעולי", "operating_margin"], ["יתרת המזומנים", "cash_balance"],
    ["מול שווי השוק", "market_cap"], ["בהוצאות התפעול", "opex"], ["הרווח הנקי", "net_income"], ["התשואה על ההון העצמי", "roe"],
  ])("HE %s → %s", (label, id) => {
    expect(linked(label, HE)[0]).toBe(id);
  });

  it("does not link 'previous quarter' inside a sentence about YoY growth to QoQ", () => {
    expect(linked("Year-over-year sales growth moved from +85.2% in the previous quarter to +105.9% now")).not.toContain("qoq");
  });

  it("links the main terms in a company-story paragraph", () => {
    const p = "Cash is the next check: 12.0% of sales remained as free cash flow after capital spending over the last twelve months.";
    expect(linked(p)).toEqual(expect.arrayContaining(["fcf", "capex", "ttm"]));
  });
});
