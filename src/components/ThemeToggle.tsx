import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "app-theme";

function applyTheme(theme: "dark" | "light") {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

// Initialize as early as possible to avoid flash
(() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as "dark" | "light" | null;
    applyTheme(saved ?? "dark");
  } catch {
    applyTheme("dark");
  }
})();

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      return (localStorage.getItem(STORAGE_KEY) as "dark" | "light") ?? "dark";
    } catch {
      return "dark";
    }
  });

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {}
  }, [theme]);

  const isLight = theme === "light";

  return (
    <button
      type="button"
      onClick={() => setTheme(isLight ? "dark" : "light")}
      title={isLight ? "Switch to Dark Mode" : "Switch to Light Mode"}
      aria-label="Toggle theme"
      className="fixed top-3 right-3 z-[200] flex items-center gap-1.5 rounded-full border border-border bg-card/90 backdrop-blur px-3 py-1.5 text-xs font-medium text-foreground shadow-md hover:bg-accent hover:text-accent-foreground transition-colors"
    >
      {isLight ? <Sun size={14} /> : <Moon size={14} />}
      <span>{isLight ? "Light" : "Dark"}</span>
    </button>
  );
}
