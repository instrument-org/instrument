import { resetStudioModals } from "@/client/atoms/studio-modal";
import { atom, getDefaultStore } from "jotai";

export type SettingsTab =
  | "About"
  | "Account"
  | "Activity"
  | "Apps"
  | "Developer"
  | "Dictation"
  | "General"
  | "Memory"
  | "Permissions"
  | "Providers"
  | "Skills"
  | "Storage"
  | "Support";

/**
 * Where Settings opens: a part of it, a row a link names, and what the part
 * opens at. Memory and Skills are pages of their own, which a request for
 * either part opens instead.
 */
export interface SettingsRequest {
  /** Expand the account's usage panel on the Providers tab. */
  providerUsage?: "claude-account";
  /** Open the Support tab's diagnostic log viewer over Settings. */
  diagnosticLog?: boolean;
  /** A memory a link named, by its name, which the Memory page says is gone when no file has it. */
  memory?: string;
  /**
   * The setting to bring into view and light, by the name a link gives it: a
   * row's id, a page's name, or words to search for (`settingsTargetOf`).
   */
  setting?: string;
  tab?: SettingsTab;
}

/**
 * A built-in page asked for from anywhere, a chord or a call outside React
 * included: an address, or Settings at what a request names. The window's
 * `BuiltInPageOpener` takes it, opens it as a tab of the group up or brings
 * forward the tab already showing it, and clears it.
 */
export type PageRequest = { href: string } | { settings: SettingsRequest };

export const pageRequestAtom = atom<null | PageRequest>(null);

/**
 * Asks the window for a built-in page by its address, closing whatever
 * dialog is up, since the page opens under it.
 */
export function openBuiltInPage(href: string) {
  request({ href });
}

/** As `openBuiltInPage`, for Settings at what the request names. */
export function requestSettings(settings: SettingsRequest) {
  request({ settings });
}

function request(page: PageRequest) {
  resetStudioModals();
  getDefaultStore().set(pageRequestAtom, page);
}
