import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { z } from "zod";

import { FolderAttachment } from "./folder-attachment";
import { TaskPane } from "./task-pane";

// Where the user left off in a task: the draft they were typing, what the pane
// has open, the model they picked, the folders attached. Per-task and read on
// open, never queried across tasks -- which is what separates it from the
// settings around it, and why it is one nested key rather than a flat spread.
//
// `projectFolderName` names the folder under `projects/` belonging to the
// project this task is in, kept here beside the attached folders because every
// caller that builds the filesystem layout already reads this state and needs
// both. Denormalized rather than resolved from the project id per call, because
// the file tools build a layout on every read and write and every asset request,
// synchronously, while resolving an id means reading every project's settings to
// find the match.
//
// The folder name and not its absolute path, so that nothing here is true only
// of the machine that wrote it: this file ships inside an exported task, and a
// host path from someone else's disk names nothing on the machine that imports
// it. `syncTaskProjectRoot` owns keeping it current; nothing else should write
// it.
export const StoredTaskStateSchema = z
  .object({
    attachedFolders: z.record(z.string(), FolderAttachment.Schema).optional(),
    // A pane this build cannot read costs the pane, not the folder list beside
    // it, which the record's silent catch would otherwise write away.
    // eslint-disable-next-line unicorn/prefer-top-level-await -- zod's catch, not a promise's
    pane: TaskPane.Schema.optional().catch(undefined),
    projectFolderName: z.string().optional(),
    promptDraft: z.string().optional(),
    selectedModelURI: z.string().optional(),
    showTutorial: z.boolean().optional(),
  })
  .default(() => ({}));

// The RPC-facing shape. Deliberately without `projectFolderName`: the renderer
// has no use for it, and it selects the directory of a writable agent mount, so
// it is not something a client should be able to set.
export const TaskStateSchema = z.object({
  attachedFolders: z.record(z.string(), FolderAttachment.Schema).optional(),
  pane: TaskPane.Schema.optional(),
  promptDraft: z.string().optional(),
  selectedModelURI: AIGatewayModelURI.Schema.optional(),
  showTutorial: z.boolean().optional(),
});

export type TaskState = z.output<typeof StoredTaskStateSchema>;

/**
 * Brings the stored state up to what the schema above expects.
 *
 * A task's state is read in places that never open its database, and a parse
 * failure is silent -- the record answers with empty state, which the next write
 * would then persist over the folders it failed to read. So this cannot wait for
 * the database to be opened; see store-migrations.ts for that half and for the
 * rules both halves follow.
 *
 * Applied on read and saved by the next write rather than rewritten here, since
 * every caller either writes back or does not care.
 */
export function migrateTaskState(state: unknown): unknown {
  if (!isRecord(state) || !isRecord(state.attachedFolders)) {
    return state;
  }

  // Folders were stored under `name`, which was the mount name all along.
  const folders = Object.entries(state.attachedFolders).map(
    ([key, folder]): [string, unknown] => {
      if (!isRecord(folder) || !("name" in folder) || "mountName" in folder) {
        return [key, folder];
      }
      const { name, ...rest } = folder;
      return [key, { ...rest, mountName: name }];
    },
  );

  return { ...state, attachedFolders: Object.fromEntries(folders) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
