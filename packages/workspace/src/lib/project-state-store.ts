import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import fs from "node:fs/promises";
import { z } from "zod";

import { FolderAttachment } from "../schemas/folder-attachment";
import { type AbsolutePath, type TaskDir } from "../schemas/paths";
import { absolutePathJoin } from "./absolute-path-join";
import { getTaskPrivateDir } from "./app-dir-utils";

const PROJECT_STATE_FILE_NAME = "project-state.json";

const StoredProjectStateSchema = z
  .object({
    attachedFolders: z.record(z.string(), FolderAttachment.Schema).optional(),
    promptDraft: z.string().optional(),
    selectedModelURI: z.string().optional(),
    showTutorial: z.boolean().optional(),
  })
  .default(() => ({}));

export const ProjectStateSchema = z.object({
  attachedFolders: z.record(z.string(), FolderAttachment.Schema).optional(),
  promptDraft: z.string().optional(),
  selectedModelURI: AIGatewayModelURI.Schema.optional(),
  showTutorial: z.boolean().optional(),
});

export type ProjectState = z.output<typeof StoredProjectStateSchema>;

export async function getProjectState(dir: TaskDir): Promise<ProjectState> {
  const stateFilePath = getProjectStateFilePath(dir);

  try {
    const content = await fs.readFile(stateFilePath, "utf8");
    const rawState = JSON.parse(content) as unknown;
    return StoredProjectStateSchema.parse(rawState);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return StoredProjectStateSchema.parse({});
    }
    return StoredProjectStateSchema.parse({});
  }
}

export async function setProjectState(
  dir: TaskDir,
  state: Partial<ProjectState>,
): Promise<void> {
  const stateFilePath = getProjectStateFilePath(dir);
  const privateDir = getTaskPrivateDir(dir);

  await fs.mkdir(privateDir, { recursive: true });

  const currentState = await getProjectState(dir);

  const newState = StoredProjectStateSchema.parse({
    ...currentState,
    ...state,
  });

  await fs.writeFile(stateFilePath, JSON.stringify(newState, null, 2), "utf8");
}

function getProjectStateFilePath(dir: TaskDir): AbsolutePath {
  return absolutePathJoin(getTaskPrivateDir(dir), PROJECT_STATE_FILE_NAME);
}
