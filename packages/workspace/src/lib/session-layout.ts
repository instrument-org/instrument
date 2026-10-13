import { type ChatId } from "../schemas/chat-id";
import { type MountedFolder } from "../schemas/mounted-folder";
import { type StoreId } from "../schemas/store-id";
import { sessionRole } from "./chat/children";
import { chatReach } from "./permissions/chat-rules";
import { type Rules } from "./permissions/rules";
import { workDir } from "./work-dir";
import {
  buildWorkspaceFsLayout,
  type WorkspaceFsLayout,
} from "./workspace-fs-layout";

/**
 * What a session of this role reaches, from folders and rules already read:
 * the chat's own folder (the working directory), the folders the chat
 * reaches, the skills, the temp folders, and for the chat its apps. The
 * chat authors apps, so it gets their folder; a task reaches the apps it was
 * handed through the `app` command alone.
 *
 * The shell builds its layout here because it reads its folders on the main
 * thread and its rules where it runs; everything else calls
 * {@link sessionLayout}.
 */
export function roleLayout({
  chatId,
  folders,
  role,
  rules,
}: {
  chatId: ChatId;
  folders?: Record<string, MountedFolder.Type>;
  role: "chat" | "task";
  rules?: Rules;
}): WorkspaceFsLayout {
  return buildWorkspaceFsLayout({
    apps: role === "chat",
    folders,
    rules,
    taskHostRoot: workDir(chatId),
  });
}

/**
 * What a session reaches as it stands now, held to its chat's rules. A
 * session's refusals that ask first raise their card in it, under `partId`
 * when given. Without a session it is what the chat reaches, which is what a
 * surface the person looks at resolves against.
 */
export async function sessionLayout({
  chatId,
  partId,
  sessionId,
}: {
  chatId: ChatId;
  partId?: StoreId.Part;
  sessionId?: StoreId.Session;
}): Promise<WorkspaceFsLayout> {
  return roleLayout({
    chatId,
    role: sessionId ? (sessionRole(chatId, sessionId) ?? "task") : "chat",
    ...(await chatReach(chatId, sessionId, partId)),
  });
}
