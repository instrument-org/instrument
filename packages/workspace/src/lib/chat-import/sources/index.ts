import { errAsync, okAsync, ResultAsync } from "neverthrow";

import { TypedError } from "../../errors";
import { type ChatSource, type ImportFrom, type ImportSource } from "../model";
import { openExport } from "./export";
import { localSources, openLocalSource } from "./local";

/** A source opened to list and read: what it is, and its parser. */
export interface OpenedSource {
  chats: ChatSource;
  source: ImportSource;
}

/**
 * What this computer has to import from: the coding agents found in the home
 * folder. An export is not found, only picked, so it is never listed here.
 */
export function listSources(homeDir?: string): Promise<ImportSource[]> {
  return localSources(homeDir);
}

/**
 * Opens a source: a coding agent this computer has, or an export file. A
 * coding agent this computer does not have is not found; an export that
 * cannot be read is the person's to fix.
 */
export function openSource(
  from: ImportFrom,
  homeDir?: string,
): ResultAsync<OpenedSource, TypedError.InvalidInput | TypedError.NotFound> {
  if (from.type === "export") {
    return ResultAsync.fromPromise(
      openExport(from.path),
      (error) =>
        new TypedError.InvalidInput(
          error instanceof Error ? error.message : String(error),
          { cause: error },
        ),
    );
  }
  return ResultAsync.fromSafePromise(localSources(homeDir)).andThen(
    (sources) => {
      const source = sources.find(
        (each) => each.from.type === "local" && each.from.kind === from.kind,
      );
      return source
        ? okAsync({ chats: openLocalSource(from.kind, homeDir), source })
        : errAsync(
            new TypedError.NotFound(
              `This computer has no ${from.kind} chats to import.`,
            ),
          );
    },
  );
}
