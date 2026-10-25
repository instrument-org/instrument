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

export { DRAFT_FILE_NAME } from "../../constants";
export {
  contextEntryOf,
  contextLineOf,
  type DraftContextEntry,
  pastedFileOf,
  pastedPathOf,
} from "./context-line";
export {
  type DraftFile,
  isEmptyDraft,
  parseDraftFile,
  renderDraftFile,
} from "./draft-file";
export {
  draftFolderItems,
  type DraftFolderItem,
  type DraftOnDisk,
  draftsFolderDir,
  ensureDraftFolder,
  findDraft,
  isDraftFolderItem,
  ownsDraftFolder,
  readDrafts,
  removeDraft,
  writeDraftFile,
} from "./draft-folder";
