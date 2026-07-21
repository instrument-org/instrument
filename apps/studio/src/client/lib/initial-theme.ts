// The theme class lands twice. The preload puts it on <html> before the
// document is parsed, from the preference the main process holds, which is what
// keeps the render-blocking stylesheet from painting a light background on a
// dark-mode launch. ThemeProvider then applies it again from its own
// preferences query, and on every change after that. Both go through here.

type Theme = "dark" | "light" | "system";

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
