import { ActionLog, actionLog, actionsDir } from "../../lib/actions/log";
import { type Action, type HistoryAction } from "../../lib/actions/schema";
import {
  getWorkspaceConfig,
  setWorkspaceConfig,
} from "../../lib/workspace-config";

/**
 * What the person did, without its time, as a test states it: anything but
 * a permission answered, which the chat's permissions keep.
 */
export type RecordedAction =
  Exclude<Action, { kind: "permission" }> extends infer A
    ? A extends { at: string }
      ? Omit<A, "at">
      : never
    : never;

const history: HistoryAction[] = [];

/**
 * Records what the person did the way the app does, each at its own time:
 * pages and files opened and files downloaded in a history the workspace's
 * config reads (`readPersonHistory`), everything else in the running
 * workspace's action log.
 */
export function recordActions(actions: [at: number, RecordedAction][]) {
  let now = 0;
  const log = new ActionLog(
    actionsDir(getWorkspaceConfig().workspaceMachineDir),
    { now: () => now },
  );
  for (const [at, action] of actions) {
    now = at;
    if (
      action.kind === "page" ||
      action.kind === "file" ||
      action.kind === "open-with" ||
      action.kind === "download"
    ) {
      history.push({ ...action, at: new Date(at).toISOString() });
    } else {
      log.record(action);
    }
  }
  log.close();
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    readPersonHistory: ({ limit, since, until }) =>
      history
        .filter((each) => {
          const at = Date.parse(each.at);
          return at >= since && at <= until;
        })
        .toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .slice(0, limit),
  });
}

/** Forgets everything `recordActions` recorded. */
export function forgetRecordedActions() {
  history.length = 0;
  actionLog().clear();
}
