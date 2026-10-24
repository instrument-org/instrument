import { type ChatSource, type ImportSource } from "../model";

/** The chats in an export file. A placeholder until the parsers land. */
export function openExport(
  _path: string,
): Promise<{ chats: ChatSource; source: ImportSource }> {
  return Promise.reject(new Error("Importing an export is not built yet."));
}
