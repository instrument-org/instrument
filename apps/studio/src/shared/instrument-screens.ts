/**
 * The screens an `instrument://screen/<name>` link opens, by that name: the
 * places and dialogs a reply points someone at that are neither a setting
 * nor one of their own things. A screen with an `href` opens at that address;
 * one without is a dialog the window opens by name.
 *
 * The product guide lists these from here, so a screen added here is one the
 * agent can link to.
 */
export const SCREENS = {
  apps: {
    detail: "The services Instrument can work in for you, and connecting one.",
    href: "/apps",
    title: "Apps",
  },
  browser: {
    detail: "A browser of your own, which tasks can work in beside you.",
    href: "/browser",
    title: "Browser",
  },
  "release-notes": {
    detail: "What changed in each version.",
    href: "/release-notes",
    title: "Release notes",
  },
  shortcuts: {
    detail: "Every keyboard shortcut, by section.",
    title: "Keyboard shortcuts",
  },
} as const satisfies Record<
  string,
  { detail: string; href?: string; title: string }
>;

export type ScreenName = keyof typeof SCREENS;

export const isScreenName = (name: string): name is ScreenName =>
  Object.hasOwn(SCREENS, name);
