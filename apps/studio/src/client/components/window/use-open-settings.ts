import {
  openSettings,
  type SettingsRequest,
} from "@/client/atoms/settings-modal";
import { settingsHrefOf } from "@/client/components/settings/settings-href";
import { useContext } from "react";

import { WindowContext } from "./context";

/**
 * Opens Settings at what a request names, from where it is pressed: in a
 * chat, as a link clicked there opens, and anywhere else as `openSettings`
 * does.
 */
export function useOpenSettings() {
  const appWindow = useContext(WindowContext);
  return (request: SettingsRequest) => {
    if (appWindow?.chatId === undefined) {
      openSettings(request);
    } else {
      appWindow.openScreen(settingsHrefOf(request));
    }
  };
}
