import { useState, useCallback, useEffect } from "react";

const PINNED_KEY = "pinnedThemes";
const ALERTS_KEY = "watchlistAlerts";

export interface AlertConfig {
  up: number | null;
  down: number | null;
}

export function useWatchlist() {
  const [pinned, setPinned] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(PINNED_KEY) || "[]");
    } catch {
      return [];
    }
  });

  const [alerts, setAlerts] = useState<Record<string, AlertConfig>>(() => {
    try {
      return JSON.parse(localStorage.getItem(ALERTS_KEY) || "{}");
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
    (themeName: string): AlertConfig => alerts[themeName] || { up: null, down: null },
    [alerts]
  );

  return { pinned, togglePin, isPinned, alerts, setAlert, getAlert };
}
