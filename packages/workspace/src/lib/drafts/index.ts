/**
 * The drafts in a workspace, as the folder a person opens holds them: the
 * format (`draft-file.ts`), the folder (`draft-folder.ts`) and the steps a
 * send is made of (`send.ts`).
 *
 * Its own package entry, `@instrument-org/workspace/drafts`, because the
 * app's main process owns the drafts the windows keep and reads and writes
 * them before the workspace is up. What a launch does with them
 * (`boot.ts`) reads the chats' records, so it is handed over through the
 * `electron` entry with the rest of the launch's sweeps.
 */

export {
  type DraftAttached,
  type DraftFile,
  isEmptyDraft,
  parseDraftFile,
  renderDraftFile,
} from "./draft-file";
export {
  type DraftOnDisk,
  draftsFolderDir,
  ensureDraftFolder,
  findDraft,
  readDrafts,
  removeDraft,
  writeDraftFile,
} from "./draft-folder";
