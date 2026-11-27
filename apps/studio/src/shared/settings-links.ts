/**
 * The schemes of a link that opens a page of the system's own settings:
 * a System Settings pane on a Mac
 * (`x-apple.systempreferences:com.apple.Date-Time-Settings.extension`), a
 * Settings page on Windows (`ms-settings:dateandtime`). An agent that cannot
 * make a change only an administrator can (the time zone, sharing, a
 * network) gives the person one of these to make it themselves.
 *
 * Linux has none: each desktop opens its settings by a command of its own
 * (`gnome-control-center datetime`, `systemsettings kcm_clock`), never a URL.
 */
export const SETTINGS_LINK_SCHEMES = {
  darwin: "x-apple.systempreferences:",
  win32: "ms-settings:",
} as const;

/**
 * The scheme of a settings link on a Node or Electron platform, with its
 * colon as `URL.protocol` writes it, or undefined where there is none.
 */
export function settingsLinkSchemeOf(platform: string): string | undefined {
  return platform === "darwin" || platform === "win32"
    ? SETTINGS_LINK_SCHEMES[platform]
    : undefined;
}

/**
 * Whether an address is a settings link on any system, so a reply written on
 * one computer reads the same on another. Whether this computer opens it is
 * `openExternal`'s to decide.
 */
export function isSettingsLink(href: string): boolean {
  const scheme = URL.parse(href)?.protocol.toLowerCase();
  return Object.values(SETTINGS_LINK_SCHEMES).some(
    (settings) => settings === scheme,
  );
}
