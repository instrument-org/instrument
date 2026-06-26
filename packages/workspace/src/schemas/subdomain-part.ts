import { z } from "zod";

export const SubdomainPartSchema = z
  .string()
  .brand("SubdomainPart")
  .superRefine(validateSubdomainPart);

export type SubdomainPart = z.output<typeof SubdomainPartSchema>;

const SUBDOMAIN_REGEX = /^[a-z0-9-]+$/;

export function validateSubdomainPart(
  subdomainPart: string,
  ctx: z.core.$RefinementCtx,
) {
  if (!subdomainPart) {
    ctx.addIssue({
      code: "custom",
      fatal: true,
      input: subdomainPart,
      message: "Folder name can't be empty",
    });
  }

  if (subdomainPart.length > 63) {
    ctx.addIssue({
      code: "custom",
      fatal: true,
      input: subdomainPart,
      message: "Folder name must be 63 characters or fewer",
    });
  }

  if (!SUBDOMAIN_REGEX.test(subdomainPart)) {
    ctx.addIssue({
      code: "custom",
      fatal: true,
      input: subdomainPart,
      message:
        "Folder name can only contain lowercase letters, numbers, and hyphens",
    });
  }
}
