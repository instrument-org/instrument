import { APP_NAME_SLUG, instrumentUrlOf } from "@instrument-org/shared";

/**
 * The screens an `instrument://screen/<name>` link opens, by that name: the
 * built-in pages and dialogs a reply points someone at that are neither a
 * setting nor one of their own things. A screen with an `href` opens at that
 * address; one without is a dialog the window opens by name.
 *
 * The product guide lists these from here, so a screen added here is one the
 * agent can link to. The address field reads it too, for the page a tab is
 * on (`screenOfHref`) and the address that names it (`instrumentAddressOf`).
 */
export const SCREENS = {
  activity: {
    detail:
      "What you did in Instrument, with the AI requests your chats made, to search and clear.",
    href: "/activity",
    title: "History",
  },
  apps: {
    detail: "The services Instrument can work in for you, and connecting one.",
    href: "/apps",
    title: "Apps",
  },
  browser: {
    detail: "The web's start page, with the sites you kept and lately saw.",
    href: "/browser",
    title: "Browser",
  },
  chats: {
    detail: "Every chat there is, open or not, to search and open.",
    href: "/chat-list",
    title: "Chats",
  },
  extensions: {
    detail:
      "The Chrome extensions in your browser, and adding more from the Chrome Web Store.",
    href: "/extensions",
    title: "Extensions",
  },
  files: {
    detail: "The folders and files on this computer, starting at home.",
    href: "/files",
    title: "Files",
  },
  memory: {
    detail:
      "What Instrument remembers about you, one file per memory, to search, forget, or import from another AI.",
    href: "/memory",
    title: "Memory",
  },
  "release-notes": {
    detail: "What changed in each version.",
    href: "/release-notes",
    title: "Release notes",
  },
  settings: {
    detail:
      "Instrument's settings, a page per part. Link a part or a row with `instrument://settings/<name>`.",
    href: "/settings/general",
    title: "Settings",
  },
  shortcuts: {
    detail: "Every keyboard shortcut, by section.",
    title: "Keyboard shortcuts",
  },
  skills: {
    detail: "The skills tasks can use, and making a new one.",
    href: "/skills",
    title: "Skills",
  },
} as const satisfies Record<
  string,
  { detail: string; href?: string; title: string }
>;

export type ScreenName = keyof typeof SCREENS;

export const isScreenName = (name: string): name is ScreenName =>
  Object.hasOwn(SCREENS, name);

/**
 * The parts of Settings, each a page at `/settings/<name>` with its title,
 * in the order its sidebar lists them. Memory and Skills are pages of their
 * own (`/memory`, `/skills`), not parts of Settings.
 */
export const SETTINGS_SECTIONS = {
  general: "General",
  account: "Account",
  providers: "Providers",
  permissions: "Permissions",
  storage: "Storage",
  activity: "History",
  developer: "Developer",
} as const;

export type SettingsSection = keyof typeof SETTINGS_SECTIONS;

export const isSettingsSection = (name: string): name is SettingsSection =>
  Object.hasOwn(SETTINGS_SECTIONS, name);

/**
 * The built-in page a tab's address is on, by its name here, with the part
 * of it shown where the page has parts (a part of Settings). Undefined for
 * an address that is no built-in page: a chat, a file, a site, a task, one
 * app's page, a new tab.
 */
export function screenOfHref(
  href: string,
): undefined | { name: ScreenName; part?: SettingsSection } {
  let pathname: string;
  try {
    ({ pathname } = new URL(href, "http://tabs"));
  } catch {
    return undefined;
  }
  const [first, second, ...below] = pathname
    .split("/")
    .filter(Boolean)
    .map(decoded);
  if (first === undefined || below.length > 0) {
    return undefined;
  }
  if (first === "settings") {
    if (second === undefined) {
      return { name: "settings" };
    }
    return isSettingsSection(second)
      ? { name: "settings", part: second }
      : undefined;
  }
  if (second !== undefined) {
    return undefined;
  }
  const name = Object.entries(SCREENS).find(
    ([, screen]) => "href" in screen && screen.href === `/${first}`,
  )?.[0];
  return name !== undefined && isScreenName(name) ? { name } : undefined;
}

/**
 * The `instrument://` address of what a tab's address shows, as the released
 * app answers to it: a part of Settings by its own name
 * (`instrument://settings/providers`), any other built-in page as a screen
 * (`instrument://screen/chats`), and a chat, an app or a task by the
 * address a reply links it with. Files stands as a screen only at its start,
 * since a folder or a file is named by its path. Undefined for an address
 * nothing names.
 */
export function instrumentAddressOf(href: string): string | undefined {
  const screen = screenOfHref(href);
  if (screen?.name === "settings") {
    return `${APP_NAME_SLUG}://settings/${screen.part ?? "general"}`;
  }
  if (screen && (screen.name !== "files" || isBare(href))) {
    return `${APP_NAME_SLUG}://screen/${screen.name}`;
  }
  return instrumentUrlOf(href);
}

/** A built-in page the address field offers by name, and the address it opens. */
export interface BuiltInPage {
  address: string;
  name: ScreenName;
  /** The part of Settings it is, for a part's own row. */
  part?: SettingsSection;
  /** What its row says: the page's title, or `Settings › <part>`. */
  title: string;
}

/**
 * Every built-in page by name, with a row of its own for each part of
 * Settings but General, which is Settings' own, and Developer, which only
 * developer mode lists: each opens at the address
 * its tab stands at (`instrumentAddressOf`), and a dialog with no address of
 * its own (`shortcuts`) at its screen's.
 */
export function builtInPages(): BuiltInPage[] {
  return Object.entries(SCREENS).flatMap(([name, screen]): BuiltInPage[] => {
    if (!isScreenName(name)) {
      return [];
    }
    const own = {
      address:
        ("href" in screen ? instrumentAddressOf(screen.href) : undefined) ??
        `${APP_NAME_SLUG}://screen/${name}`,
      name,
      title: screen.title,
    };
    if (name !== "settings") {
      return [own];
    }
    const parts = Object.entries(SETTINGS_SECTIONS).flatMap(
      ([part, title]): BuiltInPage[] =>
        isSettingsSection(part) && part !== "general" && part !== "developer"
          ? [
              {
                address: `${APP_NAME_SLUG}://settings/${part}`,
                name,
                part,
                title: `${screen.title} › ${title}`,
              },
            ]
          : [],
    );
    return [own, ...parts];
  });
}

/** Whether an address carries nothing past its path. */
function isBare(href: string) {
  try {
    return new URL(href, "http://tabs").search === "";
  } catch {
    return false;
  }
}

function decoded(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
