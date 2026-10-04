import { liveRead } from "@instrument-org/workspace/electron";
import { startAuthCallbackServer } from "@/electron-main/auth/server";
import {
  storeFileOpenIcon,
  storeFileOpenSvgIcon,
} from "@/electron-main/lib/app-protocol";
import {
  APP_ICON_SIZE,
  getMacAppIconUrl,
} from "@/electron-main/lib/file-open-target";
import { directoryIconFor } from "@/electron-main/lib/directory-icons";
import { base } from "@/electron-main/rpc/base";
import { appConnectionStore } from "@/electron-main/stores/workspace/app-connections";
import {
  hasAppCredential,
  setAppCredential,
} from "@/electron-main/stores/workspace/app-credentials";
import { appOAuthStore } from "@/electron-main/stores/workspace/app-oauth";
import {
  AppConnectionSchema,
  appHomeFor,
  credentialOrigin,
  appSiteFor,
  AppSlugSchema,
  beginMcpOAuth,
  cancelMcpOAuth,
  describeLocalLaunch,
  catalogEntryMacApp,
  findCatalogEntry,
  getAppCatalog,
  isConnected,
  isMcpManifest,
  listApps,
  listMcpTools,
  loadApp,
  readAppGuide,
  recordConnection,
  removeLocalServer,
  requireAppCredential,
  runAppTest,
  searchAppCatalogByMeaning,
  withAppMcpClient,
  workspacePublisher,
  findAppIcon,
  type AppManifest,
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
  "needs-approval",
  "needs-key",
  "needs-sign-in",
  // A manifest the agent edited since the connection passed.
  "stale",
  "untested",
]);

const AppListItemSchema = z.object({
  authKind: z.string(),
  connection: AppConnectionSchema.optional(),
  /**
   * Where a key or sign-in given now would go: the card shows it and sends it
   * back with the key, so the user approves the place along with the secret.
   */
  credentialOrigin: z.string(),
  /** API base URL, MCP server URL, or the package a local server runs from. */
  endpoint: z.string(),
  hasCredential: z.boolean(),
  hasGuide: z.boolean(),
  /** The signed-in web app, for the page's primary action. */
  home: z.string().optional(),
  /** The app's own icon from its folder, else its Mac app's for a local server that drives one, else the directory's; drawn in place of the site's. */
  icon: z.string().optional(),
  name: z.string(),
  /** For an app whose server runs here, what runs, in words. */
  runs: z.string().optional(),
  /** The service's origin, for its icon. */
  site: z.string().optional(),
  slug: z.string(),
  standing: AppStandingSchema,
  type: z.enum(["api", "mcp", "mcp-local"]),
});

/**
 * The app's own icon, else its Mac app's, else the directory's for the service
 * it reaches; none leaves the site's to draw.
 */
async function iconFor(app: {
  dir: Parameters<typeof findAppIcon>[0];
  manifest: AppManifest;
  slug: string;
}): Promise<{ icon?: string }> {
  const own = await findAppIcon(app.dir).catch(() => undefined);
  const url = own
    ? await (
        own.fileName === "icon.svg"
          ? storeFileOpenSvgIcon(own.bytes)
          : storeFileOpenIcon(own.bytes.toString("base64"), APP_ICON_SIZE)
      ).catch(() => null)
    : app.manifest.type === "mcp-local" && app.manifest.macApp
      ? await getMacAppIconUrl(app.manifest.macApp).catch(() => null)
      : null;
  if (url) {
    return { icon: url };
  }
  const entry = findCatalogEntry(
    app.slug,
    app.manifest.type === "mcp" ? app.manifest.url : undefined,
  );
  const directory = entry ? await directoryIconFor(entry.slug) : undefined;
  return directory ? { icon: directory } : {};
}

/**
 * The Mac's own app's icon for an entry that is that app (Apple Notes is
 * drawn as Notes), never for a service a Mac app merely reads, so Gmail is
 * not drawn as Mail.
 */
