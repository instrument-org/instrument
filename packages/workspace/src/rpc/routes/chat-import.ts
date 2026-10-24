import { eventIterator } from "@orpc/server";

import {
  ImportProgressSchema,
  ListCandidatesInputSchema,
  ListCandidatesOutputSchema,
  ListSourcesOutputSchema,
  RunImportInputSchema,
  RunImportOutputSchema,
} from "../../lib/chat-import/model";
import { listCandidates, runImport } from "../../lib/chat-import/run";
import { listSources } from "../../lib/chat-import/sources";
import { base, toORPCError } from "../base";
import { publisher } from "../publisher";

/** What this computer has to import chats from. */
const sources = base
  .output(ListSourcesOutputSchema)
  .handler(() => listSources());

/** Every chat a source has, newest first, marked where it is already here. */
const list = base
  .input(ListCandidatesInputSchema)
  .output(ListCandidatesOutputSchema)
  .handler(async ({ errors, input }) => {
    const listed = await listCandidates(input.from);
    if (listed.isErr()) {
      throw toORPCError(listed.error, errors);
    }
    return listed.value;
  });

/**
 * Brings the picked chats in, answering once each has landed, been skipped
 * as already here, or failed. `events.progress` says how far it is.
 */
const run = base
  .input(RunImportInputSchema)
  .output(RunImportOutputSchema)
  .handler(async ({ errors, input }) => {
    const result = await runImport(input);
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
    return result.value;
  });

/** One event per chat an import run finishes, from whichever run is going. */
const progress = base
  .output(eventIterator(ImportProgressSchema))
  .handler(async function* ({ signal }) {
    yield* publisher.subscribe("chatImport.progress", { signal });
  });

export const chatImport = {
  events: { progress },
  list,
  run,
  sources,
};
