import { type StoreId } from "../schemas/store-id";
import { type AppConfigProject } from "./app-config/types";
import { isDefaultGeneratedSessionTitle } from "./generate-session-title";
import { Store } from "./store";

export async function updateSessionTitle({
  appConfig,
  sessionId,
  title,
}: {
  appConfig: AppConfigProject;
  sessionId: StoreId.Session;
  title: string;
}) {
  const storedSession = await Store.getSession(sessionId, appConfig);
  if (
    storedSession.isErr() ||
    !isDefaultGeneratedSessionTitle(storedSession.value.title)
  ) {
    return;
  }
  const renameResult = await Store.saveSession(
    {
      ...storedSession.value,
      title,
      updatedAt: new Date(),
    },
    appConfig,
  );
  if (renameResult.isErr()) {
    appConfig.workspaceConfig.captureException(renameResult.error);
  }
}
