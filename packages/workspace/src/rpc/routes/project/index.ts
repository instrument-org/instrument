import { z } from "zod";

import { getProject } from "../../../lib/project";
import { ProjectSchema } from "../../../schemas/project";
import { ProjectIdSchema } from "../../../schemas/project-id";
import { base, toORPCError } from "../../base";

/**
 * What a 1.x task's transcript names when it says which project it worked
 * in. Projects are only read now, for tasks made before chats replaced them.
 */
const byId = base
  .input(z.object({ id: ProjectIdSchema }))
  .output(ProjectSchema)
  .handler(async ({ errors, input }) => {
    const result = await getProject(input.id);
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
    return result.value;
  });

export const project = {
  byId,
};
