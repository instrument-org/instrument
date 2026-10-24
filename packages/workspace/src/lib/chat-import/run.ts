import { type ResultAsync } from "neverthrow";
import { unique } from "radashi";

import { publisher } from "../../rpc/publisher";
import { type ChatId } from "../../schemas/chat-id";
import { type TypedError } from "../errors";
import { importedChats } from "./imported";
import {
  type ImportFrom,
  type ImportProgress,
  type ListedCandidate,
  type RunImportOutput,
  importKey,
} from "./model";
import { type OpenedSource, openSource } from "./sources";
import { clearStaleImports, writeImportedChat } from "./write";

/** How many chats are written at once. Each spends most of its time syncing. */
const WRITES_AT_ONCE = 4;

/** What a run or a listing opens its source with; a test hands in its own. */
export type OpenSource = (
  from: ImportFrom,
) => ResultAsync<OpenedSource, TypedError.InvalidInput | TypedError.NotFound>;

/**
 * Every chat a source has, newest first, each marked with the chat it was
 * already imported as.
 */
export function listCandidates(
  from: ImportFrom,
  open: OpenSource = openSource,
) {
  return open(from).map(async ({ chats, source }) => {
    const [candidates, imported] = await Promise.all([
      chats.list(),
      importedChats(),
    ]);
    return {
      candidates: candidates
        .map(
          (candidate): ListedCandidate => ({
            ...candidate,
            imported: imported.get(importKey(candidate)) ?? null,
          }),
        )
        .toSorted((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
      source,
    };
  });
}

/** One run at a time, so two runs picking the same chat cannot both write it. */
let running: Promise<unknown> = Promise.resolve();

/**
 * Brings the picked chats of a source in: each already here is skipped, each
 * other one read and written as a chat, a few at a time, with a progress
 * event as each lands or fails. One the source no longer has fails, and so
 * does each still unread when reading the source fails.
 */
export function runImport(
  { from, sourceIds }: { from: ImportFrom; sourceIds: readonly string[] },
  {
    onProgress = (progress) => {
      publisher.publish("chatImport.progress", progress);
    },
    open = openSource,
  }: {
    onProgress?: (progress: ImportProgress) => void;
    open?: OpenSource;
  } = {},
): ResultAsync<RunImportOutput, TypedError.InvalidInput | TypedError.NotFound> {
  return open(from).map((opened) => {
    const run = running.then(() =>
      importFrom(opened, unique([...sourceIds]), onProgress),
    );
    running = run.catch(() => undefined);
    return run;
  });
}

async function importFrom(
  { chats }: OpenedSource,
  sourceIds: string[],
  onProgress: (progress: ImportProgress) => void,
): Promise<RunImportOutput> {
  await clearStaleImports();
  const imported = await importedChats();
  const output: RunImportOutput = { failed: [], imported: [], skipped: [] };
  const wanted: string[] = [];
  for (const sourceId of sourceIds) {
    const chatId = imported.get(importKey({ kind: chats.kind, sourceId }));
    if (chatId) {
      output.skipped.push({ chatId, sourceId });
    } else {
      wanted.push(sourceId);
    }
  }
  if (wanted.length === 0) {
    return output;
  }

  const total = wanted.length;
  const asked = new Set(wanted);
  const started = new Set<string>();
  const finished = new Set<string>();
  const finish = (sourceId: string, title: string) => {
    finished.add(sourceId);
    onProgress({ done: finished.size, title, total });
  };
  const writes = new Set<Promise<void>>();
  const write = async (
    transcript: {
      sourceId: string;
      title: string;
    },
    written: Promise<ChatId | Error>,
  ) => {
    const result = await written;
    if (result instanceof Error) {
      output.failed.push({
        error: result.message,
        sourceId: transcript.sourceId,
      });
    } else {
      output.imported.push({ chatId: result, sourceId: transcript.sourceId });
    }
    finish(transcript.sourceId, transcript.title);
  };

  let readError: string | undefined;
  try {
    for await (const transcript of chats.read(wanted)) {
      if (started.has(transcript.sourceId) || !asked.has(transcript.sourceId)) {
        continue;
      }
      started.add(transcript.sourceId);
      const written = writeImportedChat(transcript).match(
        (chatId) => chatId,
        (error) => error,
      );
      const pending = write(transcript, written).finally(() => {
        writes.delete(pending);
      });
      writes.add(pending);
      if (writes.size >= WRITES_AT_ONCE) {
        await Promise.race(writes);
      }
    }
  } catch (error) {
    readError = error instanceof Error ? error.message : String(error);
  }
  await Promise.all(writes);

  for (const sourceId of wanted) {
    if (!finished.has(sourceId)) {
      output.failed.push({
        error: readError ?? "The source no longer has this chat.",
        sourceId,
      });
      finish(sourceId, sourceId);
    }
  }
  return output;
}
