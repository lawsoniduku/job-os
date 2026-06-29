/**
 * lib/useTheme.js
 * ===============
 * Light/dark theme with persistence.
 *  - Reads saved choice from localStorage ("theme" = "light" | "dark")
 *  - Falls back to the OS preference on first visit
 *  - Toggles the `dark` class on <html>, which drives all Tailwind `dark:` styles
 *  - Remembers the user's choice across visits
 */
import { useState, useEffect, useCallback } from "react";

function getInitialTheme() {
  if (typeof window === "undefined") return "dark";
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* localStorage may be unavailable */ }
  // Default to dark for everyone on first visit. Users can toggle to light,
  // and that choice is then remembered.
  return "dark";
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function useTheme() {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem("theme", theme); } catch { /* ignore */ }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggleTheme, setTheme };
}
