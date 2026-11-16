import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import path from "node:path";

import { readJsonRecordSync, updateJsonRecordSync } from "./json-record-file";

/**
 * The folder a 1.x task kept what it handed the person in, below its own
 * folder and so below its chat's work folder once the chat is made: the
 * path its messages name each file by starts with it.
 */
export const LEGACY_OUTPUT_DIR_NAME = "output";

/**
 * Writes down where the layout sweep moved each entry of a chat's `output/`
 * (`moveLegacyOutputsToFiles`), by the path its messages name it by
 * (`output/<name>`), beside what an earlier sweep wrote for the chat.
 */
export function recordMovedOutputs({
  chatId,
  machineDir,
  moved,
}: {
  chatId: string;
  machineDir: string;
  moved: Record<string, string>;
}): void {
  // oxlint-disable-next-line studio/no-sync-content-read -- the machine folder is on local disk, and the layout sweep is synchronous
  updateJsonRecordSync(movedOutputsFile(machineDir), (held) => ({
    [chatId]: { ...(isRecord(held[chatId]) ? held[chatId] : {}), ...moved },
  }));
}

/**
 * Where a path a chat's messages name a 1.x task's handed-over file by
 * (`output/<name>`, or something inside a folder there) went in the Files
 * folder, or nothing when the chat had no such file moved.
 */
export function movedOutputOf({
  chatId,
  machineDir,
  relative,
}: {
  chatId: string;
  machineDir: string;
  /** The path as the message names it, relative to the work folder. */
  relative: string;
}): string | undefined {
  const [first, entry, ...rest] = relative.split("/");
  if (first !== LEGACY_OUTPUT_DIR_NAME || entry === undefined) {
    return undefined;
  }
  // oxlint-disable-next-line studio/no-sync-content-read -- the machine folder is on local disk, and the resolver reads it synchronously
  const read = readJsonRecordSync(movedOutputsFile(machineDir));
  const chat = read.kind === "read" ? read.record[chatId] : undefined;
  const placed = isRecord(chat)
    ? chat[`${LEGACY_OUTPUT_DIR_NAME}/${entry}`]
    : undefined;
  return typeof placed === "string" ? path.join(placed, ...rest) : undefined;
}

function movedOutputsFile(machineDir: string): string {
  return path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.movedOutputs);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
