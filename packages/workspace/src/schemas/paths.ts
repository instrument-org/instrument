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

export const AppDirSchema = AbsolutePathSchema.brand("AppDir");
export type AppDir = z.output<typeof AppDirSchema>;

const UnbrandedRelativePathSchema = z.string().refine((val) => {
  return !path.isAbsolute(val);
}, "Path is not relative");

export const RelativePathSchema =
  UnbrandedRelativePathSchema.brand("RelativePath");

export type RelativePath = z.output<typeof RelativePathSchema>;

// A relative path that must stay within the task dir: rejects ".." segments.
// Use for RPC inputs naming real project files, where traversal is never valid.
export const RelativeProjectPathSchema = RelativePathSchema.refine(
  (val) => !val.split(/[/\\]/).includes(".."),
  "Path must not contain '..' segments",
);
