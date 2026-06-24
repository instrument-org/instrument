import { monotonicFactory } from "ulid";
import { z } from "zod";

const ulid = monotonicFactory();

const PREFIX = "prj_";

// via https://github.com/colinhacks/zod/blob/2c333e268c316deef829c736b8c46ec95ee03e39/packages/zod/src/v4/core/regexes.ts#L3
// cspell:ignore HJKMNP
const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

// A project's stable identity. Unlike a TaskId, this is NOT the on-disk folder
// name (projects are foldered by their human-readable name); it lives inside the
// project's `.instrument/settings.json` and is what tasks reference, so a folder
// rename never breaks associations.
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
