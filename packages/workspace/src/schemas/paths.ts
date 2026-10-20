import { z } from "zod";

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

/**
 * A chat's record folder in the workspace, `chats/<id>/`: its records, one
 * log per session per device, its `settings.json`, `attachments/` and handoff
 * notes. The window's, which is scoped like one, is `.instrument/window/`.
 */
export const ChatDirSchema = AbsolutePathSchema.brand("ChatDir");
export type ChatDir = z.output<typeof ChatDirSchema>;

/**
 * A chat's work folder on this computer, `work/<id>/` in the workspace's
 * machine folder: where its agent's shell starts, shared by its tasks, and
 * where what they make lands.
 */
export const WorkDirSchema = AbsolutePathSchema.brand("WorkDir");
export type WorkDir = z.output<typeof WorkDirSchema>;

const UnbrandedRelativePathSchema = z.string().refine((val) => {
  return !isAbsolutePath(val);
}, "Path is not relative");

export const RelativePathSchema =
  UnbrandedRelativePathSchema.brand("RelativePath");

export type RelativePath = z.output<typeof RelativePathSchema>;

/**
 * What a stored path to a file in the workspace starts with. Behind it is
 * the file's path from the workspace's top level, with forward slashes:
 * `workspace:/Notes/plan.md`. A record syncs with the workspace, so a path
 * kept this way names the same file on every computer and after the
 * workspace moves; `workspaceHostPath` reads it against the root it has now.
 */
export const IN_WORKSPACE_PREFIX = "workspace:/";

export const InWorkspacePathSchema = z
  .string()
  .startsWith(IN_WORKSPACE_PREFIX)
  .brand("InWorkspacePath");
export type InWorkspacePath = z.output<typeof InWorkspacePathSchema>;

// A relative path that must stay within the chat's folder: rejects ".." segments.
// Use for RPC inputs naming real files in a chat's folder, where traversal is never valid.
export const RelativeChatPathSchema = RelativePathSchema.refine(
  (val) => !val.split(/[/\\]/).includes(".."),
  "Path must not contain '..' segments",
);

/**
 * An absolute path in the shell's spelling (`/Users/sam/Photos/cat.png`, or
 * `/c/Users/sam/Photos/cat.png` on Windows). Which of them the agent may read
 * is for the permission rules to say when one is opened.
 */
const AbsoluteFilePathSchema = z
  .string()
  .refine((val) => val.startsWith("/"), "Path must be absolute")
  .brand("AbsoluteFilePath")
  .refine(
    (val) =>
      !val.includes("\\") &&
      !val.includes("//") &&
      !val.split("/").includes(".."),
    "Path must not contain traversal or invalid separators",
  );

/**
 * A path relative to the chat's folder, one kept by its place in the
 * workspace (`IN_WORKSPACE_PREFIX`), or an absolute path in the shell's
 * spelling.
 */
export const WorkspaceFilePathSchema = z.union([
  RelativeChatPathSchema,
  AbsoluteFilePathSchema,
]);
export type WorkspaceFilePath = z.output<typeof WorkspaceFilePathSchema>;
