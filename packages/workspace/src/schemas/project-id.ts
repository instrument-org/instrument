import { monotonicFactory } from "ulid";
import { z } from "zod";

const ulid = monotonicFactory();

const PREFIX = "prj_";

// via https://github.com/colinhacks/zod/blob/2c333e268c316deef829c736b8c46ec95ee03e39/packages/zod/src/v4/core/regexes.ts#L3
// cspell:ignore HJKMNP
const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

// Stable identity stored in .instrument/settings.json — NOT the folder name,
// so a folder rename never breaks task associations.
export const ProjectIdSchema = z
  .string()
  .startsWith(PREFIX)
  .check((ctx) => {
    const withoutPrefix = ctx.value.slice(PREFIX.length);
    if (!ULID_REGEX.test(withoutPrefix)) {
      ctx.issues.push({
        code: "custom",
        input: ctx.value,
        message: "Must be a valid ULID after prefix",
      });
    }
  })
  .brand("ProjectId");

export type ProjectId = z.output<typeof ProjectIdSchema>;

export function newProjectId(): ProjectId {
  return ProjectIdSchema.parse(`${PREFIX}${ulid()}`);
}
