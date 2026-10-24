import { ok, Result, ResultAsync, safeTry } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";

import { type ChatDir } from "../schemas/paths";
import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { createSession } from "./create-session";
import { TypedError } from "./errors";
import { forgetChat, placeChat } from "./record-folders";

/**
 * Makes a chat's record folder under `chats/`, holding `sessionId` as its
 * one session. Its work folder is made when its agent first needs it.
 */
export function initializeChat({
  chatId,
  opening,
  sessionId,
}: {
  chatId: ChatId;
  /** What the chat's first message says, which its session is started as. */
  opening?: string | undefined;
  sessionId: StoreId.Session;
}) {
  return initializeRecord({
    place: () => placeChat(chatId, sessionId),
    chatId,
    opening,
    sessionId,
  });
}

async function initializeRecord({
  place,
  chatId,
  opening,
  sessionId,
}: {
  place: () => ChatDir;
  chatId: ChatId;
  opening: string | undefined;
  sessionId: StoreId.Session;
}) {
  // Lets go of the id reserved below when any later step fails, so a chat
  // that was never made does not hold its name in the index.
  let release: (() => void) | undefined;
  return safeTry(async function* () {
    // The id is reserved in the index before its folder exists, which is
    // what refuses a name another chat just took.
    const dir = yield* Result.fromThrowable(
      place,
      (error) =>
        new TypedError.Conflict(
          error instanceof Error ? error.message : String(error),
        ),
    )();
    const parentDir = path.dirname(dir);
    release = () => {
      forgetChat(chatId);
    };

    // Ensure the parent dir exists (idempotent), then create the chat's
    // dir non-recursively so it acts as an atomic existence guard. With
    // deterministic date+slug names, two concurrent creates can both pass a
    // separate access check, so we rely on mkdir failing with EEXIST instead.
    yield* ResultAsync.fromPromise(
      fs.mkdir(parentDir, { recursive: true }),
      (error) =>
        new TypedError.FileSystem(
          error instanceof Error ? error.message : "Unknown error",
          { cause: error },
        ),
    );
    yield* ResultAsync.fromPromise(
      fs.mkdir(dir, { recursive: false }),
      (error) =>
        error instanceof Error && "code" in error && error.code === "EEXIST"
          ? new TypedError.Conflict(`Chat directory already exists: ${dir}`)
          : new TypedError.FileSystem(
              error instanceof Error ? error.message : "Unknown error",
              { cause: error },
            ),
    );

    // The chat's own session is made with it: its log's header is what says
    // which session is the chat's own, when it began, and on which build.
    yield* await createSession({ chatId, opening, sessionId });

    return ok({ chatId });
  }).mapErr((error) => {
    release?.();
    return error;
  });
}
