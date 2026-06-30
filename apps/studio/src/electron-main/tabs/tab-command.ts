import { commandPublisher } from "@/electron-main/rpc/publisher";
import { type TabCommand } from "@/shared/tabs";

/**
 * Send a tab operation to the renderer that owns tab state (AppShell). Published
 * over the command bus and streamed to the renderer via `tabs.live.commands`.
 */
export function sendTabCommand(command: TabCommand) {
  commandPublisher.publish("tab.command", command);
}
