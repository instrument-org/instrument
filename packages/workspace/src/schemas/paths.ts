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

/** A chat's folder, `chats/<id>/`, or the window's, which is scoped like one. */
export const ChatDirSchema = AbsolutePathSchema.brand("ChatDir");
export type ChatDir = z.output<typeof ChatDirSchema>;

const UnbrandedRelativePathSchema = z.string().refine((val) => {
  return !isAbsolutePath(val);
}, "Path is not relative");

export const RelativePathSchema =
  UnbrandedRelativePathSchema.brand("RelativePath");

export type RelativePath = z.output<typeof RelativePathSchema>;

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

/** A path relative to the chat's folder, or an absolute path in the shell's spelling. */
export const WorkspaceFilePathSchema = z.union([
  RelativeChatPathSchema,
  AbsoluteFilePathSchema,
]);
export type WorkspaceFilePath = z.output<typeof WorkspaceFilePathSchema>;
