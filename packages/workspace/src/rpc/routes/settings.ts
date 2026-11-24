import { z } from "zod";

import { thisDevice } from "../../lib/chat/asks";
import { ChangesCardSchema, markCardUndone } from "../../lib/chat/card-undone";
import { appSettings, undoSettingChanges } from "../../lib/setting-changes";
import { DeviceIdSchema } from "../../schemas/device-id";
import { SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { base } from "../base";

/**
 * Takes back what a turn's `settings` commands did, from its card's entries:
 * each setting goes back to what it held before, but for one changed since. A
 * setting is one computer's, so a card from another undoes nothing here.
 */
const undoChanges = base
  .input(
    z.object({
      /** The card the Undo is on, which is marked undone. */
      card: ChangesCardSchema.optional(),
      changes: z.array(SessionMessageDataPart.SettingChangeSchema),
      /** The computer the changes were made on. */
      device: DeviceIdSchema.optional(),
    }),
  )
  .output(z.object({ skipped: z.number(), undone: z.number() }))
  .handler(async ({ input }) => {
    if (input.device !== thisDevice()) {
      return { skipped: input.changes.length, undone: 0 };
    }
    const outcome = await undoSettingChanges(input.changes);
    if (input.card) {
      await markCardUndone(input.card, outcome);
    }
    return outcome;
  });

/**
 * Each setting's value now, by id, for a card to tell what still stands, or
 * null where the card's changes were made on another computer.
 */
const values = base
  .input(z.object({ device: DeviceIdSchema.optional() }))
  .output(z.record(z.string(), z.string()).nullable())
  .handler(async ({ input }) =>
    input.device === thisDevice()
      ? Object.fromEntries(
          (await appSettings().list()).map((each) => [
            each.id,
            each.value.value,
          ]),
        )
      : null,
  );

export const settings = { undoChanges, values };
