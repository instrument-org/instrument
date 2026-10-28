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
  catalogEntryForApp,
  catalogKeyHelp,
  getAppCatalog,
  isMcpManifest,
  listApps,
  listMcpTools,
  loadApp,
  moveAppToWeb,
  nameAppAccount,
  pendingMcpOAuthSlug,
  removeLocalServer,
  setUpFromDirectory,
  requireAppCredential,
  runAppTest,
  searchAppCatalogByMeaning,
  withAppMcpClient,
  appCatalogChanges,
  appChanged,
  appListChanges,
  ChatIdSchema,
  findAppIcon,
  type AppManifest,
  waitInChat,
} from "@instrument-org/workspace/electron";
import { call, eventIterator, ORPCError } from "@orpc/server";
import { z } from "zod";

import {
  announceConnected,
  appOAuthRedirectUrl,
  appOAuthRelayUrl,
  appOAuthTokenUrl,
  disconnectApp,
} from "../../lib/apps";
import {
  AppStandingSchema,
  settleConnection,
  standingOf,
} from "../../lib/app-connection";
import {
  expectSignIn,
  settleSignIn,
} from "@/electron-main/browser-view/history-intents";

const AppListItemBaseSchema = z.object({
  /** Which account of the service the app is signed in as, when the agent or the user named it. */
  account: z.string().optional(),
  connection: AppConnectionSchema.optional(),
  /**
   * Where a key or sign-in given now would go: the card shows it and sends it
   * back with the key, so the user approves the place along with the secret.
   */
  credentialOrigin: z.string(),
  /** The app's folder on this computer, for showing it in Files or the Finder. */
  dir: z.string(),
  /** API base URL, MCP server URL, or the package a local server runs from. */
  endpoint: z.string(),
  hasCredential: z.boolean(),
  /** The signed-in web app, for the page's primary action. */
  home: z.string().optional(),
  /** The app's own icon from its folder, else its Mac app's for a local server that drives one, else the directory's; drawn in place of the site's. */
  icon: z.string().optional(),
  name: z.string(),
  /** The directory's slug for the service the app reaches, shared by every app of that service. */
  service: z.string().optional(),
  /** The service's origin, for its icon. */
  site: z.string().optional(),
  slug: z.string(),
  standing: AppStandingSchema,
});

/** For an app opened with a key, where the directory says the user makes one, and what to do there. */
const KeyHelpSchema = z
  .object({ page: z.string(), steps: z.string().optional() })
  .optional();

const AppListItemSchema = z.discriminatedUnion("type", [
  AppListItemBaseSchema.extend({
    authKind: z.enum(["basic", "bearer", "header", "none", "oauth", "query"]),
    keyHelp: KeyHelpSchema,
    type: z.literal("api"),
  }),
  AppListItemBaseSchema.extend({
    authKind: z.enum(["bearer", "header", "none", "oauth"]),
    keyHelp: KeyHelpSchema,
    type: z.literal("mcp"),
  }),
  AppListItemBaseSchema.extend({
    authKind: z.enum(["env", "none"]),
    /** One of the Mac's own apps, on the server the app ships for it: nothing to install. */
    bundled: z.boolean(),
    keyHelp: KeyHelpSchema,
    /** What runs on this computer, in words. */
    runs: z.string(),
    type: z.literal("mcp-local"),
  }),
  AppListItemBaseSchema.extend({
    /** The page its sign-in opens in the window's browser. */
    signIn: z.string(),
    type: z.literal("web"),
  }),
]);

/**
 * The app's own icon, else its Mac app's, else the icon the directory's entry
 * for the service it reaches is drawn with; none leaves the site's to draw.
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
  const entry = catalogEntryForApp(app.slug, app.manifest);
  const directory = entry ? await catalogIconFor(entry) : undefined;
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

/** Where the key for an app opened with one is made, when the directory knows. */
function keyHelpFor(
  slug: string,
  manifest: AppManifest,
): { keyHelp?: { page: string; steps?: string } } {
  if (
    manifest.type === "web" ||
    manifest.auth.kind === "none" ||
    manifest.auth.kind === "oauth"
  ) {
    return {};
  }
  const keyHelp = catalogKeyHelp(
    slug,
    manifest.type === "mcp-local" ? manifest.package : manifest.url,
  );
  return keyHelp ? { keyHelp } : {};
}

