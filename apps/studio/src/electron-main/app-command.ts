import { commandPublisher } from "@/electron-main/rpc/publisher";
import { type AppCommand } from "@/shared/app-command";

/**
 * Send an app command from the main process (native menus, accelerators,
 * onboarding) to the renderer that owns the window (MainWindow). Published over
 * the command bus and streamed to the renderer via `appCommands.events.command`.
 * Carries both tab operations and app-wide view-state commands (see AppCommand).
 */
export function sendAppCommand(command: AppCommand) {
  commandPublisher.publish("app.command", command);
}
