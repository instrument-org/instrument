// Theme class is normally applied by ThemeProvider in an effect gated on an
// async preferences query. That lands after first paint, so opaque light-mode
// surfaces (e.g. the prompt input) flash white before flipping to dark.
//
// The main process pins `nativeTheme.themeSource` to the stored preference
// before it creates any window, and Electron mirrors that onto the renderer's
// `prefers-color-scheme`. So the resolved theme is readable here synchronously,
// straight from the preference the app itself treats as authoritative, with no
// renderer-side copy to fall out of sync with it.

type Theme = "dark" | "light" | "system";

export function applyInitialTheme() {
  applyThemeClass("system");
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
