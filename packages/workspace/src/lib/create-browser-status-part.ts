import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { encodeBrowserTargetId } from "../types";
import { getBrowserState } from "./browser-state";
import { getWorkspaceConfig } from "./workspace-config";

export async function createBrowserStatusPart({
  createdAt,
  messageId,
  sessionId,
  taskId,
}: {
  createdAt: Date;
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
  taskId: TaskId;
}): Promise<SessionMessagePart.Type | undefined> {
  try {
    const targets = await getWorkspaceConfig().browser.listTargets(taskId);
    const target = targets.find(
      ({ id }) => id === encodeBrowserTargetId(taskId, sessionId),
    );

    if (target) {
      const browserStateResult = await getBrowserState(taskId, sessionId);
      if (browserStateResult.isErr()) {
        getWorkspaceConfig().captureException(browserStateResult.error);
        return undefined;
      }

      const browserState = browserStateResult.value;
      if (
        browserState?.lastUrl === target.url &&
        browserState.lastTitle === target.title
      ) {
        return undefined;
      }

      return createPart({
        createdAt,
        data: {
          status: "open",
          target: { title: target.title, url: target.url },
        },
        messageId,
        sessionId,
      });
    }

    const browserStateResult = await getBrowserState(taskId, sessionId);
    if (browserStateResult.isErr()) {
      getWorkspaceConfig().captureException(browserStateResult.error);
      return undefined;
    }

    const browserState = browserStateResult.value;
    if (!browserState) {
      return undefined;
    }

    return createPart({
      createdAt,
      data: {
        ...(browserState.lastUrl
          ? {
              previousTarget: {
                ...(browserState.lastTitle
                  ? { title: browserState.lastTitle }
                  : {}),
                url: browserState.lastUrl,
              },
            }
          : {}),
        status: "closed",
      },
      messageId,
      sessionId,
    });
  } catch (error) {
    getWorkspaceConfig().captureException(error);
    return undefined;
  }
}

function createPart({
  createdAt,
  data,
  messageId,
  sessionId,
}: {
  createdAt: Date;
  data: Extract<
    SessionMessagePart.Type,
    { type: "data-browserStatus" }
  >["data"];
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
}): SessionMessagePart.Type {
  return {
    data,
    metadata: {
      createdAt,
      id: StoreId.newPartId(),
      messageId,
      sessionId,
    },
    type: "data-browserStatus",
  };
}
