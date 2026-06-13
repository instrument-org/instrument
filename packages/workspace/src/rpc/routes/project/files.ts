import { z } from "zod";

import {
  CurrentFileInfoSchema,
  getCurrentFileInfo,
} from "../../../lib/get-file-info";
import {
  getProjectFiles,
  ProjectFilesSchema,
} from "../../../lib/get-project-files";
import { RelativeProjectPathSchema } from "../../../schemas/paths";
import { ProjectSubdomainSchema } from "../../../schemas/subdomains";
import { base, toORPCError } from "../../base";

const list = base
  .input(
    z.object({
      projectSubdomain: ProjectSubdomainSchema,
    }),
  )
  .output(ProjectFilesSchema)
  .handler(async ({ context, errors, input: { projectSubdomain } }) => {
    const result = await getProjectFiles(
      projectSubdomain,
      context.workspaceConfig,
    );

    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }

    return result.value;
  });

const fileInfo = base
  .input(
    z.object({
      filePath: RelativeProjectPathSchema,
      projectSubdomain: ProjectSubdomainSchema,
    }),
  )
  .output(CurrentFileInfoSchema)
  .handler(({ errors, input: { filePath, projectSubdomain } }) => {
    const result = getCurrentFileInfo({
      filePath,
      projectSubdomain,
    });

    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }

    return result.value;
  });

export const projectFiles = {
  fileInfo,
  list,
};
