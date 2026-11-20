import {
  requestSettings,
  type SettingsRequest,
} from "@/client/atoms/page-requests";

export type {
  SettingsRequest,
  SettingsTab,
} from "@/client/atoms/page-requests";

/**
 * Opens Settings as a tab of the group up, or brings forward the Settings
 * tab it already has, at the part asked for (`settingsHrefOf`). With nothing
 * asked, a Settings tab comes forward where it stands, or a new one opens
 * at General.
 */
export function openSettings(request?: SettingsRequest) {
  requestSettings(request ?? {});
}
