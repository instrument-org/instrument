// The marks a workspace keeps of how far the layout migration
// (`migrate-workspace-layout.ts`) has brought it, apart from the migration
// itself so the app can read and compare them before it loads the rest.

// The layoutVersion mark holding this value = a sweep at this version has
// visited every task under tasks/ and made every 1.x task into a chat and
// every 1.x project into a project, so boot skips both walks (their cost grows with
// the task count, and they are a no-op for every task a current build
// touched). Bump the version when a normalization step is added, so existing
// workspaces run the sweep once more. Between bumps, tasks must enter the
// workspace only through code that leaves them in the current shape, as
// initializeTask does. A task folder hand-copied into tasks/, or one a 1.x
// build writes after the sweep, stays as it is until the next version bump.
// 5: each chat's work moved out of the folder holding its records
// (splitChatRecords).
// 6: the app's folders moved from the workspace's top level into its
// `.instrument/` (moveAppFoldersIntoDataDir).
// 7: a chat whose `chat.db` holds no sessions given the `task.db` beside it
// that holds its conversation (renameChatDatabases).
// 8: a 1.x task whose `task.db` holds no sessions given the `sessions.db`
// beside it that holds its conversation (normalizeTaskPrivateFiles).
// 9: what a task's 1.x settings file holds filled into the settings it opens
// (normalizeTaskSettingsFile), and an attachment whose name is taken landed
// beside it in `attachments/` (normalizeTaskAttachments).
// 10: what a 1.x task handed over in its `output/` moved from its chat's
// work folder into the Files folder (moveLegacyOutputsToFiles).
export const WORKSPACE_LAYOUT_VERSION = 10;

/** How far the layout migration has brought a workspace. */
export interface LayoutMarks {
  /** The layout version the last sweep that finished with nothing left over ran at. */
  layoutVersion?: number;
  /** Set once legacy `projects/` has been drained into `tasks/`. */
  legacyProjectsMigrated?: boolean;
}

/**
 * Where the marks are kept, by whoever owns the workspace's own record (the
 * app keeps them in its `workspace.json`). A write names only what changed.
 */
export interface LayoutMarkStore {
  read(): LayoutMarks;
  write(change: LayoutMarks): void;
}