async function macAppIconFor(
  entry: ReturnType<typeof getAppCatalog>[number],
): Promise<string | undefined> {
  const macApp =
    entry.family === "apple" ? catalogEntryMacApp(entry) : undefined;
  return macApp
    ? ((await getMacAppIconUrl(macApp.bundleId).catch(() => null)) ?? undefined)
    : undefined;
}

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
          credentialOrigin: credentialOrigin(app.manifest),
          endpoint:
            app.manifest.type === "api"
              ? app.manifest.baseUrl
              : app.manifest.type === "mcp"
                ? app.manifest.url
                : app.manifest.package,
          hasCredential: hasAppCredential(app.slug),
          hasGuide: (await readAppGuide(app.dir)) !== null,
          home: appHomeFor(app.slug, app.manifest),
          ...(await iconFor(app)),
          name: app.manifest.name,
          ...(app.manifest.type === "mcp-local"
            ? { runs: describeLocalLaunch(app.manifest) }
            : {}),
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
    yield* liveRead({
      changes: [workspacePublisher.subscribe("app.updated", { signal })],
      read: () => call(list, {}, { context, signal }),
    });
  }),
};

/**
 * The directory: what the product knows how to reach before anyone connects
 * it, each service with the icon the build ships for it, if any.
 */
const catalog = base.handler(() => Promise.all(getAppCatalog().map(withIcon)));

/**
 * The directory's services a search means without naming them, most likely
 * first, each with its icon as `catalog` gives it. Empty when no provider
 * reaches the decision model.
 */
const catalogByMeaning = base
  .input(z.object({ query: z.string() }))
  .handler(async ({ context, input, signal }) => {
    const meant = await searchAppCatalogByMeaning(input.query, {
      configs: context.workspaceConfig.getAIProviderConfigs(),
      signal,
    });
    return Promise.all(meant.map(withIcon));
  });

/** A directory entry with the icon the build ships for it, or its Mac app's. */
async function withIcon(entry: ReturnType<typeof getAppCatalog>[number]) {
  return {
    ...entry,
    icon: (await directoryIconFor(entry.slug)) ?? (await macAppIconFor(entry)),
  };
}

/**
 * Whether a tool may be pressed from the inspector: the server says it only
 * reads, and it is not one that brings something up on the screen, which a
 * read-only hint still allows.
 */
function isInspectorRead(tool: {
  annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean };
  name: string;
}): boolean {
  return (
    tool.annotations?.readOnlyHint === true &&
    tool.annotations.destructiveHint !== true &&
    !/(?:^|_)(?:open|show|focus|select)(?:_|$)/i.test(tool.name)
  );
}

const InspectorToolSchema = z.object({
  description: z.string(),
  isRead: z.boolean(),
  name: z.string(),
  /** Every parameter, required first. */
  params: z.array(
    z.object({
      description: z.string().optional(),
      enum: z.array(z.string()).optional(),
      name: z.string(),
      required: z.boolean(),
      type: z.string().optional(),
    }),
  ),
  title: z.string().optional(),
});

/** An MCP app's tools as the inspector reads them: which ones only read, and what each takes. */
const inspect = base
  .input(z.object({ slug: AppSlugSchema }))
  .output(z.array(InspectorToolSchema))
  .handler(async ({ context, errors, input, signal }) => {
    const listed = await withInspectorClient({
      context,
      errors,
      run: (client) => listMcpTools(client),
      signal,
      slug: input.slug,
    });
    return listed.map((tool) => {
      const schema = (tool.inputSchema ?? {}) as {
        properties?: Record<
          string,
          { description?: string; enum?: unknown[]; type?: unknown }
        >;
        required?: string[];
      };
      const required = new Set(schema.required ?? []);
      const params = Object.entries(schema.properties ?? {})
        .map(([name, property]) => ({
          description: property.description,
          enum: Array.isArray(property.enum)
            ? property.enum.filter(
                (value): value is string => typeof value === "string",
              )
            : undefined,
          name,
          required: required.has(name),
          type: typeof property.type === "string" ? property.type : undefined,
        }))
        .toSorted((a, b) => Number(b.required) - Number(a.required));
      return {
        description: tool.description,
        isRead: isInspectorRead(tool),
        name: tool.name,
        params,
        title: tool.annotations?.title,
      };
    });
  });

