import { type ChatDir } from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { chatDir } from "./record-folders";

/**
 * The folder a record works in: what its agent sees at `/task`, where its
 * shell, scripts and file tools run, and where its uploads, spills and
 * downloads land. A chat's tasks work in it too, since they run in the
 * chat's record.
 */
export function workDir(id: ChatId): ChatDir {
  return chatDir(id);
}
