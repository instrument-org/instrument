import ms from "ms";
import { ok } from "neverthrow";
import { dedent } from "radashi";
import { z } from "zod";

import { setupTool } from "./create-tool";

/**
 * A control tool: it does nothing to the workspace, and exists so the user can
 * be told why a run of tool calls is happening without that explanation being
 * repeated into every one of them.
 *
 * An activity is closed by the next one starting or by the turn ending, so
 * there is no matching end call. Grouping is therefore transcript order -- the
 * calls between this part and the next activity belong to it -- rather than an
 * id carried on every tool part. That holds for one linear stream, which is
 * what a turn is today; parallel work would need the id.
 */
export const StartActivity = setupTool({
  inputSchema: z.object({
    // Deliberately the only field: the heading is one line in the transcript,
    // and a second sentence under it neither fits nor earns the tokens.
    title: z.string().meta({
      description:
        "The phase of work as a short heading, present continuous and under about eight words (e.g. 'Tracing the authentication flow', 'Charting the quarterly numbers'). Name the objective, not the individual calls.",
    }),
  }),
  name: "start_activity",
  outputSchema: z.object({}),
}).create({
  description: dedent`
    Tell the user what you are about to do, so the tool calls that follow are shown under one heading instead of as a run of unexplained steps.

    Call it once before a set of related calls, never before each one: a single activity covers the run of reads, searches, edits, or commands that serve one objective. Call it again the moment that objective changes -- exploring gives way to building, building gives way to checking the result, or something you found sends you elsewhere. A task of any length therefore has several, and a task that reports only the objective it started with has stopped saying what it is doing.

    - Call it in the same response as the first tool calls of that phase. There is nothing to wait for, and nothing to report back.
    - Every turn that uses tools opens with one, however short the turn is. A reply that uses no tools needs none.
    - About six calls is as far as one activity stretches. Past that, start the next one.
    - The user is shown the title, so do not repeat it in your reply.
  `,
  execute: () => Promise.resolve(ok({})),
  readOnly: true,
  timeoutMs: ms("1 second"),
  toModelOutput: () => {
    return {
      type: "text",
      value: "Shown to the user. Continue with the work for this activity.",
    };
  },
});
