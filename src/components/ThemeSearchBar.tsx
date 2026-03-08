import { useRef, useState, useEffect } from "react";
import { Search, X, Sparkles } from "lucide-react";

interface ThemeSearchBarProps {
  query: string;
  setQuery: (q: string) => void;
  isSearching: boolean;
  clearSearch: () => void;
  runSearch: (q: string) => void;
  history: string[];
}

export default function ThemeSearchBar({
  query,
  setQuery,
  isSearching,
  clearSearch,
  runSearch,
  history,
}: ThemeSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [showHistory, setShowHistory] = useState(false);

  // "/" keyboard shortcut to focus
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === inputRef.current) {
        if (query) {
          clearSearch();
        } else {
          inputRef.current?.blur();
        }
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [query, clearSearch]);

  return (
    <div className="relative mx-auto w-full max-w-[400px]">
      <div
        className={`flex items-center rounded-md border bg-secondary/30 px-3 transition-all ${
          isSearching
            ? "border-primary/60 shadow-[0_0_8px_hsl(var(--primary)/0.15)]"
            : "border-border focus-within:border-primary/40"
        }`}
      >
        <Search size={14} className="shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => !query && history.length > 0 && setShowHistory(true)}
          onBlur={() => setTimeout(() => setShowHistory(false), 200)}
          placeholder="Search themes... try 'strong breadth and high volume'"
          className="h-8 flex-1 bg-transparent px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <button onClick={clearSearch} className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground">
            <X size={14} />
          </button>
        )}
        <span className="ml-1 inline-flex shrink-0 items-center gap-0.5 rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">
          <Sparkles size={9} />
          AI
        </span>
      </div>

      {/* Pulsing border animation while searching */}
      {isSearching && (
        <div className="pointer-events-none absolute inset-0 rounded-md border border-primary/40 animate-pulse" />
      )}

      {/* Search history dropdown */}
      {showHistory && !query && history.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-border bg-card p-1 shadow-xl">
          <p className="px-2 py-1 text-[10px] font-medium text-muted-foreground">Recent searches</p>
          {history.map((h, i) => (
            <button
              key={i}
              onMouseDown={(e) => {
                e.preventDefault();
                runSearch(h);
                setShowHistory(false);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-accent"
            >
              <Search size={10} className="text-muted-foreground" />
              {h}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
