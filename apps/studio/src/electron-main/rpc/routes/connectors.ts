import { base } from "@/electron-main/rpc/base";
import {
  beginMcpOAuth,
  ConnectorSlugSchema,
  getConnectorCatalog,
  listConnectors,
  mcpAuthProviderForTool,
  runConnectorTestAndEnable,
} from "@instrument-org/workspace/electron";
import { call, eventIterator } from "@orpc/server";
import { shell } from "electron";
import { z } from "zod";

import {
  getConnectorCredential,
  getConnectorCredentialsStore,
} from "../../stores/connector-credentials";
import { clearConnectorOAuth } from "../../stores/connector-oauth";
import { publisher } from "../publisher";

const ConnectorListItemSchema = z.object({
  authKind: z.string(),
  displayName: z.string(),
  enabled: z.boolean(),
  // API base URL or MCP server URL, depending on `type`.
  endpoint: z.string(),
  hasCredential: z.boolean(),
  slug: z.string(),
  type: z.string(),
});

const ConnectorListSchema = z.object({
  connectors: z.array(ConnectorListItemSchema),
  invalid: z.array(z.object({ message: z.string(), slug: z.string() })),
});

const list = base.output(ConnectorListSchema).handler(async ({ context }) => {
  const { connectors, invalid } = await listConnectors(
    context.workspaceConfig.connectorsDir,
  );
  const credentials = getConnectorCredentialsStore().get("credentials");

  return {
    connectors: connectors.map((connector) => ({
      authKind: connector.manifest.auth.kind,
      displayName: connector.manifest.displayName,
      enabled: connector.manifest.enabled,
      endpoint:
        connector.manifest.type === "api"
          ? connector.manifest.baseUrl
          : connector.manifest.url,
      hasCredential: connector.slug in credentials,
      slug: connector.slug,
      type: connector.manifest.type,
    })),
    invalid,
  };
});

// Credential values only ever flow inward. list/live expose presence booleans;
// nothing returns a stored value, masked or otherwise.
const setCredential = base
  .input(z.object({ slug: ConnectorSlugSchema, value: z.string().min(1) }))
  .handler(({ context, input }) => {
    const store = getConnectorCredentialsStore();
    store.set("credentials", {
      ...store.get("credentials"),
      [input.slug]: input.value,
    });
    context.workspaceConfig.captureEvent("connector.credential_set", {
      connector_slug: input.slug,
    });
  });

const removeCredential = base
  .input(z.object({ slug: ConnectorSlugSchema }))
  .handler(({ input }) => {
    const store = getConnectorCredentialsStore();
    const { [input.slug]: _removed, ...rest } = store.get("credentials");
    store.set("credentials", rest);
  });

const test = base
  .input(z.object({ slug: ConnectorSlugSchema }))
  .handler(async ({ context, input, signal }) => {
    const result = await runConnectorTestAndEnable({
      connectorsDir: context.workspaceConfig.connectorsDir,
      getCredential: (slug) => Promise.resolve(getConnectorCredential(slug)),
      getMcpAuthProvider: mcpAuthProviderForTool,
      signal: signal ?? AbortSignal.timeout(60_000),
      slug: input.slug,
    });
    // A green run flips `enabled` in the manifest on disk; the credential
    // store did not change, so nudge subscribers ourselves.
    publisher.publish("connectors.updated", null);
    context.workspaceConfig.captureEvent("connector.tested", {
      connector_slug: input.slug,
      passed: result.report.passed,
    });
    return result;
  });

// Kick off interactive OAuth sign-in for an MCP connector: opens the system
// browser; the /auth/callback/connector route finishes the flow and stores the
// tokens. The client then reacts to `connectors.updated` and runs `test` to
// enable the connector.
const startOAuth = base
  .input(z.object({ slug: ConnectorSlugSchema }))
  .output(z.object({ status: z.enum(["connected", "started"]) }))
  .handler(async ({ context, errors, input }) => {
    const oauth = context.workspaceConfig.connectors.oauth;
    if (!oauth) {
      throw errors.API_ERROR({ message: "OAuth is not available." });
    }
    const result = await beginMcpOAuth({
      connectorsDir: context.workspaceConfig.connectorsDir,
      openAuthorization: (url) => shell.openExternal(url.toString()),
      redirectUrl: oauth.redirectUrl,
      slug: input.slug,
      store: oauth.store,
    });
    if (result.isErr()) {
      throw errors.API_ERROR({ message: result.error.message });
    }
    if (result.value.alreadyConnected) {
      publisher.publish("connectors.updated", null);
      return { status: "connected" as const };
    }
    return { status: "started" as const };
  });

const disconnectOAuth = base
  .input(z.object({ slug: ConnectorSlugSchema }))
  .handler(({ input }) => {
    clearConnectorOAuth(input.slug);
    publisher.publish("connectors.updated", null);
  });

const live = {
  list: base
    .output(eventIterator(ConnectorListSchema))
    .handler(async function* ({ context, signal }) {
      yield call(list, {}, { context, signal });

      for await (const _ of publisher.subscribe("connectors.updated", {
        signal,
      })) {
        yield call(list, {}, { context, signal });
      }
    }),
};

// The built-in discovery catalog (a cached snapshot of integrations.sh). Static
// workspace data; the connectors' installed/enabled state comes from `list`.
const catalog = base.handler(() => getConnectorCatalog());

export const connectors = {
  catalog,
  disconnectOAuth,
  list,
  live,
  removeCredential,
  setCredential,
  startOAuth,
  test,
};
