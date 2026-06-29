import { type TabCommand } from "@/shared/tabs";

import { getMainWindow } from "../windows/main/instance";

/** Send a tab operation to the renderer that owns tab state (AppShell). */
export function sendTabCommand(command: TabCommand) {
  getMainWindow()?.webContents.send("tab-command", command);
}
