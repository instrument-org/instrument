import { applyThemeClass, THEME_STORAGE_KEY } from "@/client/lib/initial-theme";
import { rpcClient } from "@/client/rpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light" | "system";

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
}

interface ThemeProviderState {
  resolvedTheme: "dark" | "light";
  setTheme: (theme: Theme) => void;
  theme: Theme;
}

const initialState: ThemeProviderState = {
  resolvedTheme: "light",
  setTheme: () => null,
  theme: "system",
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "system",
  ...props
}: ThemeProviderProps) {
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );

  const setThemeMutation = useMutation(
    rpcClient.preferences.setTheme.mutationOptions(),
  );

  const theme = preferences?.theme || defaultTheme;

  const [systemTheme, setSystemTheme] = useState<"dark" | "light">(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  );

  const resolvedTheme: "dark" | "light" =
    theme === "system" ? systemTheme : theme;

  useEffect(() => {
    // Cache for the synchronous pre-paint bootstrap in initial-theme.ts.
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    applyThemeClass(theme);

    if (theme === "system") {
      const queryMedia = window.matchMedia("(prefers-color-scheme: dark)");
      const listener = (e: MediaQueryListEvent) => {
        applyThemeClass("system");
        setSystemTheme(e.matches ? "dark" : "light");
      };
      queryMedia.addEventListener("change", listener);
      return () => {
        queryMedia.removeEventListener("change", listener);
      };
    }

    return;
  }, [theme]);

  const value = {
    resolvedTheme,
    setTheme: (t: Theme) => {
      setThemeMutation.mutate({ theme: t });
    },
    theme,
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  // oxlint-disable-next-line typescript/no-unnecessary-condition
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
};
