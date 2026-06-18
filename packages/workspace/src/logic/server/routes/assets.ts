import { Hono } from "hono";
import { cors } from "hono/cors";

import { absolutePathJoin } from "../../../lib/absolute-path-join";
import { createAppConfig } from "../../../lib/app-config/create";
import { APPS_SERVER_API_PATH } from "../constants";
import { serveStaticFile } from "../serve-static";
import { type WorkspaceServerEnv } from "../types";
import { uriDetailsForHost } from "../uri-details-for-host";

// Blocks `.`/`..` segments, consecutive slashes, and backslashes (hono/node-server's traversal check).
const UNSAFE_PATH_SEGMENT_REGEX = /(?:^|[/\\])\.{1,2}(?:$|[/\\])|[/\\]{2,}|\\/;

const app = new Hono<WorkspaceServerEnv>().basePath(APPS_SERVER_API_PATH);

app.use("/assets/*", cors());

app.get("/assets/*", async (c) => {
  const uriDetails = uriDetailsForHost(c.req.header("host") || "");

  if (uriDetails.isErr()) {
    return c.notFound();
  }

  const { subdomain } = uriDetails.value;
  const appConfig = createAppConfig({
    subdomain,
    workspaceConfig: c.var.workspaceConfig,
  });

  const assetPath = c.req.path.replace(`${APPS_SERVER_API_PATH}/assets/`, "");

  if (!assetPath || UNSAFE_PATH_SEGMENT_REGEX.test(assetPath)) {
    return c.notFound();
  }

  const fullPath = absolutePathJoin(appConfig.appDir, assetPath);

  const result = await serveStaticFile(c, {
    filePath: fullPath,
  });

  if (!result) {
    return c.notFound();
  }

  return result;
});

export const assetsRoute = app;
