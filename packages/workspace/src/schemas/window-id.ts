import { TaskIdSchema } from "./task-id";

/**
 * The id the app window's own browser tabs and file views are scoped under,
 * where a chat's are scoped under the chat's id. It names no record: the
 * window's folder is `.instrument/window/` in the workspace, which holds the
 * store its tabs' pages are kept in.
 */
export const WINDOW_ID = TaskIdSchema.parse("window");
