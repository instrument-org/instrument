import { eventIterator } from "@orpc/server";
import { z } from "zod";

import {
  killBackgroundProcess,
  listTaskBackgroundProcesses,
} from "../../../lib/background-processes";
import { StoreId } from "../../../schemas/store-id";
import { type ChatId, ChatIdSchema } from "../../../schemas/chat-id";
import { base } from "../../base";
import { publisher } from "../../publisher";

const RunningProcessSchema = z.object({
  command: z.string(),
  /** The agent's label for the call that started it; absent when it wrote none. */
  explanation: z.string().optional(),
  id: z.string(),
  startedAt: z.date(),
});

/** Which processes a call names: a record's, or one session's of it. */
const OwnerSchema = z.object({
  id: ChatIdSchema,
  /** A task's session, or the chat's own, for that session's alone. */
  sessionId: StoreId.SessionSchema.optional(),
});

/**
 * Every process a record has, or only those of one session of it: a chat's
 * tasks run in its record, each with its own.
 */
function processesOf({
  id,
  sessionId,
}: {
  id: ChatId;
  sessionId?: StoreId.Session;
}) {
  return listTaskBackgroundProcesses(id).filter(
    (process) => sessionId === undefined || process.sessionId === sessionId,
  );
}

/**
 * Only what is running. A finished record is kept in the registry so a late read
 * still finds its exit code, but a user is being shown what to stop, and a list
 * that also holds things which already stopped is a list they have to read
 * rather than glance at.
 */
const list = base
  .input(OwnerSchema)
  .output(z.array(RunningProcessSchema))
  .handler(({ input }) =>
    processesOf(input)
      .filter((process) => process.status === "running")
      .map((process) => ({
        command: process.command,
        explanation: process.explanation,
        id: process.id,
        startedAt: process.startedAt,
      })),
  );

/**
 * Stops one, on the user's behalf rather than the agent's, so it takes the task
 * and finds the owning session itself: sessions are the registry's ownership
 * unit and are not a thing the user knows exists.
 */
const stop = base
  .input(OwnerSchema.extend({ processId: z.string() }))
  .output(z.object({ stopped: z.boolean() }))
  .handler(async ({ input }) => {
    const process = processesOf(input).find(({ id }) => id === input.processId);
    if (!process) {
      return { stopped: false };
    }
    const killed = await killBackgroundProcess({
      by: "user",
      id: process.id,
      sessionId: process.sessionId,
    });
    return { stopped: killed?.terminationConfirmed ?? false };
  });

const stopAll = base
  .input(OwnerSchema)
  .output(z.object({ stopped: z.number() }))
  .handler(async ({ input }) => {
    const running = processesOf(input).filter(
      (process) => process.status === "running",
    );
    const results = await Promise.all(
      running.map((process) =>
        killBackgroundProcess({
          by: "user",
          id: process.id,
          sessionId: process.sessionId,
        }),
      ),
    );
    return {
      stopped: results.filter((result) => result?.stoppedByThisCall).length,
    };
  });

/**
 * A revision counter rather than the list itself: the surfaces that show this
 * read `list`, and one of them is a popover that is usually closed.
 *
 * Revision 0 is emitted as soon as the subscription is live. A live query whose
 * stream ends without yielding is an error to the client runtime, and events
 * published while nothing was subscribed are gone, so an opening event is both
 * what keeps the stream valid and the consumer's resync point.
 */
const changed = base
  .input(z.object({ id: ChatIdSchema }))
  .output(eventIterator(z.object({ revision: z.number() })))
  .handler(async function* ({ input, signal }) {
    const changes = publisher.subscribe("backgroundProcesses.changed", {
      signal,
    });
    let revision = 0;
    yield { revision };
    for await (const event of changes) {
      if (event.id !== input.id) {
        continue;
      }
      revision += 1;
      yield { revision };
    }
  });

export const taskBackgroundProcesses = {
  events: { changed },
  list,
  stop,
  stopAll,
};
