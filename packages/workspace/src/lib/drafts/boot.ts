import { workspaceLayout } from "../workspace-layout";
import { type DraftsFinished, finishSentDrafts } from "./send";
import { type DraftsMigration, migrateDraftsToFolder } from "./migrate";

export interface DraftsSettled {
  finished: DraftsFinished;
  moved: DraftsMigration;
}

/**
 * Puts the workspace's drafts in order, as the app does at each launch before
 * a window reads one: the drafts an earlier build hid are moved into
 * `Drafts/`, and any send the app was interrupted partway through is
 * finished.
 *
 * In that order, since a draft an earlier build left behind can be one whose
 * message had already been written when the app went: it has to be in
 * `Drafts/` before anything can ask whether its chat holds that message.
 *
 * Runs after the records converter, so a chat whose conversation was still in
 * a database can be read for the message that names a draft. The days in the
 * folder names are read in this computer's own zone, which is the zone the
 * person opening the folder is in.
 */
export async function settleDrafts(
  rootDir: string,
  { moveToTrash }: { moveToTrash: (target: string) => Promise<void> },
): Promise<DraftsSettled> {
  const moved = await migrateDraftsToFolder({
    rootDir,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const finished = await finishSentDrafts({
    chatsDir: workspaceLayout(rootDir).chatsDir,
    moveToTrash,
    rootDir,
  });
  return { finished, moved };
}
