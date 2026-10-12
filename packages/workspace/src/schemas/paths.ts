import { z } from "zod";

import { MOUNT } from "../mount-points";

// These schemas are shared with the renderer, so they cannot reach for
// `node:path`. Matches `path.isAbsolute` for both posix (`/foo`) and win32
// (`\foo`, `C:\foo`, `C:/foo`) shapes regardless of the host platform.
const ABSOLUTE_PATH_PATTERN = /^(?:[/\\]|[a-z]:[/\\])/i;

const isAbsolutePath = (val: string) => ABSOLUTE_PATH_PATTERN.test(val);

const UnbrandedAbsolutePathSchema = z.string().refine((val) => {
  return isAbsolutePath(val);
}, "Path is not absolute");

export const AbsolutePathSchema =
  UnbrandedAbsolutePathSchema.brand("AbsolutePath");
export type AbsolutePath = z.output<typeof AbsolutePathSchema>;

export const WorkspaceDirSchema = AbsolutePathSchema.brand("WorkspaceDir");
export type WorkspaceDir = z.output<typeof WorkspaceDirSchema>;

/** A chat's folder, `chats/<id>/`, or the window's, which is scoped like one. */
export const ChatDirSchema = AbsolutePathSchema.brand("ChatDir");
export type ChatDir = z.output<typeof ChatDirSchema>;

const UnbrandedRelativePathSchema = z.string().refine((val) => {
  return !isAbsolutePath(val);
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
 * An absolute virtual path under a mount the agent reaches outside its own
 * folder: a folder on the user's disk under `MOUNT.folders` (e.g.
 * `/mnt/Photos/cat.png`), or a skill under `MOUNT.skills`.
 */
const MountedWorkspacePathSchema = z
  .string()
  .refine(
    (val) =>
      val.startsWith(`${MOUNT.folders}/`) ||
      // A skill, read where its source is mounted (`/skills/<source>/...`).
      val.startsWith(`${MOUNT.skills}/`),
    `Mounted path must be under ${MOUNT.folders}/ or ${MOUNT.skills}/`,
  )
  .brand("MountedWorkspacePath")
  .refine(
    (val) =>
      !val.includes("\\") &&
      !val.includes("//") &&
      !val.split("/").includes(".."),
    "Mounted path must not contain traversal or invalid separators",
  );

/** A task-relative path or a folder mount's absolute virtual mount path. */
export const WorkspaceFilePathSchema = z.union([
  RelativeTaskPathSchema,
  MountedWorkspacePathSchema,
]);
export type WorkspaceFilePath = z.output<typeof WorkspaceFilePathSchema>;