/**
 * Run one tool for the inspector. Refused unless the server marks it as a
 * read, checked here against a fresh listing rather than trusted from the
 * page.
 */
const read = base
  .input(
    z.object({
      args: z.record(z.string(), z.unknown()).default({}),
      slug: AppSlugSchema,
      tool: z.string(),
    }),
  )
  .output(
    z.object({
      /** Pictures the tool returned, as data: URLs. */
      images: z.array(z.string()),
      isError: z.boolean(),
      ms: z.number(),
      text: z.string(),
    }),
  )
  .handler(async ({ context, errors, input, signal }) =>
    withInspectorClient({
      context,
      errors,
      run: async (client) => {
        const listed = await listMcpTools(client);
        const tool = listed.find((entry) => entry.name === input.tool);
        if (!tool || !isInspectorRead(tool)) {
          throw new Error(`${input.tool} is not a read the inspector may run.`);
        }
        const started = Date.now();
        const result = await client.callTool({
          arguments: input.args,
          name: input.tool,
        });
        // Content blocks as the SDK hands them over: unknown past `type`.
        const blocks = (
          Array.isArray(result.content) ? result.content : []
        ) as {
          data?: string;
          mimeType?: string;
          text?: string;
          type: string;
        }[];
        return {
          images: blocks.flatMap((block) =>
            block.type === "image" && block.data && block.mimeType
              ? [`data:${block.mimeType};base64,${block.data}`]
              : [],
          ),
          isError: result.isError === true,
          ms: Date.now() - started,
          text: blocks
            .flatMap((block) =>
              block.type === "text" && block.text ? [block.text] : [],
            )
            .join("\n"),
        };
      },
      signal,
      slug: input.slug,
    }),
  );

async function withInspectorClient<T>({
  context,
  errors,
  run,
  signal,
  slug: rawSlug,
}: {
  context: {
    workspaceConfig: {
      appsDir: Parameters<typeof loadApp>[0];
    };
  };
  errors: {
    API_ERROR: (options: { message: string }) => Error;
    NOT_FOUND: (options: { message: string }) => Error;
  };
  run: Parameters<typeof withAppMcpClient>[0]["run"] extends (
    client: infer C,
  ) => Promise<unknown>
    ? (client: C) => Promise<T>
    : never;
  signal?: AbortSignal;
  slug: string;
}): Promise<T> {
  const loaded = await loadApp(context.workspaceConfig.appsDir, rawSlug);
  if (loaded.isErr()) {
    throw errors.NOT_FOUND({ message: loaded.error.message });
  }
  const { manifest, manifestHash, slug } = loaded.value;
  if (!isMcpManifest(manifest)) {
    throw errors.NOT_FOUND({ message: `${slug} is not an MCP app.` });
  }
  let credential: null | string;
  try {
    credential = await requireAppCredential(slug, manifest);
  } catch (error) {
    throw errors.API_ERROR({
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const result = await withAppMcpClient({
    credential,
    manifest,
    manifestHash,
    run,
    signal,
    slug,
  });
  if (result.isErr()) {
    throw errors.API_ERROR({ message: result.error.message });
  }
  return result.value;
}

/**
 * Refuse a key or a sign-in when the app's manifest no longer sends it where
 * the card said it would. The manifest is the agent's to rewrite, and the
 * place is half of what the user approved. Every list re-reads, so the card
 * shows the new place for the user to confirm.
 */
async function requireShownOrigin({
  appsDir,
  errors,
  origin,
  slug,
}: {
  appsDir: Parameters<typeof loadApp>[0];
  errors: {
    API_ERROR: (options: { message: string }) => Error;
    NOT_FOUND: (options: { message: string }) => Error;
  };
  origin: string;
  slug: string;
}): Promise<void> {
  const loaded = await loadApp(appsDir, slug);
  if (loaded.isErr()) {
    throw errors.NOT_FOUND({ message: loaded.error.message });
  }
  const current = credentialOrigin(loaded.value.manifest);
  if (current !== origin) {
    workspacePublisher.publish("app.updated", null);
    throw errors.API_ERROR({
      message: `The app now points at ${current} instead of ${origin}. Check the new address before going on.`,
    });
  }
}

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
      /** The server origin the card showed the user. */
      origin: z.string().min(1),
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
    await requireShownOrigin({
      appsDir: context.workspaceConfig.appsDir,
      errors,
      origin: input.origin,
      slug: input.slug,
    });
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
      // A sign-in that cannot start is as much news as one that finished:
      // the conversation asked for it, and is the one to say what now.
      workspacePublisher.publish("app.updated", null);
      workspacePublisher.publish("app.event", {
        detail: result.error.message,
        event: "failed",
        name: await appName(context.workspaceConfig.appsDir, input.slug),
        slug: input.slug,
      });
      throw errors.API_ERROR({ message: result.error.message });
    }
    if (result.value.alreadyConnected) {
      await announceConnected(context.workspaceConfig.appsDir, input.slug);
      return { status: "connected" as const };
    }
    return { status: "started" as const, url: result.value.authorizationUrl };
  });

