// Theme class is normally applied by ThemeProvider in an effect gated on an
// async preferences query. That lands after first paint, so opaque light-mode
// surfaces (e.g. the prompt input) flash white before flipping to dark. We
// cache the last theme preference and apply the resolved class synchronously
// before React mounts to avoid that flash.

export const THEME_STORAGE_KEY = "studio-theme";

type Theme = "dark" | "light" | "system";

export function applyInitialTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  const theme: Theme =
    stored === "dark" || stored === "light" || stored === "system"
      ? stored
      : "system";
  applyThemeClass(theme);
}

export function applyThemeClass(theme: Theme) {
  const root = window.document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolveTheme(theme));
}

function resolveTheme(theme: Theme): "dark" | "light" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return theme;
}
