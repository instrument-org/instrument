// What the desktop app's main process loads before its first window is up:
// settling the workspace's folders and the login shell's PATH. Everything
// here is file and process plumbing, and nothing it imports may reach the
// agent (its tools, model text, machines or RPC), which loads with the rest
// of the app from `./electron`. The startup check
// (`apps/studio/scripts/check-startup-bundle.ts`) fails a build whose code
// before the window grows past its budget or takes in `ai`, just-bash or the
// MCP SDK.
export { CHAT_FOLDER_NAMES } from "./constants";
export {
  instrumentFolderInDocuments,
  instrumentFolderUnchosen,
} from "./lib/chat/output-folder";
export {
  type LayoutMarkStore,
  WORKSPACE_LAYOUT_VERSION,
} from "./lib/layout-marks";
export { installAISDKWarningLogger } from "./lib/log-ai-sdk-warnings";
export { startLoginShellPath } from "./lib/login-shell-path";
export {
  ASIDE_INFIX,
  asidesOf,
  entryExists,
  isDirectorySync,
  mergeEntrySync,
  moveEntrySync,
  placeEntrySync,
  removeEntrySync,
  removeIfEmptySync,
  setAsideSync,
} from "./lib/move-entry";
export { placePaths, startupPaths } from "./lib/permissions/places";
export {
  type PathMove,
  registerStoredPaths,
  rewriteStoredPaths,
} from "./lib/rewrite-stored-paths";
