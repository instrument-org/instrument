import { call, eventIterator } from "@orpc/server";
import { z } from "zod";

import {
  CurrentFileInfoSchema,
  getCurrentFileInfo,
} from "../../../lib/get-file-info";
import {
  getProjectFiles,
  ProjectFilesSchema,
} from "../../../lib/get-project-files";
import { getCurrentProjectFiles } from "../../../lib/project-file-watcher";
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
    // Serve the live in-memory index when a watcher is active; otherwise fall
    // back to a fresh walk of disk.
    const live = getCurrentProjectFiles(projectSubdomain);
    if (live) {
      return live;
    }

    const result = await getProjectFiles(
      projectSubdomain,
      context.workspaceConfig,
    );

    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }

    return result.value;
  });

const live = base
  .input(
    z.object({
      projectSubdomain: ProjectSubdomainSchema,
    }),
  )
  .output(eventIterator(ProjectFilesSchema))
  .handler(async function* ({ context, input, signal }) {
    yield call(list, input, { context, signal });

    const changes = publisher.subscribe("project.files.changed", { signal });
    for await (const payload of changes) {
      if (payload.subdomain === input.projectSubdomain) {
        yield call(list, input, { context, signal });
      }
    }
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
  live,
};
