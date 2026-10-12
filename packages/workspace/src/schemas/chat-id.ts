import { z } from "zod";

import { type SubdomainPart, validateSubdomainPart } from "./subdomain-part";

/**
 * A chat's id: the name of its folder under `chats/`. A chat is the only
 * record, so this is the id its store, its folder, its settings and its
 * session machine go by. A task is a session in the chat's store, named by
 * its `SessionId`, never by an id of this kind.
 */
export type ChatId = SubdomainPart & z.$brand<"ChatId">;

export const ChatIdSchema = z
  .custom<ChatId>()
  .superRefine((val: unknown, ctx) => {
    if (typeof val !== "string") {
      ctx.addIssue({
        code: "custom",
        fatal: true,
        input: val,
        message: "Chat id must be a string",
      });
      return;
    }
    if (val.includes(".")) {
      ctx.addIssue({
        code: "custom",
        fatal: true,
        input: val,
        message: "Folder name can't contain dots",
      });
    }
    validateSubdomainPart(val, ctx);
  });
