import { z } from "zod";

import {
  askIdeas,
  IdeaTabSchema,
  IdeaTriggerSchema,
  ideasAvailable,
  noteIdeasPace,
} from "../../lib/ideas/ask-ideas";
import { base } from "../base";

/**
 * Ideas for the tabs in a group with no chat, or beside a new tab, on the
 * fast model of the connection new chats run on. `key` names the set of
 * tabs, so the same set answers from memory. `asked` is the person asking
 * (⌘J, a click on the corner, a new tab showing); without it the tabs
 * changing asked, and the answer may instead be when to try again.
 */
const askRoute = base
  .input(
    z.object({
      asked: z.boolean(),
      key: z.string(),
      modelURI: z.string(),
      tabs: z.array(IdeaTabSchema),
      trigger: IdeaTriggerSchema,
    }),
  )
  .output(
    z.union([
      z.object({ lines: z.array(z.string()).readonly() }),
      z.object({ retryInMs: z.number() }),
    ]),
  )
  .handler(async ({ input }) => askIdeas(input));

/** The person took an idea, or moved to another group or opened a file, which paces the ideas the tabs set off. */
const paceRoute = base
  .input(z.object({ event: z.enum(["moved", "taken"]) }))
  .handler(({ input }) => {
    noteIdeasPace(input.event);
  });

/** Whether chats started on this model have a fast model for ideas, so the window shows them at all. */
const availableRoute = base
  .input(z.object({ modelURI: z.string() }))
  .output(z.boolean())
  .handler(({ input }) => ideasAvailable(input.modelURI));

export const ideas = {
  ask: askRoute,
  available: availableRoute,
  pace: paceRoute,
};
