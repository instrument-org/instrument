import { monotonicFactory } from "ulid";
import { z } from "zod";

const ulid = monotonicFactory();

const PREFIXES = {
  message: "msg_",
  part: "prt_",
  partContextItem: "pci_",
  session: "ses_",
} as const;

// via https://github.com/colinhacks/zod/blob/2c333e268c316deef829c736b8c46ec95ee03e39/packages/zod/src/v4/core/regexes.ts#L3
// cspell:ignore HJKMNP
const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

function createIdSchema<T extends string>(prefix: string, brandName: T) {
  return z
    .string()
    .startsWith(prefix)
    .check((ctx) => {
      const withoutPrefix = ctx.value.slice(prefix.length);
      if (!ULID_REGEX.test(withoutPrefix)) {
        ctx.issues.push({
          code: "custom",
          input: ctx.value,
          message: "Must be a valid ULID after prefix",
        });
      }
    })
    .brand(brandName);
}

export namespace StoreId {
  export const SessionSchema = createIdSchema(PREFIXES.session, "SessionId");
  export type Session = z.output<typeof SessionSchema>;

  export const MessageSchema = createIdSchema(
    PREFIXES.message,
    "SessionMessageId",
  );
  export type Message = z.output<typeof MessageSchema>;

  export const PartSchema = createIdSchema(
    PREFIXES.part,
    "SessionMessagePartId",
  );
  export type Part = z.output<typeof PartSchema>;

  // Identifies a single ToolPartContextItem so it can be upserted on the
  // owning part's metadata (e.g. start an agent-browser observation as
  // `pending`, then transition the same item to `complete`). Not used as a
  // storage key today; lives on the part alongside other context items.
  export const PartContextItemSchema = createIdSchema(
    PREFIXES.partContextItem,
    "SessionMessagePartContextItemId",
  );
  export type PartContextItem = z.output<typeof PartContextItemSchema>;

  export const ToolCallSchema = z.string().brand("ToolCallId");
  export type ToolCall = z.output<typeof ToolCallSchema>;

  export function newMessageId() {
    return StoreId.MessageSchema.parse(`${PREFIXES.message}${ulid()}`);
  }

  export function newPartContextItemId() {
    return StoreId.PartContextItemSchema.parse(
      `${PREFIXES.partContextItem}${ulid()}`,
    );
  }

  export function newPartId() {
    return StoreId.PartSchema.parse(`${PREFIXES.part}${ulid()}`);
  }

  export function newSessionId() {
    return StoreId.SessionSchema.parse(`${PREFIXES.session}${ulid()}`);
  }
}
