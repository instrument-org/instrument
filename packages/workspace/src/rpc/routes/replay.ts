import { call, eventIterator } from "@orpc/server";
import { z } from "zod";

import { ActiveReplays } from "../../lib/active-replays";
import { StoreId } from "../../schemas/store-id";
import { ProjectSubdomainSchema } from "../../schemas/subdomains";
import { base } from "../base";
import { publisher } from "../publisher";

const cancel = base
  .input(
    z.object({
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(z.void())
  .handler(({ input }) => {
    const subdomain = ActiveReplays.getSubdomain(input.sessionId);
    ActiveReplays.cancel(input.sessionId);
    if (subdomain) {
      publisher.publish("replay.changed", {
        isActive: false,
        sessionId: input.sessionId,
        subdomain,
      });
    }
  });

const status = base
  .input(z.object({ sessionId: StoreId.SessionSchema }))
  .output(z.object({ isActive: z.boolean() }))
  .handler(({ input }) => {
    return { isActive: ActiveReplays.isActive(input.sessionId) };
  });

const live = {
  status: base
    .input(z.object({ sessionId: StoreId.SessionSchema }))
    .output(eventIterator(z.object({ isActive: z.boolean() })))
    .handler(async function* ({ context, input, signal }) {
      yield call(status, input, { context, signal });

      for await (const payload of publisher.subscribe("replay.changed", {
        signal,
      })) {
        if (payload.sessionId === input.sessionId) {
          yield { isActive: payload.isActive };
        }
      }
    }),
  statusBySubdomain: base
    .input(z.object({ subdomain: ProjectSubdomainSchema }))
    .output(
      eventIterator(
        z.object({ activeSessionIds: z.array(StoreId.SessionSchema) }),
      ),
    )
    .handler(async function* ({ input, signal }) {
      yield {
        activeSessionIds: ActiveReplays.getActiveSessionIds(input.subdomain),
      };

      for await (const payload of publisher.subscribe("replay.changed", {
        signal,
      })) {
        if (payload.subdomain === input.subdomain) {
          yield {
            activeSessionIds: ActiveReplays.getActiveSessionIds(
              input.subdomain,
            ),
          };
        }
      }
    }),
};

export const replay = { cancel, live, status };
