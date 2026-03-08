import { useState, useMemo } from "react";
import { useWatchlist } from "@/hooks/useWatchlist";
import { ThemeData } from "@/data/themeData";
import { Search, Check, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function AddThemeModal({
  open,
  onOpenChange,
  themes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  themes: ThemeData[];
}) {
  const { isPinned, togglePin } = useWatchlist();
  const [search, setSearch] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return themes
      .filter(t => t.theme_name.toLowerCase().includes(q))
      .sort((a, b) => a.theme_name.localeCompare(b.theme_name));
  }, [themes, search]);

  const handleToggle = (name: string) => {
    if (isPinned(name)) {
      setConfirmRemove(name);
    } else {
      togglePin(name);
    }
  };

  const confirmRemoveTheme = () => {
    if (confirmRemove) {
      togglePin(confirmRemove);
      setConfirmRemove(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[500px] border-none p-0 overflow-hidden"
        style={{
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle style={{ fontFamily: "'Syne', sans-serif" }}>
            Search and add themes to your watchlist
          </DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="px-5 pt-3 pb-2">
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
            <Search size={14} className="text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter themes..."
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
              autoFocus
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground">
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Confirm remove inline */}
        {confirmRemove && (
          <div className="mx-5 mb-2 flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs">
            <span className="text-destructive">Remove <strong>{confirmRemove}</strong> from watchlist?</span>
            <div className="flex gap-2">
              <button
                onClick={confirmRemoveTheme}
                className="rounded px-2 py-0.5 text-destructive font-semibold hover:bg-destructive/20"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmRemove(null)}
                className="rounded px-2 py-0.5 text-muted-foreground hover:bg-accent"
              >
                No
              </button>
            </div>
          </div>
        )}

        {/* Theme list */}
        <div className="max-h-[400px] overflow-auto px-5 pb-5">
          <div className="space-y-1">
            {filtered.map(theme => {
              const pinned = isPinned(theme.theme_name);
              const validTickers = theme.tickers.filter(t => !t.skipped);
              const total = validTickers.length;
              const up = validTickers.filter(t => t.pct > 0).length;
              const ratio = total > 0 ? up / total : 0;

              return (
                <button
                  key={theme.theme_name}
                  onClick={() => handleToggle(theme.theme_name)}
                  className={`w-full flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                    pinned
                      ? "bg-primary/5 text-muted-foreground"
                      : "hover:bg-accent/50 text-foreground"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium truncate ${pinned ? "text-muted-foreground" : ""}`}>
                        {theme.theme_name}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
                      <span className={theme.performance_pct >= 0 ? "text-gain-medium" : "text-loss-mild"}>
                        {theme.performance_pct >= 0 ? "+" : ""}{theme.performance_pct.toFixed(2)}%
                      </span>
                      {total > 0 && <span>{up}/{total} advancing</span>}
                    </div>
                  </div>
                  {pinned && <Check size={14} className="shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
