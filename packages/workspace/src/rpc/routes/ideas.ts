import { z } from "zod";

import {
  askIdeas,
  IdeaTabSchema,
  IdeaTriggerSchema,
  ideasAvailable,
} from "../../lib/ideas/ask-ideas";
import { base } from "../base";

/**
 * Ideas for the tabs in a group with no chat, or beside a new tab, on the
 * fast model of the connection new chats run on. `key` names the set of
 * tabs, so the same set answers from memory.
 */
const askRoute = base
  .input(
    z.object({
      key: z.string(),
      modelURI: z.string(),
      tabs: z.array(IdeaTabSchema),
      trigger: IdeaTriggerSchema,
    }),
  )
  .output(z.array(z.string()).readonly())
  .handler(async ({ input }) => askIdeas(input));

/** Whether chats started on this model have a fast model for ideas, so the window shows them at all. */
const availableRoute = base
  .input(z.object({ modelURI: z.string() }))
  .output(z.boolean())
  .handler(({ input }) => ideasAvailable(input.modelURI));

export const ideas = {
  ask: askRoute,
  available: availableRoute,
};
