import { serve, type ServerType } from "@hono/node-server";
import {
  type AIGatewayApp,
  type AIGatewayEnv,
} from "@instrument-org/ai-gateway";
import {
  AI_GATEWAY_API_PATH,
  APP_CLIENT_NAME_STUDIO,
  listenWithPortFallback,
} from "@instrument-org/shared";
import { Hono } from "hono";
import { type ActorRefFrom, type AnyEventObject, fromCallback } from "xstate";

import { type WorkspaceConfig } from "../../types";
import { DEFAULT_APPS_SERVER_PORT, LOOPBACK_HOST } from "./constants";
import { setupCdpWebSocketBridge } from "./routes/cdp-sockets";
import { type WorkspaceServerParentRef } from "./types";
import { setWorkspaceServerPort } from "./url";

/**
 * The loopback server: the CDP bridge agent-browser drives a guest through,
 * and the model proxy every in-process model call is pointed at, which is
 * where provider credentials are added. It serves no files; a page on this
 * computer opens at its `file://` address for the person and the agent alike.
 */
export const workspaceServerLogic = fromCallback<
  AnyEventObject,
  {
    aiGatewayApp?: AIGatewayApp;
    parentRef: WorkspaceServerParentRef;
    workspaceConfig: WorkspaceConfig;
  }
>(({ input }) => {
  const app = new Hono();

  if (input.aiGatewayApp) {
    app.use<string, AIGatewayEnv>(
      `${AI_GATEWAY_API_PATH}/*`,
      async (c, next) => {
        await input.workspaceConfig.refreshExpiredCredentials?.();
        c.set(
          "getAIProviderConfigs",
          input.workspaceConfig.getAIProviderConfigs,
        );
        c.set("captureException", input.workspaceConfig.captureException);
        c.set("clientInfo", {
          clientArch: process.arch,
          clientName: APP_CLIENT_NAME_STUDIO,
          clientPlatform: process.platform,
          clientVersion: input.workspaceConfig.appVersion,
        });
        await next();
      },
    );
    app.route("/", input.aiGatewayApp);
  }

  let server: null | ServerType = null;

  void listenWithPortFallback({
    basePort: DEFAULT_APPS_SERVER_PORT,
    listen: (port) =>
      serve({ fetch: app.fetch, hostname: LOOPBACK_HOST, port }),
  })
    .then(({ port, server: startedServer }) => {
      server = startedServer;
      setWorkspaceServerPort(port);

      if (port !== DEFAULT_APPS_SERVER_PORT) {
        input.workspaceConfig.captureEvent("workspace.non_default_port", {
          apps_server_port: port,
        });
      }

      // A socket error on a listening server is otherwise unhandled, and an
      // unhandled one in the main process takes the app down with it.
      startedServer.on("error", (error) => {
        input.workspaceConfig.captureException(
          new Error("Workspace server error", { cause: error }),
        );
      });

      setupCdpWebSocketBridge(
        startedServer,
        input.workspaceConfig,
        input.parentRef,
      );

      input.parentRef.send({
        type: "workspaceServer.started",
        value: { port },
      });
    })
    .catch((error: unknown) => {
      input.parentRef.send({
        type: "workspaceServer.error",
        value: {
          error: new Error("Failed to start the workspace server", {
            cause: error,
          }),
        },
      });
    });

  return () => {
    if (server) {
      server.close();
    }
  };
});

export type WorkspaceServerActorRef = ActorRefFrom<typeof workspaceServerLogic>;
