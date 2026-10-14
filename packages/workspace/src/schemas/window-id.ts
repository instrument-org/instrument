import { ChatIdSchema } from "./chat-id";

/**
 * The id the app window's own browser tabs and file views are scoped under,
 * where a chat's are scoped under the chat's id, so it has a chat id's shape.
 * It names no chat and has no record folder, and no chat can take the name.
 */
export const WINDOW_ID = ChatIdSchema.parse("window");
