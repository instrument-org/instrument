import { CALENDAR_APP, CONTACTS_APP, REMINDERS_APP } from "./helper-apps";
import { MAIL_APP, MESSAGES_APP, NOTES_APP } from "./script-apps";
import { type MacAppDefinition } from "./tool";

/**
 * The Mac's own apps Instrument bundles an MCP server for, each an ordinary
 * local MCP app whose manifest names its server here (`runtime: bundled`).
 */
export const MAC_APPS: readonly MacAppDefinition[] = [
  CALENDAR_APP,
  CONTACTS_APP,
  MAIL_APP,
  MESSAGES_APP,
  NOTES_APP,
  REMINDERS_APP,
];

/** The bundled Mac app a server name names, if any. */
export function macAppNamed(server: string): MacAppDefinition | undefined {
  return MAC_APPS.find((app) => app.server === server);
}
