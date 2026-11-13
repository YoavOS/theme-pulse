import { useState } from "react";
import { Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { STAGE_COLORS, type StockStage } from "@/lib/stageAnalysis";
import { tvSectionsText } from "@/lib/tvSections";
import { tint } from "@/lib/colorTint";

/**
 * TradingView export for the Stages tab: each stage's stocks (S1–S4) as one list, or all four at once.
 * Formats: one ticker per line, sections by the current group mode (best groups first), or — for
 * "All stages" — one section per stage. Tickers are ordered by RS inside every list / section.
 */

type Fmt = "lines" | "groups";
const FMT_KEY = "stage_export_fmt_v1";
const STAGE_LABEL: Record<1 | 2 | 3 | 4, string> = { 1: "Stage 1 — Basing", 2: "Stage 2 — Advancing", 3: "Stage 3 — Topping", 4: "Stage 4 — Declining" };

export default function StageExportBar({ rows, rsOf, groupOf, groupLabel, scopeLabel }: {
  rows: StockStage[];
  rsOf: (s: string) => number | null;
  groupOf: (s: string) => string;
  groupLabel: string;
  scopeLabel: string;
}) {
  const [fmt, setFmt] = useState<Fmt>(() => { try { return localStorage.getItem(FMT_KEY) === "groups" ? "groups" : "lines"; } catch { return "lines"; } });
  const pick = (f: Fmt) => { setFmt(f); try { localStorage.setItem(FMT_KEY, f); } catch { /* ignore */ } };

  const byRs = (list: StockStage[]) => [...list].sort((a, b) => (rsOf(b.symbol) ?? -1) - (rsOf(a.symbol) ?? -1));
  const of = (k: 1 | 2 | 3 | 4) => byRs(rows.filter((r) => r.stage === k));

  const textFor = (k: 1 | 2 | 3 | 4 | "all", sep: string) => {
    if (k === "all") {
      // One TradingView section per stage (Stage 2 first — that's where setups come from).
      return ([2, 1, 3, 4] as const)
        .map((s) => ({ s, list: of(s) }))
        .filter((x) => x.list.length)
        .map((x) => `###${STAGE_LABEL[x.s]}\n${x.list.map((r) => r.symbol).join("\n")}`)
        .join("\n");
    }
    const list = of(k);
    return fmt === "groups"
      ? tvSectionsText(list.map((r) => ({ symbol: r.symbol, group: groupOf(r.symbol), score: rsOf(r.symbol) })))
      : list.map((r) => r.symbol).join(sep);
  };
  const count = (k: 1 | 2 | 3 | 4 | "all") => (k === "all" ? rows.filter((r) => r.stage >= 1).length : of(k).length);
  const name = (k: 1 | 2 | 3 | 4 | "all") => (k === "all" ? "all stages" : `Stage ${k}`);

  const download = (k: 1 | 2 | 3 | 4 | "all") => {
    const n = count(k);
    if (!n) return;
    const blob = new Blob([textFor(k, "\n") + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stage-${k === "all" ? "all-by-stage" : `${k}${fmt === "groups" ? `-by-${groupLabel.toLowerCase().replace(/\W+/g, "-")}` : ""}`}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${n} ${name(k)} stocks`, {
      description: k === "all" ? "One TradingView section per stage, strongest RS first." : fmt === "groups" ? `Sections by ${groupLabel.toLowerCase()}, best groups first — ready for TradingView import.` : "One ticker per line — ready for TradingView import.",
    });
  };
  const copy = (k: 1 | 2 | 3 | 4 | "all") => {
    const n = count(k);
    if (!n) return;
    navigator.clipboard.writeText(textFor(k, ",")).then(() => toast.success(`Copied ${n} ${name(k)} tickers`));
  };

  const Btn = ({ k }: { k: 1 | 2 | 3 | 4 | "all" }) => {
    const n = count(k), c = k === "all" ? "hsl(var(--primary))" : STAGE_COLORS[k];
    return (
      <span className="inline-flex overflow-hidden rounded-lg border text-[12px]"
        style={{ borderColor: k === "all" ? "hsl(var(--primary) / 0.5)" : tint(c, 0.5), background: k === "all" ? "hsl(var(--primary) / 0.08)" : tint(c, 0.08) }}>
        <button onClick={() => download(k)} disabled={!n} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 font-semibold transition hover:brightness-125 disabled:opacity-40"
          title={k === "all" ? `Download all ${n} classified stocks as one TradingView list with a section per stage` : `Download the ${n} Stage ${k} stocks of ${scopeLabel} as a TradingView .txt`}>
          <Download size={12} style={{ color: c }} />
          <span style={{ color: c }}>{k === "all" ? "All stages" : `S${k}`}</span>
          <span className="font-normal tabular-nums text-muted-foreground">{n.toLocaleString("en-US")}</span>
        </button>
        <button onClick={() => copy(k)} disabled={!n} aria-label={`Copy ${name(k)} tickers`} title={`Copy the ${n} tickers`}
          className="border-l px-2 text-muted-foreground transition hover:text-foreground disabled:opacity-40" style={{ borderColor: k === "all" ? "hsl(var(--primary) / 0.3)" : tint(c, 0.3) }}>
          <Copy size={12} />
        </button>
      </span>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-2.5">
      <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Export to TradingView</span>
      {([1, 2, 3, 4] as const).map((k) => <Btn key={k} k={k} />)}
      <Btn k="all" />
      <span className="ml-auto inline-flex rounded-md border border-border bg-muted/20 p-0.5 text-[11px]" title="How S1–S4 lists are laid out (All stages always has one section per stage)">
        {([["lines", "One per line"], ["groups", `Sections by ${groupLabel.toLowerCase()}`]] as [Fmt, string][]).map(([v, l]) => (
          <button key={v} onClick={() => pick(v)} className={`rounded px-2 py-1 font-medium transition ${fmt === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
        ))}
      </span>
    </div>
  );
}

