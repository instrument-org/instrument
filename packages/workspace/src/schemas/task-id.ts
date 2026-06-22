import { z } from "zod";

import { type SubdomainPart, validateSubdomainPart } from "./subdomain-part";

// A task id. It doubles as the on-disk folder name and, for the local asset
// server, a DNS-valid id label — but those are implementation details;
// callers treat it as an opaque id.
export type TaskId = SubdomainPart & z.$brand<"TaskId">;

function ensureString(val: unknown, ctx: z.core.$RefinementCtx): val is string {
  if (typeof val !== "string") {
    ctx.addIssue({
      code: "custom",
      fatal: true,
      input: val,
      message: "Task id must be a string",
    });
    return false;
  }
  return true;
}

export const TaskIdSchema = z
  .custom<TaskId>()
  .superRefine((val: unknown, ctx) => {
    if (!ensureString(val, ctx)) {
      return;
    }

    if (val.includes(".")) {
      ctx.addIssue({
        code: "custom",
        fatal: true,
        input: val,
        message: "Task ids cannot contain dots",
      });
    }

    validateSubdomainPart(val, ctx);
  });
