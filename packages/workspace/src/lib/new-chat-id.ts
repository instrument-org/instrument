import { type SubdomainPart } from "../schemas/subdomain-part";
import { type ChatId, ChatIdSchema } from "../schemas/chat-id";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { generateTaskFolderName } from "./generate-task-folder-name";
import { pathExists } from "./path-exists";
import { chatIdTaken } from "./record-folders";

export async function newChatId({
  preferredFolderName,
  prompt,
  workspaceConfig,
}: {
  preferredFolderName?: SubdomainPart;
  prompt?: string;
  workspaceConfig: WorkspaceConfig;
}): Promise<ChatId> {
  if (
    preferredFolderName &&
    !chatIdTaken(preferredFolderName) &&
    !(await pathExists(
      absolutePathJoin(workspaceConfig.tasksDir, preferredFolderName),
    ))
  ) {
    return ChatIdSchema.parse(preferredFolderName);
  }

  const rawId = await generateTaskFolderName({
    prompt,
    tasksDir: workspaceConfig.tasksDir,
  });

  return ChatIdSchema.parse(rawId);
}
