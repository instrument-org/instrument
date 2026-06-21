import {
  type SessionMessagePart,
} from "../schemas/session/message-part";
import {
  StoreId,
} from "../schemas/store-id";
import {
  encodeBrowserTargetId,
} from "../types";
import {
  type AppConfigProject,
} from "./app-config/types";
import {
  getBrowserState,
} from "./browser-state";
import {
  getWorkspaceConfig,
} from "./workspace-config";

export async function createBrowserStatusPart({
  appConfig,
  createdAt,
  messageId,
  sessionId,
}: {
  appConfig: AppConfigProject;
  createdAt: Date;
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
}): Promise<SessionMessagePart.Type | undefined> {
  try {
    const targets = await getWorkspaceConfig().browser.listTargets(appConfig);
    const target = targets.find(
      ({ id }) => id === encodeBrowserTargetId(appConfig, sessionId),
    );

    if (target) {
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

    const browserStateResult = await getBrowserState(appConfig, sessionId);
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
