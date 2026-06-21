import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import { eventIterator } from "@orpc/server";
import { isEqual } from "radashi";
import { z } from "zod";

import { getWorkspaceAppState } from "../../../lib/get-workspace-app-state";
import { WorkspaceAppStateSchema } from "../../../schemas/app-state";
import { TaskIdSchema } from "../../../schemas/task-id";
import { base, toORPCError } from "../../base";
import { publisher } from "../../publisher";

const bySubdomain = base
  .input(z.object({ subdomain: TaskIdSchema }))
  .output(eventIterator(WorkspaceAppStateSchema))
  .handler(async function* ({ context, errors, input, signal }) {
    const { workspaceRef } = context;

    const getOrThrow = async () => {
      const result = await getWorkspaceAppState({
        subdomain: input.subdomain,
        workspaceRef,
      });

      if (result.isErr()) {
        throw toORPCError(result.error, errors);
      }

      return result.value;
    };

    let previousState = await getOrThrow();
    yield previousState;

    const relevantEvents = [
      "appState.session.added",
      "appState.session.done",
      "appState.session.tagsChanged",
    ] as const;

    const subscriptions = relevantEvents.map((eventName) =>
      publisher.subscribe(eventName, { signal }),
    );

    for await (const payload of mergeGenerators(subscriptions)) {
      if (
        "subdomain" in payload &&
        payload.subdomain !== input.subdomain &&
        !payload.subdomain.endsWith(input.subdomain)
      ) {
        continue;
      }

      const currentState = await getOrThrow();

      if (!isEqual(currentState, previousState)) {
        previousState = currentState;
        yield currentState;
      }
    }
  });

const aliveAgentCount = base
  .input(z.void())
  .output(z.object({ count: z.number() }))
  .handler(({ context }) => {
    const { sessionRefsBySubdomain } =
      context.workspaceRef.getSnapshot().context;
    let count = 0;

    for (const sessionRefs of sessionRefsBySubdomain.values()) {
      for (const sessionRef of sessionRefs) {
        if (sessionRef.getSnapshot().hasTag("agent.alive")) {
          count += 1;
        }
      }
    }

    return { count };
  });

const bySubdomains = base
  .input(z.object({ subdomains: TaskIdSchema.array() }))
  .output(WorkspaceAppStateSchema.array())
  .handler(async ({ context, errors, input }) => {
    const { workspaceRef } = context;
    const results = [];

    for (const subdomain of input.subdomains) {
      const result = await getWorkspaceAppState({
        subdomain,
        workspaceRef,
      });

      if (result.isErr()) {
        throw toORPCError(result.error, errors);
      }

      results.push(result.value);
    }

    return results;
  });

export const appState = {
  aliveAgentCount,
  bySubdomains,
  live: {
    bySubdomain,
  },
};
