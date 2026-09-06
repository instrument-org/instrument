import { startAuthCallbackServer } from "@/electron-main/auth/server";
import { base } from "@/electron-main/rpc/base";
import { appConnectionStore } from "@/electron-main/stores/app-connections";
import {
  hasAppCredential,
  setAppCredential,
} from "@/electron-main/stores/app-credentials";
import { appOAuthStore } from "@/electron-main/stores/app-oauth";
import {
  AppConnectionSchema,
  appHomeFor,
  appSiteFor,
  AppSlugSchema,
  beginMcpOAuth,
  cancelMcpOAuth,
  getAppCatalog,
  isConnected,
  listApps,
  listMcpTools,
  loadApp,
  mcpAuthProviderForCommand,
  mcpConnectionConfig,
  readAppGuide,
  recordConnection,
  runAppTest,
  withMcpClient,
  workspacePublisher,
} from "@instrument-org/workspace/electron";
import { call, eventIterator } from "@orpc/server";
import { z } from "zod";

import {
  announceConnected,
  appName,
  appOAuthRedirectUrl,
  disconnectApp,
} from "../../lib/apps";

/** Where an app stands, as the Apps screen draws it. */
const AppStandingSchema = z.enum([
  "connected",
  "declined",
  "failed",
  "needs-key",
  "needs-sign-in",
  // A manifest the agent edited since the connection passed.
  "stale",
  "untested",
]);

const AppListItemSchema = z.object({
  authKind: z.string(),
  connection: AppConnectionSchema.optional(),
  /** API base URL or MCP server URL, by `type`. */
  endpoint: z.string(),
  hasCredential: z.boolean(),
  hasGuide: z.boolean(),
  /** The signed-in web app, for the page's primary action. */
  home: z.string().optional(),
  name: z.string(),
  /** The service's origin, for its icon. */
  site: z.string().optional(),
  slug: z.string(),
  standing: AppStandingSchema,
  type: z.enum(["api", "mcp"]),
});

const AppListSchema = z.object({
  apps: z.array(AppListItemSchema),
  invalid: z.array(z.object({ message: z.string(), slug: z.string() })),
});

const list = base.output(AppListSchema).handler(async ({ context }) => {
  const { apps, invalid } = await listApps(context.workspaceConfig.appsDir);
  const connections = await appConnectionStore.list();
  return {
    apps: await Promise.all(
      apps.map(async (app) => {
        const connection = connections[app.slug];
        const standing =
          connection === undefined
            ? "untested"
            : connection.status === "connected"
              ? isConnected(connection, app.manifestHash)
                ? "connected"
                : "stale"
              : connection.status;
        return {
          authKind: app.manifest.auth.kind,
          connection,
          endpoint:
            app.manifest.type === "api"
              ? app.manifest.baseUrl
              : app.manifest.url,
          hasCredential: hasAppCredential(app.slug),
          hasGuide: (await readAppGuide(app.dir)) !== null,
          home: appHomeFor(app.slug, app.manifest),
          name: app.manifest.name,
          site: appSiteFor(app.slug, app.manifest),
          slug: app.slug,
          standing,
          type: app.manifest.type,
        };
      }),
    ),
    invalid,
  };
});

const live = {
  list: base.output(eventIterator(AppListSchema)).handler(async function* ({
    context,
    signal,
  }) {
    yield call(list, {}, { context, signal });
    for await (const _ of workspacePublisher.subscribe("app.updated", {
      signal,
    })) {
      yield call(list, {}, { context, signal });
    }
  }),
};

/** The directory: what the product knows how to reach before anyone connects it. */
const catalog = base.handler(() => getAppCatalog());

/** An app's guide, for its page. */
const guide = base
  .input(z.object({ slug: AppSlugSchema }))
  .output(z.string().nullable())
  .handler(async ({ context, errors, input }) => {
    const loaded = await loadApp(context.workspaceConfig.appsDir, input.slug);
    if (loaded.isErr()) {
      throw errors.NOT_FOUND({ message: loaded.error.message });
    }
    return readAppGuide(loaded.value.dir);
  });

/** What a connected MCP app can do, for its page. */
const tools = base
  .input(z.object({ slug: AppSlugSchema }))
  .output(z.array(z.object({ description: z.string(), name: z.string() })))
  .handler(async ({ context, errors, input, signal }) => {
    const loaded = await loadApp(context.workspaceConfig.appsDir, input.slug);
    if (loaded.isErr()) {
      throw errors.NOT_FOUND({ message: loaded.error.message });
    }
    const { manifest, slug } = loaded.value;
    if (manifest.type !== "mcp") {
      return [];
    }
    const credential =
      manifest.auth.kind === "oauth"
        ? null
        : await context.workspaceConfig.apps.getCredential(slug);
    const result = await withMcpClient({
      authProvider: mcpAuthProviderForCommand(slug, manifest),
      config: mcpConnectionConfig(manifest, credential),
      run: (client) => listMcpTools(client),
      signal,
    });
    if (result.isErr()) {
      throw errors.API_ERROR({ message: result.error.message });
    }
    return result.value.map((tool) => ({
      description: tool.description,
      name: tool.name,
    }));
  });

