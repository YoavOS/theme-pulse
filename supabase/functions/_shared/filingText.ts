// Reading SEC filings as text: HTML → plain text, the main 10-K sections, and risk-factor headings
// (to see which risks are new or gone since last year). Pure functions, testable without the network.

const ENT: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", bull: "•", hellip: "…", reg: "®", trade: "™", copy: "©" };

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")             // inline-XBRL hidden facts
    .replace(/<div[^>]*display:\s*none[\s\S]*?<\/div>/gi, " ")
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6]|\/table)[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " \t ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The 10-K's Item 1 (Business), 1A (Risk factors) and 7 (Management's discussion). The table of contents
 * lists the same headings, so for each item the occurrence followed by the most text before the next item wins.
 */
export function tenKSections(text: string): { business: string; risks: string; mdna: string } {
  const heads: { key: string; re: RegExp }[] = [
    { key: "1", re: /\n\s*item\s*1\s*[.:—–-]?\s*business\b/gi },
    { key: "1a", re: /\n\s*item\s*1a\s*[.:—–-]?\s*risk\s+factors\b/gi },
    { key: "1b", re: /\n\s*item\s*1b\s*[.:—–-]?\s*unresolved/gi },
    { key: "1c", re: /\n\s*item\s*1c\s*[.:—–-]?\s*cybersecurity/gi },
    { key: "2", re: /\n\s*item\s*2\s*[.:—–-]?\s*properties\b/gi },
    { key: "7", re: /\n\s*item\s*7\s*[.:—–-]?\s*management['’]?s\s+discussion/gi },
    { key: "7a", re: /\n\s*item\s*7a\s*[.:—–-]?\s*quantitative/gi },
    { key: "8", re: /\n\s*item\s*8\s*[.:—–-]?\s*financial\s+statements/gi },
  ];
  const hits: { key: string; at: number }[] = [];
  for (const h of heads) for (const m of text.matchAll(h.re)) hits.push({ key: h.key, at: m.index ?? 0 });
  hits.sort((a, b) => a.at - b.at);
  const section = (key: string, ends: string[]) => {
    let best = "";
    for (const h of hits.filter((x) => x.key === key)) {
      // ends at the next item heading of any kind (in the table of contents that's the very next line)
      const next = hits.find((x) => x.at > h.at && x.key !== key) ?? hits.find((x) => x.at > h.at && ends.includes(x.key));
      const body = text.slice(h.at, next ? next.at : Math.min(text.length, h.at + 400_000)).trim();
      if (body.length > best.length) best = body;
    }
    return best;
  };
  return {
    business: section("1", ["1a", "1b", "1c", "2"]),
    risks: section("1a", ["1b", "1c", "2"]),
    mdna: section("7", ["7a", "8"]),
  };
}

/** Risk-factor headings: short standalone paragraphs that read like a sentence-long title. */
export function riskHeadings(risks: string): string[] {
  const out: string[] = [];
  for (const p of risks.split(/\n+/).map((x) => x.trim())) {
    if (p.length < 40 || p.length > 400) continue;
    if (!/^[A-Z“"(]/.test(p)) continue;
    if (/^item\s*1a/i.test(p)) continue;
    const words = p.split(/\s+/).length;
    // headings are one sentence; body paragraphs are longer and have several sentences
    if (words > 70 || (p.match(/[.;]\s+[A-Z]/g) ?? []).length > 1) continue;
    if (!/\b(may|could|might|would|risk|risks|depend|subject|adversely|harm|affect|fail|unable|exposed|uncertain)\b/i.test(p)) continue;
    out.push(p.replace(/\s+/g, " "));
  }
  return [...new Set(out)];
}

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
function similar(a: string, b: string): number {
  const A = words(a), B = words(b);
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.max(1, Math.min(A.size, B.size));
}

/** Which risk headings are new this year and which were dropped (fuzzy match: rewording isn't "new"). */
export function diffRisks(now: string[], before: string[]): { added: string[]; removed: string[] } {
  const added = now.filter((h) => !before.some((b) => similar(h, b) >= 0.6));
  const removed = before.filter((b) => !now.some((h) => similar(h, b) >= 0.6));
  return { added, removed };
}

/** Trim a long section to its first `n` characters at a paragraph break. */
export function clipText(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.lastIndexOf("\n", n);
  return s.slice(0, cut > n * 0.6 ? cut : n) + "\n…";
}
