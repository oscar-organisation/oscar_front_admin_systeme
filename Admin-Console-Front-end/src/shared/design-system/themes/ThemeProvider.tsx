import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { runtimeConfig, type ThemeMode } from "@/shared/config";

interface PlatformBranding {
  applicationName: string;
  shortName: string;
  supportEmail: string | undefined;
}

interface ThemeContextValue {
  mode: ThemeMode;
  resolvedMode: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  branding: PlatformBranding;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEME_STORAGE_KEY = "oscar.theme.mode";

function storedMode(): ThemeMode {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" || value === "system"
      ? value
      : runtimeConfig.defaultThemeMode;
  } catch {
    return runtimeConfig.defaultThemeMode;
  }
}

function resolveMode(mode: ThemeMode): "light" | "dark" {
  return mode === "system"
    ? window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"
    : mode;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(storedMode);
  const [resolvedMode, setResolvedMode] = useState<"light" | "dark">(() => resolveMode(mode));

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const resolved = resolveMode(mode);
      setResolvedMode(resolved);
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [mode]);

  const setMode = (nextMode: ThemeMode) => {
    setModeState(nextMode);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextMode);
    } catch {
      // Theme persistence is optional; the active session still updates.
    }
  };

  const value = useMemo<ThemeContextValue>(() => ({
    mode,
    resolvedMode,
    setMode,
    branding: {
      applicationName: runtimeConfig.applicationName,
      shortName: runtimeConfig.shortName,
      supportEmail: runtimeConfig.supportEmail,
    },
  }), [mode, resolvedMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme doit être utilisé dans <ThemeProvider>");
  return value;
}
