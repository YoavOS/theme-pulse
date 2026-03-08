import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Pin, Bell, Check, X } from "lucide-react";
import { useWatchlist, AlertConfig } from "@/hooks/useWatchlist";
import { useLiveThemeData } from "@/hooks/useLiveThemeData";
import ThemeCard from "@/components/ThemeCard";
import { ThemeData } from "@/data/themeData";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";

export default function Watchlist() {
  const { pinned, togglePin, alerts, setAlert, getAlert } = useWatchlist();
  const { themes } = useLiveThemeData("Today");
  const [triggeredAlerts, setTriggeredAlerts] = useState<
    { themeName: string; message: string; type: "up" | "down" }[]
  >([]);

  const pinnedThemes = useMemo(
    () => themes.filter(t => pinned.includes(t.theme_name)),
    [themes, pinned]
  );

  // Check alerts on load
  useEffect(() => {
    checkAlerts();
  }, [pinnedThemes]);

  const checkAlerts = useCallback(async () => {
    const triggered: typeof triggeredAlerts = [];

    // Use ticker_performance for 1W data
    const { data: perfData } = await supabase
      .from("ticker_performance")
      .select("symbol, perf_1w");

    if (!perfData) return;

    const perfMap = new Map<string, number>();
    for (const p of perfData) {
      perfMap.set(p.symbol, p.perf_1w || 0);
    }

    // Get themes + their tickers
    const { data: themesDb } = await supabase.from("themes").select("id, name");
    const { data: tickers } = await supabase.from("theme_tickers").select("theme_id, ticker_symbol");

    if (!themesDb || !tickers) return;

    const themeMap = new Map<string, string[]>();
    const idToName = new Map<string, string>();
    for (const t of themesDb) idToName.set(t.id, t.name);
    for (const tk of tickers) {
      const name = idToName.get(tk.theme_id);
      if (!name) continue;
      const arr = themeMap.get(name) || [];
      arr.push(tk.ticker_symbol);
      themeMap.set(name, arr);
    }

    for (const themeName of pinned) {
      const config = getAlert(themeName);
      if (!config.up && !config.down) continue;

      const symbols = themeMap.get(themeName) || [];
      if (symbols.length === 0) continue;

      const perfs = symbols.map(s => perfMap.get(s) || 0).filter(Boolean);
      if (perfs.length === 0) continue;

      const avg1w = perfs.reduce((a, b) => a + b, 0) / perfs.length;

      if (config.up !== null && avg1w >= config.up) {
        triggered.push({
          themeName,
          message: `🔔 ${themeName} crossed +${config.up}% this week — currently ${avg1w >= 0 ? "+" : ""}${avg1w.toFixed(1)}%`,
          type: "up",
        });
      }
      if (config.down !== null && avg1w <= config.down) {
        triggered.push({
          themeName,
          message: `🔔 ${themeName} crossed ${config.down}% this week — currently ${avg1w >= 0 ? "+" : ""}${avg1w.toFixed(1)}%`,
          type: "down",
        });
      }
    }

    setTriggeredAlerts(triggered);
  }, [pinned, getAlert]);

  const dismissAlert = (index: number) => {
    setTriggeredAlerts(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft size={16} />
            </Link>
            <h1 className="text-xl font-extrabold tracking-tight text-foreground">
              Watchlist
            </h1>
            <span className="text-xs text-muted-foreground">
              {pinned.length} pinned
            </span>
            {triggeredAlerts.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/20 px-2 py-0.5 text-[10px] font-bold text-destructive">
                <Bell size={10} /> {triggeredAlerts.length}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Alert toasts */}
      {triggeredAlerts.length > 0 && (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
          {triggeredAlerts.map((alert, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 rounded-lg border p-3 text-xs shadow-lg backdrop-blur-md ${
                alert.type === "up"
                  ? "border-[#00f5c4]/30 bg-[#00f5c4]/10 text-[#00f5c4]"
                  : "border-[#f5a623]/30 bg-[#f5a623]/10 text-[#f5a623]"
              }`}
            >
              <span className="flex-1">{alert.message}</span>
              <button onClick={() => dismissAlert(i)} className="shrink-0 mt-0.5 opacity-70 hover:opacity-100">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <main className="container py-6">
        {pinned.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div
              className="mb-4 rounded-lg border-2 border-dashed border-border p-8 animate-pulse"
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              <Pin size={32} className="text-muted-foreground mx-auto" />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              No themes pinned yet — click 📌 on any theme card to add it here
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 min-[1800px]:grid-cols-4">
            {pinnedThemes.map((theme, i) => (
              <div key={theme.theme_name}>
                <div className="relative">
                  <div style={{ boxShadow: "0 0 0 1px rgba(0,245,196,0.2), 0 0 12px rgba(0,245,196,0.08)" }} className="rounded-lg">
                    <ThemeCard theme={theme} index={i} />
                  </div>
                  {/* Unpin button */}
                  <button
                    onClick={() => togglePin(theme.theme_name)}
                    className="absolute top-2 right-2 z-10 rounded-md p-1 text-[#00f5c4] bg-background/80 hover:bg-accent transition-colors"
                    title="Unpin"
                  >
                    <Pin size={12} className="fill-current" />
                  </button>
                </div>
                <AlertRow
                  themeName={theme.theme_name}
                  config={getAlert(theme.theme_name)}
                  onSave={(c) => setAlert(theme.theme_name, c)}
                />
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function AlertRow({
  themeName,
  config,
  onSave,
}: {
  themeName: string;
  config: AlertConfig;
  onSave: (c: AlertConfig) => void;
}) {
  const [up, setUp] = useState(config.up?.toString() || "");
  const [down, setDown] = useState(config.down ? Math.abs(config.down).toString() : "");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    onSave({
      up: up ? parseFloat(up) : null,
      down: down ? -Math.abs(parseFloat(down)) : null,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div
      className="mt-1 flex items-center gap-2 rounded-b-lg px-3 py-2 text-[11px]"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderTop: "none",
      }}
    >
      <span className="text-muted-foreground shrink-0">🔔 Alert if 1W &gt; +</span>
      <input
        type="number"
        value={up}
        onChange={e => setUp(e.target.value)}
        placeholder="5"
        className="w-10 rounded border border-border bg-background px-1 py-0.5 text-center text-[11px] text-foreground"
        style={{ fontFamily: "'DM Mono', monospace" }}
      />
      <span className="text-muted-foreground">% · &lt; −</span>
      <input
        type="number"
        value={down}
        onChange={e => setDown(e.target.value)}
        placeholder="3"
        className="w-10 rounded border border-border bg-background px-1 py-0.5 text-center text-[11px] text-foreground"
        style={{ fontFamily: "'DM Mono', monospace" }}
      />
      <span className="text-muted-foreground">%</span>
      <button
        onClick={handleSave}
        className="ml-auto rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {saved ? <Check size={10} className="text-[#00f5c4]" /> : "Set"}
      </button>
    </div>
  );
}
