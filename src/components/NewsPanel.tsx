import { useState, useEffect, Component, ReactNode } from "react";
import { X, ExternalLink, Newspaper, Bot } from "lucide-react";
import { NewsArticle } from "@/hooks/useThemeNews";
import { Skeleton } from "@/components/ui/skeleton";

class NewsBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return <p className="text-xs text-muted-foreground p-4">News unavailable</p>;
    return this.props.children;
  }
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function NewsPanel({
  themeName,
  articles,
  onClose,
  aiSummary,
  isLoadingSummary,
}: {
  themeName: string;
  articles: NewsArticle[];
  onClose: () => void;
  aiSummary?: string | null;
  isLoadingSummary?: boolean;
}) {
  // Group articles by symbol
  const grouped: Record<string, NewsArticle[]> = {};
  for (const a of articles) {
    const key = a.symbol || "Market";
    if (!grouped[key]) grouped[key] = [];
    if (grouped[key].length < 5) grouped[key].push(a);
  }

  return (
    <NewsBoundary>
      <div
        className="fixed right-0 top-0 z-50 h-full w-[350px] border-l border-border bg-background shadow-2xl overflow-y-auto"
        style={{ animation: "slideInRight 200ms ease-out" }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 backdrop-blur-sm px-4 py-3">
          <div className="flex items-center gap-2">
            <Newspaper size={16} className="text-primary" />
            <h3 className="text-sm font-bold text-foreground">{themeName}</h3>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* AI Summary */}
        {(aiSummary || isLoadingSummary) && (
          <div className="mx-4 mt-3 rounded-lg p-3" style={{ background: "rgba(0, 245, 196, 0.06)", border: "1px solid rgba(0, 245, 196, 0.15)" }}>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="relative inline-block h-2 w-2 rounded-full bg-primary">
                <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-75" />
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">AI Summary</span>
            </div>
            {isLoadingSummary ? (
              <div className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-[90%]" />
                <Skeleton className="h-3 w-[75%]" />
              </div>
            ) : (
              <p className="text-xs text-foreground leading-relaxed">{aiSummary}</p>
            )}
          </div>
        )}

        {/* Articles */}
        <div className="p-4 space-y-4">
          {articles.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              No recent news for this theme's tickers
            </p>
          ) : (
            Object.entries(grouped).map(([sym, arts]) => (
              <div key={sym}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-foreground" style={{ fontFamily: "'DM Mono', monospace" }}>
                    {sym}
                  </span>
                </div>
                <div className="space-y-2">
                  {arts.map((a, i) => (
                    <a
                      key={i}
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group block rounded-md p-2 transition-colors hover:bg-accent/50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-medium text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                          {a.headline}
                        </p>
                        <ExternalLink size={10} className="shrink-0 mt-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                        {a.source && <span>{a.source}</span>}
                        {a.published_at && <span>· {timeAgo(a.published_at)}</span>}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </NewsBoundary>
  );
}

export function NewsTabContent({
  articles,
  aiSummary,
  isLoadingSummary,
}: {
  articles: NewsArticle[];
  aiSummary?: string | null;
  isLoadingSummary?: boolean;
}) {
  return (
    <NewsBoundary>
      <div className="space-y-3">
        {/* AI Summary */}
        {(aiSummary || isLoadingSummary) && (
          <div className="rounded-lg p-3" style={{ background: "rgba(0, 245, 196, 0.06)", border: "1px solid rgba(0, 245, 196, 0.15)" }}>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="relative inline-block h-2 w-2 rounded-full bg-primary">
                <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-75" />
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">AI Summary</span>
            </div>
            {isLoadingSummary ? (
              <div className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-[90%]" />
              </div>
            ) : (
              <p className="text-xs text-foreground leading-relaxed">{aiSummary}</p>
            )}
          </div>
        )}

        {articles.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            No recent news for this theme's tickers
          </p>
        ) : (
          <div className="space-y-1.5 max-h-[350px] overflow-y-auto">
            {articles.slice(0, 20).map((a, i) => (
              <a
                key={i}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-start gap-2 rounded-md p-2 transition-colors hover:bg-accent/50"
              >
                {a.symbol && (
                  <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[9px] font-bold text-foreground mt-0.5" style={{ fontFamily: "'DM Mono', monospace" }}>
                    {a.symbol}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                    {a.headline}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                    {a.source && <span>{a.source}</span>}
                    {a.published_at && <span>· {timeAgo(a.published_at)}</span>}
                  </div>
                </div>
                <ExternalLink size={10} className="shrink-0 mt-1 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </a>
            ))}
          </div>
        )}
      </div>
    </NewsBoundary>
  );
}

function timeAgo2(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
