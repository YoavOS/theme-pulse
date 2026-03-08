/* Watchlist global state — React Context */
import { useState, useCallback, useEffect, useContext, createContext, type ReactNode } from "react";

const PINNED_KEY = "pinnedThemes";
const ALERTS_KEY = "watchlistAlerts";

export interface AlertConfig {
  up: number | null;
  down: number | null;
  relVol: number | null;
}

interface WatchlistContextType {
  pinned: string[];
  togglePin: (themeName: string) => void;
  isPinned: (themeName: string) => boolean;
  alerts: Record<string, AlertConfig>;
  setAlert: (themeName: string, config: AlertConfig) => void;
  getAlert: (themeName: string) => AlertConfig;
}

const WatchlistContext = createContext<WatchlistContextType | null>(null);

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const [pinned, setPinned] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(PINNED_KEY) || "[]");
    } catch {
      return [];
    }
  });

  const [alerts, setAlerts] = useState<Record<string, AlertConfig>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(ALERTS_KEY) || "{}");
      // Migrate old configs missing relVol
      const migrated: Record<string, AlertConfig> = {};
      for (const [k, v] of Object.entries(raw)) {
        const config = v as any;
        migrated[k] = {
          up: config.up ?? null,
          down: config.down ?? null,
          relVol: config.relVol ?? null,
        };
      }
      return migrated;
    } catch {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem(PINNED_KEY, JSON.stringify(pinned));
  }, [pinned]);

  useEffect(() => {
    localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
  }, [alerts]);

  const togglePin = useCallback((themeName: string) => {
    setPinned(prev =>
      prev.includes(themeName)
        ? prev.filter(n => n !== themeName)
        : [...prev, themeName]
    );
  }, []);

  const isPinned = useCallback(
    (themeName: string) => pinned.includes(themeName),
    [pinned]
  );

  const setAlert = useCallback((themeName: string, config: AlertConfig) => {
    setAlerts(prev => ({ ...prev, [themeName]: config }));
  }, []);

  const getAlert = useCallback(
    (themeName: string): AlertConfig => alerts[themeName] || { up: null, down: null, relVol: null },
    [alerts]
  );

  return (
    <WatchlistContext.Provider value={{ pinned, togglePin, isPinned, alerts, setAlert, getAlert }}>
      {children}
    </WatchlistContext.Provider>
  );
}

const fallback: WatchlistContextType = {
  pinned: [],
  togglePin: () => {},
  isPinned: () => false,
  alerts: {},
  setAlert: () => {},
  getAlert: () => ({ up: null, down: null, relVol: null }),
};

// Safe fallback — never throws, never causes blank screen
export function useWatchlist(): WatchlistContextType {
  const ctx = useContext(WatchlistContext);
  if (!ctx) {
    console.error("useWatchlist used outside WatchlistProvider");
    return fallback;
  }
  return ctx;
}