function withService(service: string | undefined): { service?: string } {
  return service === undefined ? {} : { service };
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
        const listed = {
          ...(app.manifest.account ? { account: app.manifest.account } : {}),
          connection,
          credentialOrigin: credentialOrigin(app.manifest),
          dir: app.dir,
          hasCredential: hasAppCredential(app.slug),
          home: appHomeFor(app.slug, app.manifest),
          ...(await iconFor(app)),
          name: app.name,
          ...withService(catalogEntryForApp(app.slug, app.manifest)?.slug),
          site: appSiteFor(app.slug, app.manifest),
          slug: app.slug,
          standing: standingOf(connection, app.manifestHash),
        };
        const { manifest } = app;
        switch (manifest.type) {
          case "api": {
            return {
              ...listed,
              authKind: manifest.auth.kind,
              endpoint: manifest.url,
              ...keyHelpFor(app.slug, manifest),
              type: manifest.type,
            };
          }
          case "mcp": {
            return {
              ...listed,
              authKind: manifest.auth.kind,
              endpoint: manifest.url,
              ...keyHelpFor(app.slug, manifest),
              type: manifest.type,
            };
          }
          case "mcp-local": {
            return {
              ...listed,
              authKind: manifest.auth.kind,
              bundled: manifest.runtime === "bundled",
              endpoint: manifest.package,
              ...keyHelpFor(app.slug, manifest),
              runs: describeLocalLaunch(manifest),
              type: manifest.type,
            };
          }
          case "web": {
            // A web app has no auth binding: the user signs in on the site.
            return {
              ...listed,
              endpoint: manifest.url,
              signIn: manifest.signIn ?? manifest.url,
              type: manifest.type,
            };
          }
        }
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
      changes: [appListChanges(signal)],
      read: () => call(list, {}, { context, signal }),
    });
  }),
  /**
   * The directory: what the product knows how to reach before anyone
   * connects it, each service with the icon the build ships for it, if any.
   * Read again only when a served copy changes it.
   */
  catalog: base.handler(async function* ({ signal }) {
    yield* liveRead({
      changes: [appCatalogChanges(signal)],
      read: () => Promise.all(getAppCatalog().map(withIcon)),
    });
  }),
};

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
      activity: { purpose: "app-search", surface: "apps" },
    });
    return Promise.all(meant.map(withIcon));
  });

/** A directory entry with the icon it is drawn with. */
async function withIcon(entry: ReturnType<typeof getAppCatalog>[number]) {
  return { ...entry, icon: await catalogIconFor(entry) };
}

/**
 * The icon a directory entry is drawn with: the one the build ships for it, or
 * its Mac app's. An app connected from the entry falls back to the same one,
 * so the service looks the same before and after it is connected.
 */
