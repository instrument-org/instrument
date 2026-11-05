import {
  type ActionInput,
  type LoggedAction,
  LoggedActionSchema,
  recordAction,
} from "@instrument-org/workspace/electron";
import { RECORD_ACTION_CHANNEL, WINDOW_ACTION_KINDS } from "@/shared/actions";
import { ipcMain } from "electron";

import { writeDevLogEntry } from "./dev-file-logger";

/**
 * Records one thing the person did in the app in the running workspace's
 * action log. A development run also writes it to the dev log under scope
 * `Actions`, so a reader of that log sees what the person did between the
 * main process's own lines. Never throws.
 */
export function recordPersonAction(action: ActionInput) {
  recordAction(action);
  writeDevLogEntry("info", [action], { scope: "Actions" });
}

function withoutTime({ at: _at, ...action }: LoggedAction): ActionInput {
  return action;
}

/**
 * A window's report of what the person did as the log takes it: one of the
 * kinds only a window sees (`WINDOW_ACTION_KINDS`), whole by the log's own
 * schema; anything else is nothing.
 */
export function windowActionOf(payload: unknown): ActionInput | undefined {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("kind" in payload) ||
    !WINDOW_ACTION_KINDS.some((kind) => kind === payload.kind)
  ) {
    return undefined;
  }
  // The schema checks a stored line, so the report is given a time to pass
  // it; the log stamps its own.
  const parsed = LoggedActionSchema.safeParse({
    ...payload,
    at: new Date(0).toISOString(),
  });
  return parsed.success ? withoutTime(parsed.data) : undefined;
}

/**
 * Records what the app window's own page reports over
 * `RECORD_ACTION_CHANNEL`. A page in the in-app browser, or a frame inside
 * the window's page, is never the app speaking for the person, so only the
 * window's main frame is heard.
 */
export function serveWindowActions() {
  ipcMain.on(RECORD_ACTION_CHANNEL, (event, payload: unknown) => {
    if (
      event.sender.getType() !== "window" ||
      event.senderFrame !== event.sender.mainFrame
    ) {
      return;
    }
    const action = windowActionOf(payload);
    if (action) {
      recordPersonAction(action);
    }
  });
}
