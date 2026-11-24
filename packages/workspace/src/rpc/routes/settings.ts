import { z } from "zod";

import { ChangesCardSchema, markCardUndone } from "../../lib/chat/card-undone";
import { appSettings, undoSettingChanges } from "../../lib/setting-changes";
import { SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { base } from "../base";

/**
 * Takes back what a turn's `settings` commands did, from its card's entries:
 * each setting goes back to what it held before, but for one changed since.
 */
const undoChanges = base
  .input(
    z.object({
      /** The card the Undo is on, which is marked undone. */
      card: ChangesCardSchema.optional(),
      changes: z.array(SessionMessageDataPart.SettingChangeSchema),
    }),
  )
  .output(z.object({ skipped: z.number(), undone: z.number() }))
  .handler(async ({ input }) => {
    const outcome = await undoSettingChanges(input.changes);
    if (input.card) {
      await markCardUndone(input.card, outcome);
    }
    return outcome;
  });

/** Each setting's value now, by id, for a card to tell what still stands. */
const values = base
  .output(z.record(z.string(), z.string()))
  .handler(async () =>
    Object.fromEntries(
      (await appSettings().list()).map((each) => [each.id, each.value.value]),
    ),
  );

export const settings = { undoChanges, values };
