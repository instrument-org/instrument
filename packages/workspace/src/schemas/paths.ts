import path from "node:path";
import { z } from "zod";

const UnbrandedAbsolutePathSchema = z.string().refine((val) => {
  return path.isAbsolute(val);
}, "Path is not absolute");

export const AbsolutePathSchema =
  UnbrandedAbsolutePathSchema.brand("AbsolutePath");
export type AbsolutePath = z.output<typeof AbsolutePathSchema>;

export const WorkspaceDirSchema = AbsolutePathSchema.brand("WorkspaceDir");
export type WorkspaceDir = z.output<typeof WorkspaceDirSchema>;

export const TaskDirSchema = AbsolutePathSchema.brand("TaskDir");
export type TaskDir = z.output<typeof TaskDirSchema>;

const UnbrandedRelativePathSchema = z.string().refine((val) => {
  return !path.isAbsolute(val);
}, "Path is not relative");

export const RelativePathSchema =
  UnbrandedRelativePathSchema.brand("RelativePath");

export type RelativePath = z.output<typeof RelativePathSchema>;

// A relative path that must stay within the task dir: rejects ".." segments.
// Use for RPC inputs naming real task files, where traversal is never valid.
export const RelativeTaskPathSchema = RelativePathSchema.refine(
  (val) => !val.split(/[/\\]/).includes(".."),
  "Path must not contain '..' segments",
);

/**
 * Root of the read-only attached-folder mounts in the workspace virtual FS
 * (e.g. `/mnt/Photos`). Attached folders live on the user's real disk and are
 * surfaced read-only under this prefix. Single source of truth for the mount
 * root: this schema, the attached-folder mount points, and the asset server
 * all derive from it.
 */
export const ATTACHED_FOLDERS_MOUNT_ROOT = "/mnt";

const MountedWorkspacePathSchema = z
  .string()
  .startsWith(`${ATTACHED_FOLDERS_MOUNT_ROOT}/`)
  .brand("MountedWorkspacePath")
  .refine(
    (val) =>
      !val.includes("\\") &&
      !val.includes("//") &&
      !val.split("/").includes(".."),
    "Mounted path must not contain traversal or invalid separators",
  );

/** A task-relative path or an attached folder's absolute virtual mount path. */
export const WorkspaceFilePathSchema = z.union([
  RelativeTaskPathSchema,
  MountedWorkspacePathSchema,
]);
export type WorkspaceFilePath = z.output<typeof WorkspaceFilePathSchema>;
