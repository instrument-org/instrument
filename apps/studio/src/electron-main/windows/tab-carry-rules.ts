import { z } from "zod";

const FloatsSchema = z
  .array(
    z.looseObject({
      chatId: z.string().optional(),
      draftId: z.string().optional(),
    }),
  )
  .catch([]);

/** Two windows' floats as one, a chat or a draft floating in both counted once. */
export function mergeFloats(kept: unknown, more: unknown) {
  const seen = new Set<string | undefined>();
  return [...FloatsSchema.parse(kept), ...FloatsSchema.parse(more)].filter(
    ({ chatId, draftId }) => {
      const key = draftId ?? chatId;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    },
  );
}
