import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import { call, eventIterator } from "@orpc/server";
import { z } from "zod";

import { FileInfoSchema, getFileInfo } from "../../../lib/get-file-info";
import {
  getProjectFiles,
  ProjectFilesSchema,
} from "../../../lib/get-project-files";
import { RelativeProjectPathSchema } from "../../../schemas/paths";
import { ProjectSubdomainSchema } from "../../../schemas/subdomains";
import { base, toORPCError } from "../../base";
import { publisher } from "../../publisher";

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
  .output(FileInfoSchema)
  .handler(({ errors, input: { filePath, projectSubdomain } }) => {
    const result = getFileInfo({
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
  live: {
    list: base
      .input(
        z.object({
          projectSubdomain: ProjectSubdomainSchema,
        }),
      )
      .output(eventIterator(ProjectFilesSchema))
      .handler(async function* ({ context, input, signal }) {
        yield call(list, input, { context, signal });

        const fileChanges = publisher.subscribe("project.files.changed", {
          signal,
        });
        const partUpdates = publisher.subscribe("part.updated", { signal });

        for await (const payload of mergeGenerators([
          fileChanges,
          partUpdates,
        ])) {
          if (payload.subdomain !== input.projectSubdomain) {
            continue;
          }

          if (
            "part" in payload &&
            payload.part.type !== "data-attachments" &&
            payload.part.type !== "data-fileChanges"
          ) {
            continue;
          }

          yield call(list, input, { context, signal });
        }
      }),
  },
};
