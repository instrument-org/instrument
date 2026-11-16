import { workspaceLayout } from "../workspace-layout";
import { type DraftsFinished, finishSentDrafts } from "./send";
import { convertBetaDrafts, type DraftsMigration } from "./migrate";
import { moveTopLevelDrafts } from "./move-in";

export interface DraftsSettled {
  /** The beta's drafts converted where they are. */
  converted: DraftsMigration;
  finished: DraftsFinished;
  /** The drafts a build before kept in the top-level `Drafts/`, moved in. */
  movedIn: DraftsMigration;
}

/**
 * Puts the workspace's drafts in order, as the app does at each launch before
 * a window reads one: the drafts a build before kept in the top-level
 * `Drafts/` are moved into `.instrument/drafts/`, the drafts an early beta
 * left there in its own shape are converted, and any send the app was
 * interrupted partway through is finished.
 *
 * In that order, since a draft an earlier build left behind can be one whose
 * message had already been written when the app went: it has to be in the
 * drafts folder, in its current shape, before anything can ask whether its
 * chat holds that message.
 *
 * Runs after the records converter, so a chat whose conversation was still in
 * a database can be read for the message that names a draft. The days in the
 * folder names are read in this computer's own zone, which is the zone the
 * person opening the folder is in.
 */
export async function settleDrafts(
  {
    machineDir,
    rootDir,
  }: {
    /** This computer's folder for the workspace, for the paths a move rewrites. */
    machineDir: string;
    rootDir: string;
  },
  { moveToTrash }: { moveToTrash: (target: string) => Promise<void> },
): Promise<DraftsSettled> {
  const movedIn = moveTopLevelDrafts({ machineDir, rootDir });
  const converted = await convertBetaDrafts({
    rootDir,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const finished = await finishSentDrafts({
    chatsDir: workspaceLayout(rootDir).chatsDir,
    moveToTrash,
    rootDir,
  });
  return { converted, finished, movedIn };
}
