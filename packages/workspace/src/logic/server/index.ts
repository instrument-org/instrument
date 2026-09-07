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
import invariant from "tiny-invariant";
import { type ActorRefFrom, type AnyEventObject, fromCallback } from "xstate";

import { type AbsolutePath } from "../../schemas/paths";
import { type TaskId } from "../../schemas/task-id";
import { type WorkspaceConfig } from "../../types";
import { DEFAULT_APPS_SERVER_PORT, LOOPBACK_HOST } from "./constants";
import { allProxyRoute } from "./routes/all-proxy";
import { assetsRoute } from "./routes/assets";
import { cdpBridgeRoute, setupCdpWebSocketBridge } from "./routes/cdp-bridge";
import { heartbeatRoute } from "./routes/heartbeat";
import { redirectRoute } from "./routes/redirect";
import { shimIFrameRoute } from "./routes/shim-iframe";
import { shimScriptRoute } from "./routes/shim-script";
import {
  type WorkspaceServerEnv,
  type WorkspaceServerParentRef,
} from "./types";
import { setWorkspaceServerPort } from "./url";
import { setupWebSocketProxy } from "./websocket-proxy";

export const workspaceServerLogic = fromCallback<
  AnyEventObject,
  {
    aiGatewayApp?: AIGatewayApp;
    parentRef: WorkspaceServerParentRef;
    shimClientDir: "dev-server" | AbsolutePath;
    workspaceConfig: WorkspaceConfig;
  }
>(({ input }) => {
  const app = new Hono<WorkspaceServerEnv>();

  app.use(async (c, next) => {
    function getRuntimeRef(id: TaskId) {
      const snapshot = input.parentRef.getSnapshot();
      invariant(snapshot, "Workspace not found");
      return snapshot.context.runtimeRefs.get(id);
    }
    c.set("parentRef", input.parentRef);
    c.set("workspaceConfig", input.workspaceConfig);
    c.set("getRuntimeRef", getRuntimeRef);
    c.set("shimClientDir", input.shimClientDir);
    await next();
  });

  // Asset origins own their entire root, so claim them before app-runtime and
  // infrastructure routes inspect the request.
  app.route("/", assetsRoute);
  app.route("/", shimScriptRoute);
  app.route("/", shimIFrameRoute);
  app.route("/", heartbeatRoute);
  app.route("/", redirectRoute);
  app.route("/", cdpBridgeRoute);
  // Note: Must be after all app-specific routes
  app.route("/", allProxyRoute);
  if (input.aiGatewayApp) {
    app.use<string, AIGatewayEnv>(
      `${AI_GATEWAY_API_PATH}/*`,
      async (c, next) => {
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

      setupWebSocketProxy(startedServer, input.parentRef);
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
