import { eventIterator } from "@orpc/server";
import { z } from "zod";

import {
  killBackgroundProcess,
  listTaskBackgroundProcesses,
} from "../../../lib/background-processes";
import { TaskIdSchema } from "../../../schemas/task-id";
import { base } from "../../base";
import { publisher } from "../../publisher";

const RunningProcessSchema = z.object({
  command: z.string(),
  id: z.string(),
  startedAt: z.date(),
});

/**
 * Only what is running. A finished record is kept in the registry so a late read
 * still finds its exit code, but a user is being shown what to stop, and a list
 * that also holds things which already stopped is a list they have to read
 * rather than glance at.
 */
const list = base
  .input(z.object({ id: TaskIdSchema }))
  .output(z.array(RunningProcessSchema))
  .handler(({ input }) =>
    listTaskBackgroundProcesses(input.id)
      .filter((process) => process.status === "running")
      .map((process) => ({
        command: process.command,
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
  .input(z.object({ id: TaskIdSchema, processId: z.string() }))
  .output(z.object({ stopped: z.boolean() }))
  .handler(async ({ input }) => {
    const process = listTaskBackgroundProcesses(input.id).find(
      ({ id }) => id === input.processId,
    );
    if (!process) {
      return { stopped: false };
    }
    const killed = await killBackgroundProcess({
      id: process.id,
      sessionId: process.sessionId,
    });
    return { stopped: killed?.terminationConfirmed ?? false };
  });

const stopAll = base
  .input(z.object({ id: TaskIdSchema }))
  .output(z.object({ stopped: z.number() }))
  .handler(async ({ input }) => {
    const running = listTaskBackgroundProcesses(input.id).filter(
      (process) => process.status === "running",
    );
    const results = await Promise.all(
      running.map((process) =>
        killBackgroundProcess({ id: process.id, sessionId: process.sessionId }),
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
  .input(z.object({ id: TaskIdSchema }))
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
