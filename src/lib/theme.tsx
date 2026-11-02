"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";
export type Appearance = {
  theme: Theme;
  reduced_motion: boolean;
  caption_size: "md" | "lg" | "xl";
};

const Defaults: Appearance = { theme: "system", reduced_motion: false, caption_size: "lg" };

const StoreKey = "lumen.appearance";

const ThemeContext = createContext<{
  appearance: Appearance;
  update: (patch: Partial<Appearance>) => void;
  resolved: "light" | "dark";
}>({ appearance: Defaults, update: () => undefined, resolved: "light" });

function resolve(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(() => {
    if (typeof window === "undefined") return Defaults;
    try {
      const stored = window.localStorage.getItem(StoreKey);
      return stored ? { ...Defaults, ...(JSON.parse(stored) as Appearance) } : Defaults;
    } catch {
      return Defaults;
    }
  });
  // The boot script in the document head already applied the right theme, so
  // read it back instead of guessing "light" and repainting.
  const [resolved, setResolved] = useState<"light" | "dark">(() => {
    if (typeof document === "undefined") return "light";
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });

  useEffect(() => {
    const apply = () => {
      const value = resolve(appearance.theme);
      setResolved(value);
      document.documentElement.classList.toggle("dark", value === "dark");
      document.documentElement.style.colorScheme = value;
    };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appearance.theme]);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = appearance.reduced_motion ? "true" : "false";
  }, [appearance.reduced_motion]);

  const update = useCallback((patch: Partial<Appearance>) => {
    setAppearance((current) => {
      const next = { ...current, ...patch };
      try {
        window.localStorage.setItem(StoreKey, JSON.stringify(next));
      } catch {
        /* storage may be unavailable */
      }
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ appearance, update, resolved }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppearance() {
  return useContext(ThemeContext);
}
