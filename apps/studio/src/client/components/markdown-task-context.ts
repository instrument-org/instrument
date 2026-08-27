import { type TaskId } from "@instrument-org/workspace/client";
import { createContext } from "react";

/**
 * Carries the ambient task context down to the module-scope components a
 * Markdown node renders through, so a file reference can build its asset URL
 * and file-action menu. Absent outside a task chat (a previewed Markdown file,
 * reasoning), which is what those components degrade against.
 */
export const MarkdownTaskContext = createContext<{
  assetBaseUrl?: string;
  // What this text's file references are a reference *as of*, passed to
  // `getAssetUrl` as the version. A message part's id, so two replies naming one
  // rewritten path do not share a URL and therefore do not share the picture the
  // renderer already decoded for it. Absent where the markdown is not a message
  // -- a previewed file, a skill -- and nothing there names a file twice.
  assetVersion?: string;
  // Whether the text this is rendering is still arriving. A construct that
  // resolves its own contents needs it: half a path resolves to nothing, which
  // is indistinguishable from a file that is genuinely gone, and only one of
  // those should be drawn.
  isStreaming?: boolean;
  taskId?: TaskId;
}>({});