/**
 * The user gave up on a sign-in that was started, to try it again: the flow is
 * torn down, so its callback is refused, and the app is left as it was. A
 * decline is "Not now", not this.
 */
const cancelOAuth = base
  .input(z.object({ slug: AppSlugSchema }))
  .handler(async ({ input }) => {
    const state = await appOAuthStore.getState(input.slug);
    if (state !== undefined) {
      await cancelMcpOAuth(state);
    }
    await appOAuthStore.clearTransient(input.slug);
  });

/**
 * A key, straight into the encrypted store, then the test: the agent wrote
 * the manifest and asked, and a green test is what turns the key into a
 * connection. The agent hears the outcome, never the key.
 */
const setCredential = base
  .input(
    z.object({
      /** Where the card told the user the key would go. */
      origin: z.string().min(1),
      slug: AppSlugSchema,
      value: z.string().min(1),
    }),
  )
  .handler(async ({ context, errors, input, signal }) => {
    // The key is approved for the origin the card showed, and goes nowhere
    // else: a manifest pointed elsewhere later asks again.
    await requireShownOrigin({
      appsDir: context.workspaceConfig.appsDir,
      errors,
      origin: input.origin,
      slug: input.slug,
    });
    setAppCredential(input.slug, { origin: input.origin, value: input.value });
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

/**
 * The user lets a local app's server run on this machine, from the card or
 * its page. The approval is pinned to the manifest they saw, and the test
 * that follows installs the package and starts the server for the first time.
 */
const allow = base
  .input(z.object({ slug: AppSlugSchema }))
  .handler(async ({ context, errors, input, signal }) => {
    const loaded = await loadApp(context.workspaceConfig.appsDir, input.slug);
    if (loaded.isErr()) {
      throw errors.NOT_FOUND({ message: loaded.error.message });
    }
    await recordConnection(input.slug, {
      approvedManifestHash: loaded.value.manifestHash,
      status: "needs-approval",
    });
    const report = await runAppTest({
      appsDir: context.workspaceConfig.appsDir,
      // An install from a registry runs the first time, so this waits on the
      // network rather than on a request to a service that is already up.
      signal: signal ?? AbortSignal.timeout(180_000),
      slug: input.slug,
    });
    const name = await appName(context.workspaceConfig.appsDir, input.slug);
    workspacePublisher.publish("app.updated", null);
    const failure = report.checks.find((check) => check.status === "fail");
    workspacePublisher.publish("app.event", {
      detail: report.passed
        ? "its server was installed and started"
        : failure?.detail.split("\n")[0],
      event: report.passed ? "connected" : "failed",
      name,
      slug: input.slug,
    });
    return report;
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
    await removeLocalServer(input.slug);
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
  allow,
  cancelOAuth,
  catalog,
  catalogByMeaning,
  disconnect,
  dismiss,
  inspect,
  list,
  live,
  read,
  remove,
  setCredential,
  startOAuth,
  test,
};