async function catalogIconFor(
  entry: ReturnType<typeof getAppCatalog>[number],
): Promise<string | undefined> {
  return (await directoryIconFor(entry.slug)) ?? (await macAppIconFor(entry));
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
    API_ERROR: (options: { cause?: unknown; message: string }) => Error;
    NOT_FOUND: (options: { message: string }) => Error;
    UNAUTHORIZED: (options: { message: string }) => Error;
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
    // A key that is gone from the store, or held for another address than
    // the manifest names now, leaves the app needing a key: the page asks
    // for one, and nothing is captured as a fault.
    const message = error instanceof Error ? error.message : String(error);
    await settleConnection(slug, {
      error: message.slice(0, 300),
      status: "needs-key",
    });
    throw errors.UNAUTHORIZED({ message });
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
    // A server that refuses the sign-in or key the app holds has
    // disconnected it (an expired or revoked sign-in), so the app says so
    // and its page asks again, instead of reading as connected with nothing
    // working behind it. No chat hears of it until someone writes.
    if (result.error.reason === "unauthorized") {
      await settleConnection(slug, {
        error: result.error.message.slice(0, 300),
        status: manifest.auth.kind === "oauth" ? "needs-sign-in" : "needs-key",
      });
      throw errors.UNAUTHORIZED({ message: result.error.message });
    }
    // A server that knows who is asking and refuses anyway (HTTP 403) is
    // missing a permission on its side: the sign-in or key stands, so the app
    // stays as it is and the page shows what the server said.
    if (result.error.reason === "forbidden") {
      throw new ORPCError("FORBIDDEN", {
        cause: result.error.cause,
        message: result.error.message,
      });
    }
    // Carried as the cause so a server that is not there (a desktop app's
    // local server while the app is closed, a service that is down) is
    // known as a network failure: the page offers a retry, and nothing is
    // captured as a fault.
    throw errors.API_ERROR({
      cause: result.error.cause,
      message: result.error.message,
    });
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
    await appChanged(slug);
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
/** An app answered on a card or a page: the chat, for a card, which hears the answer. */
const AnsweredOnCardSchema = z.object({
  /** The chat whose card this was answered on, which hears the answer. */
  chatId: ChatIdSchema.optional(),
  slug: AppSlugSchema,
});

const startOAuth = base
  .input(
    z.object({
      /** The chat whose card this was answered on, which hears the answer. */
      chatId: ChatIdSchema.optional(),
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
    if (input.chatId !== undefined) {
      await waitInChat(input.slug, input.chatId);
    }
    // The callback server is what the provider sends the browser back to, so
    // it has to be up, on a port this redirect names, before the flow starts.
    await startAuthCallbackServer();
    const result = await beginMcpOAuth({
      appsDir: context.workspaceConfig.appsDir,
      opensIn: input.opensIn,
      redirectUrl: appOAuthRedirectUrl(),
      relayRedirectUrl: appOAuthRelayUrl,
      relayTokenUrl: appOAuthTokenUrl,
      slug: input.slug,
      store: appOAuthStore,
    });
    if (result.isErr()) {
      // A sign-in that cannot start is as much news as one that finished:
      // the conversation asked for it, and is the one to say what now.
      await settleConnection(input.slug, {
        error: result.error.message,
        status: "failed",
      });
      // Carried as the cause so a sign-in that could not start because the
      // network is down is not captured as a fault.
      throw errors.API_ERROR({
        cause: result.error.cause,
        message: result.error.message,
      });
    }
    if (result.value.alreadyConnected) {
      await announceConnected(input.slug);
      return { status: "connected" as const };
    }
    if (input.opensIn === "app") {
      // The window opens the page in its own browser; the pages the sign-in
      // goes through there are kept out of history until it lands.
      expectSignIn(input.slug, result.value.authorizationUrl);
    }
    return { status: "started" as const, url: result.value.authorizationUrl };
  });

/**
 * The user stopped a sign-in that was started: the flow is torn down, so its
 * callback is refused. A sign-in that was still waiting is recorded as
 * stopped, which wakes the chat that asked with the way on (the web, or
 * another try) and puts both on the card. A decline is "Not now", not this.
 */
const cancelOAuth = base
  .input(z.object({ slug: AppSlugSchema }))
  .handler(async ({ input }) => {
    settleSignIn(input.slug);
    const state = await appOAuthStore.getState(input.slug);
    const waiting =
      state !== undefined && pendingMcpOAuthSlug(state) === input.slug;
    if (state !== undefined) {
      await cancelMcpOAuth(state);
    }
    await appOAuthStore.clearTransient(input.slug);
    if (waiting) {
      await settleConnection(input.slug, {
        ended: "canceled",
        error: "The sign-in was stopped before it finished.",
        status: "failed",
      });
    }
  });

/**
 * "Sign in on the web" on a card whose sign-in did not connect: the app moves
 * to the service's site, to be signed in to in the window's browser, where
 * the site's cookies keep it. Answers the page to open; "Done signing in"
 * connects it as a web app, which wakes the chat.
 */
const signInOnWeb = base
  .input(z.object({ slug: AppSlugSchema }))
  .output(z.object({ signIn: z.string() }))
  .handler(async ({ errors, input }) => {
    try {
      const { signIn } = await moveAppToWeb(input.slug);
      return { signIn };
    } catch (error) {
      throw errors.NOT_FOUND({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

/**
 * A key, straight into the encrypted store, then the test: the agent wrote
 * the manifest and asked, and a green test is what turns the key into a
 * connection. The agent hears the outcome, never the key.
 */
const setCredential = base
  .input(
    z.object({
      /** The chat whose card this was answered on, which hears the answer. */
      chatId: ChatIdSchema.optional(),
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
    if (input.chatId !== undefined) {
      await waitInChat(input.slug, input.chatId);
    }
    setAppCredential(input.slug, { origin: input.origin, value: input.value });
    const report = await runAppTest({
      appsDir: context.workspaceConfig.appsDir,
      signal: signal ?? AbortSignal.timeout(60_000),
      slug: input.slug,
    });
    if (report.passed) {
      await appChanged(input.slug, {
        detail: "the key was tested and works",
        event: "connected",
      });
      return;
    }
    const failure = report.checks.find((check) => check.status === "fail");
    await appChanged(input.slug, {
      detail: failure?.detail.split("\n")[0],
      event: "failed",
    });
  });

/**
 * The user lets a local app's server run on this machine, from the card or
 * its page. The approval is pinned to the manifest they saw, and the test
 * that follows installs the package and starts the server for the first time.
 */
const allow = base
  .input(AnsweredOnCardSchema)
  .handler(async ({ context, errors, input, signal }) => {
    const loaded = await loadApp(context.workspaceConfig.appsDir, input.slug);
    if (loaded.isErr()) {
      throw errors.NOT_FOUND({ message: loaded.error.message });
    }
    if (input.chatId !== undefined) {
      await waitInChat(input.slug, input.chatId);
    }
    await settleConnection(input.slug, {
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
    const failure = report.checks.find((check) => check.status === "fail");
    await appChanged(input.slug, {
      detail: report.passed
        ? "its server was installed and started"
        : failure?.detail.split("\n")[0],
      event: report.passed ? "connected" : "failed",
    });
    return report;
  });

/**
 * "Done signing in" on a web app's card or page: the user's word is the whole
 * of the connection, since nothing here can see a session in the browser.
 * Pinned to the manifest as it stands, so a site the agent moves the app to
 * later asks again; the chat is woken the way a finished sign-in wakes it.
 */
const markWebSignedIn = base
  .input(AnsweredOnCardSchema)
  .handler(async ({ context, errors, input }) => {
    const loaded = await loadApp(context.workspaceConfig.appsDir, input.slug);
    if (loaded.isErr()) {
      throw errors.NOT_FOUND({ message: loaded.error.message });
    }
    if (input.chatId !== undefined) {
      await waitInChat(input.slug, input.chatId);
    }
    const { manifest } = loaded.value;
    if (manifest.type !== "web") {
      throw errors.NOT_FOUND({
        message: `${input.slug} is not a web app.`,
      });
    }
    await settleConnection(input.slug, {
      manifestHash: loaded.value.manifestHash,
      status: "connected",
    });
  });

/**
 * Connect on a service the directory lists, with no conversation: the
 * directory's own way in, written as an app that waits on the user's
 * sign-in, key, or go-ahead, or connected outright when it wants none.
 * Answers `agent` when the directory cannot finish it alone, for the caller
 * to ask the agent instead.
 */
const setUp = base
  .input(z.object({ slug: z.string() }))
  .output(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("agent") }),
      z.object({ kind: z.literal("set-up"), slug: z.string() }),
    ]),
  )
  .handler(({ input, signal }) =>
    setUpFromDirectory({ signal, slug: input.slug }),
  );

/** The user naming the account an app is signed in as, or clearing the name. */
const setAccount = base
  .input(
    z.object({
      account: z.string().trim().max(120).optional(),
      slug: AppSlugSchema,
    }),
  )
  .handler(async ({ context, input }) => {
    await nameAppAccount(
      context.workspaceConfig.appsDir,
      input.slug,
      input.account === "" ? undefined : input.account,
    );
    await appChanged(input.slug);
  });

/** "Not now" on the card. */
const dismiss = base
  .input(z.object({ slug: AppSlugSchema }))
  .handler(async ({ input }) => {
    await settleConnection(input.slug, { status: "declined" });
  });

/** Take the key or sign-in away; the folder stays, for connecting again. */
const disconnect = base
  .input(z.object({ slug: AppSlugSchema }))
  .handler(async ({ input }) => {
    await disconnectApp(input.slug);
  });

/** The app's folder to the trash, with everything the stores hold about it. */
const remove = base
  .input(z.object({ slug: AppSlugSchema }))
  .handler(async ({ context, input }) => {
    const loaded = await loadApp(context.workspaceConfig.appsDir, input.slug);
    await disconnectApp(input.slug, { event: "removed" });
    if (loaded.isOk()) {
      await context.workspaceConfig.trashItem(loaded.value.dir);
    }
    await removeLocalServer(input.slug);
    await appChanged(input.slug);
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
    await appChanged(input.slug);
    return report;
  });

export const apps = {
  allow,
  cancelOAuth,
  catalogByMeaning,
  disconnect,
  dismiss,
  inspect,
  list,
  live,
  markWebSignedIn,
  read,
  remove,
  setAccount,
  setCredential,
  setUp,
  signInOnWeb,
  startOAuth,
  test,
};
