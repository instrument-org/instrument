import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type AppSettings } from "./app-settings";
import { getTurnContext, type TurnKey, turnKey } from "./turn-context";
import { getWorkspaceConfig } from "./workspace-config";

export type SettingChange = SessionMessageDataPart.SettingChange;

/** What each turn's `settings` commands set, by chat and session, then by setting. */
const TURNS = new Map<string, Map<string, SettingChange>>();

export function beginSettingChangeTracking(turn: TurnKey): void {
  TURNS.set(turnKey(turn), new Map());
}

/**
 * Records a setting the turn running now set. A second change to the same
 * setting keeps the value from before the first, so the card says what the
 * turn did as a whole and Undo goes back to before it.
 */
export function recordSettingChange(change: SettingChange): void {
  const context = getTurnContext();
  const changes = context && TURNS.get(turnKey(context));
  if (!changes) {
    return;
  }
  const first = changes.get(change.id);
  changes.set(change.id, { ...change, before: first?.before ?? change.before });
}

/** What the turn's commands set, less what ended where it began. Ends the tracking. */
export function consumeSettingChanges(turn: TurnKey): SettingChange[] {
  const key = turnKey(turn);
  const changes = TURNS.get(key);
  TURNS.delete(key);
  return [...(changes?.values() ?? [])].filter(
    (change) => change.before.value !== change.after.value,
  );
}

/** The app's settings, or why there are none to reach. */
export function appSettings(): AppSettings {
  const settings = getWorkspaceConfig().appSettings;
  if (!settings) {
    throw new Error("the app's settings cannot be reached here.");
  }
  return settings;
}

/**
 * Sets each setting back to what it held before, skipping one that no longer
 * holds what the change set: the person has changed it since, and theirs
 * stands. Answers how many went back.
 */
export async function undoSettingChanges(
  changes: readonly SettingChange[],
): Promise<{ skipped: number; undone: number }> {
  const settings = appSettings();
  const now = new Map(
    (await settings.list()).map((each) => [each.id, each.value.value]),
  );
  let undone = 0;
  for (const change of changes) {
    if (now.get(change.id) !== change.after.value) {
      continue;
    }
    try {
      await settings.set(change.id, change.before.value);
      undone += 1;
    } catch (error) {
      // A value that is gone, such as a microphone since unplugged.
      getWorkspaceConfig().captureException(error);
    }
  }
  return { skipped: changes.length - undone, undone };
}
