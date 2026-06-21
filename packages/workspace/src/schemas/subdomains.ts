import { z } from "zod";

import { type SubdomainPart, validateSubdomainPart } from "./subdomain-part";

export type ProjectSubdomain = SubdomainPart & z.$brand<"ProjectSubdomain">;

function ensureString(val: unknown, ctx: z.core.$RefinementCtx): val is string {
  if (typeof val !== "string") {
    ctx.addIssue({
      code: "custom",
      fatal: true,
      input: val,
      message: "Subdomain must be a string",
    });
    return false;
  }
  return true;
}

export const ProjectSubdomainSchema = z
  .custom<ProjectSubdomain>()
  .superRefine((val: unknown, ctx) => {
    if (!ensureString(val, ctx)) {
      return;
    }

    if (val.includes(".")) {
      ctx.addIssue({
        code: "custom",
        fatal: true,
        input: val,
        message: "Task subdomains cannot contain dots",
      });
    }

    validateSubdomainPart(val, ctx);
  });

// Previews were removed; an app subdomain is always a project (task) subdomain.
export const AppSubdomainSchema = ProjectSubdomainSchema;

export type AppSubdomain = z.output<typeof AppSubdomainSchema>;
