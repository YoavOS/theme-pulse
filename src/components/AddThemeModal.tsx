import { useState, useMemo, useEffect } from "react";
import { useWatchlist } from "@/hooks/useWatchlistContext";
import { ThemeData } from "@/data/themeData";
import { Search, Check, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset selection every time modal opens
  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setSearch("");
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return themes
      .filter(t => t.theme_name.toLowerCase().includes(q))
      .sort((a, b) => a.theme_name.localeCompare(b.theme_name));
  }, [themes, search]);

  const toggleSelect = (name: string) => {
    if (isPinned(name)) return; // already pinned, can't select
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleAdd = () => {
    selected.forEach(name => togglePin(name));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[500px] border-none p-0 overflow-hidden flex flex-col"
        style={{
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle style={{ fontFamily: "'Syne', sans-serif" }}>
            Add themes to your watchlist
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

        {/* Theme list */}
        <div className="max-h-[400px] overflow-auto px-5">
          <div className="space-y-1">
            {filtered.map(theme => {
              const pinned = isPinned(theme.theme_name);
              const checked = selected.has(theme.theme_name);
              const validTickers = theme.tickers.filter(t => !t.skipped);
              const total = validTickers.length;
              const up = validTickers.filter(t => t.pct > 0).length;

              return (
                <button
                  key={theme.theme_name}
                  onClick={() => toggleSelect(theme.theme_name)}
                  disabled={pinned}
                  className={`w-full flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                    pinned
                      ? "opacity-50 cursor-default"
                      : checked
                        ? "bg-primary/10"
                        : "hover:bg-accent/50"
                  }`}
                >
                  {/* Checkbox area */}
                  <div className={`flex items-center justify-center w-4 h-4 rounded-sm border shrink-0 ${
                    pinned
                      ? "border-primary bg-primary/20"
                      : checked
                        ? "border-primary bg-primary"
                        : "border-muted-foreground"
                  }`}>
                    {(pinned || checked) && <Check size={12} className={pinned ? "text-primary" : "text-primary-foreground"} />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium truncate ${pinned ? "text-muted-foreground" : "text-foreground"}`}>
                        {theme.theme_name}
                      </span>
                      {pinned && <span className="text-[10px] text-muted-foreground">(already added)</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
                      <span className={theme.performance_pct >= 0 ? "text-gain-medium" : "text-loss-mild"}>
                        {theme.performance_pct >= 0 ? "+" : ""}{theme.performance_pct.toFixed(2)}%
                      </span>
                      {total > 0 && <span>{up}/{total} advancing</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Sticky footer */}
        <div className="sticky bottom-0 flex items-center justify-between px-5 py-3 border-t border-border bg-background/80 backdrop-blur-sm">
          <span className="text-xs text-muted-foreground">
            {selected.size} theme{selected.size !== 1 ? "s" : ""} selected
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={selected.size === 0}
              onClick={handleAdd}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              Add Themes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