/**
 * Start a sign-in. Hands the authorization page's address back rather than
 * opening it: the window opens it in its own browser, where the callback
 * lands too.
 */
const startOAuth = base
  .input(
    z.object({
      /** Where the page opens, so the callback can land the right way. */
      opensIn: z.enum(["app", "external"]).default("app"),
      slug: AppSlugSchema,
    }),
  )
  .output(
    z.discriminatedUnion("status", [
      z.object({ status: z.literal("connected") }),
      z.object({ status: z.literal("started"), url: z.string() }),
    ]),
  )
  .handler(async ({ context, errors, input }) => {
    // The callback server is what the provider sends the browser back to, so
    // it has to be up, on a port this redirect names, before the flow starts.
    await startAuthCallbackServer();
    const result = await beginMcpOAuth({
      appsDir: context.workspaceConfig.appsDir,
      opensIn: input.opensIn,
      redirectUrl: appOAuthRedirectUrl(),
      slug: input.slug,
      store: appOAuthStore,
    });
    if (result.isErr()) {
      await recordConnection(input.slug, {
        error: result.error.message,
        status: "failed",
      });
      throw errors.API_ERROR({ message: result.error.message });
    }
    if (result.value.alreadyConnected) {
      await announceConnected(context.workspaceConfig.appsDir, input.slug);
      return { status: "connected" as const };
    }
    return { status: "started" as const, url: result.value.authorizationUrl };
  });

/** The user gave up on a sign-in that was started, from the card. */
const cancelOAuth = base
  .input(z.object({ slug: AppSlugSchema }))
  .handler(async ({ context, input }) => {
    const state = await appOAuthStore.getState(input.slug);
    if (state !== undefined) {
      await cancelMcpOAuth(state);
    }
    await appOAuthStore.clearTransient(input.slug);
    await decline(context.workspaceConfig.appsDir, input.slug);
  });

/**
 * A key, straight into the encrypted store, then the test: the agent wrote
 * the manifest and asked, and a green test is what turns the key into a
 * connection. The agent hears the outcome, never the key.
 */
const setCredential = base
  .input(z.object({ slug: AppSlugSchema, value: z.string().min(1) }))
  .handler(async ({ context, input, signal }) => {
    setAppCredential(input.slug, input.value);
    const report = await runAppTest({
      appsDir: context.workspaceConfig.appsDir,
      signal: signal ?? AbortSignal.timeout(60_000),
      slug: input.slug,
    });
    const name = await appName(context.workspaceConfig.appsDir, input.slug);
    workspacePublisher.publish("app.updated", null);
    if (report.passed) {
      workspacePublisher.publish("app.event", {
        detail: "the key was tested and works",
        event: "connected",
        name,
        slug: input.slug,
      });
      return;
    }
    const failure = report.checks.find((check) => check.status === "fail");
    workspacePublisher.publish("app.event", {
      detail: failure?.detail.split("\n")[0],
      event: "failed",
      name,
      slug: input.slug,
    });
  });

/** "Not now" on the card. */
const dismiss = base
  .input(z.object({ slug: AppSlugSchema }))
  .handler(async ({ context, input }) => {
    await decline(context.workspaceConfig.appsDir, input.slug);
  });

/** Take the key or sign-in away; the folder stays, for connecting again. */
const disconnect = base
  .input(z.object({ slug: AppSlugSchema }))
  .handler(async ({ context, input }) => {
    await disconnectApp(input.slug, {
      appsDir: context.workspaceConfig.appsDir,
    });
  });

/** The app's folder to the trash, with everything the stores hold about it. */
const remove = base
  .input(z.object({ slug: AppSlugSchema }))
  .handler(async ({ context, input }) => {
    const loaded = await loadApp(context.workspaceConfig.appsDir, input.slug);
    await disconnectApp(input.slug, {
      appsDir: context.workspaceConfig.appsDir,
      event: "removed",
    });
    if (loaded.isOk()) {
      await context.workspaceConfig.trashItem(loaded.value.dir);
    }
    workspacePublisher.publish("app.updated", null);
  });

/** The red/green loop, from the app's page. */
const test = base
  .input(z.object({ slug: AppSlugSchema }))
  .handler(async ({ context, input, signal }) => {
    const report = await runAppTest({
      appsDir: context.workspaceConfig.appsDir,
      signal: signal ?? AbortSignal.timeout(60_000),
      slug: input.slug,
    });
    workspacePublisher.publish("app.updated", null);
    return report;
  });

async function decline(appsDir: Parameters<typeof appName>[0], slug: string) {
  await recordConnection(slug, { status: "declined" });
  workspacePublisher.publish("app.event", {
    event: "declined",
    name: await appName(appsDir, slug),
    slug,
  });
}

export const apps = {
  cancelOAuth,
  catalog,
  disconnect,
  dismiss,
  guide,
  list,
  live,
  remove,
  setCredential,
  startOAuth,
  test,
  tools,
};
