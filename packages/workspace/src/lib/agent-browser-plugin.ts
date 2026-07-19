import fs from "node:fs/promises";
import path from "node:path";

/**
 * Provider name the agent can pass explicitly (`--provider instrument`) to
 * force the task browser; it is also the default via AGENT_BROWSER_PROVIDER.
 */
export const INSTRUMENT_PROVIDER_NAME = "instrument";

const PLUGIN_FILENAME = "instrument-provider.mjs";

/**
 * agent-browser `browser.provider` plugin (agent-browser.plugin.v1): one JSON
 * request on stdin, one JSON response on stdout. `browser.launch` answers with
 * the workspace CDP bridge URL received as argv[2]; `browser.close` is a no-op
 * because Studio owns the WebContentsView lifecycle and a CDP disconnect is
 * all the daemon needs. Standalone ESM with no imports so any node-compatible
 * runtime (node in dev/tests, Electron with ELECTRON_RUN_AS_NODE in packaged
 * builds) can execute it.
 */
const INSTRUMENT_PROVIDER_PLUGIN_SOURCE = `const PROTOCOL = "agent-browser.plugin.v1";
const cdpUrl = process.argv[2];

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}

const respond = (body) => {
  process.stdout.write(JSON.stringify({ protocol: PROTOCOL, ...body }));
};

let request;
try {
  request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
} catch {
  respond({ error: "invalid JSON request", success: false });
  process.exit(0);
}

if (request.protocol !== PROTOCOL) {
  respond({ error: "unsupported protocol", success: false });
} else if (request.type === "plugin.manifest") {
  respond({
    manifest: {
      capabilities: ["browser.provider"],
      description: "Instrument-managed task browser",
      name: "${INSTRUMENT_PROVIDER_NAME}",
    },
    success: true,
  });
} else if (request.type === "browser.launch") {
  if (cdpUrl) {
    respond({ browser: { cdpUrl, directPage: false }, success: true });
  } else {
    respond({ error: "missing CDP URL argument", success: false });
  }
} else if (request.type === "browser.close") {
  respond({ success: true });
} else {
  respond({ error: "unsupported request type: " + request.type, success: false });
}
`;

/**
 * Registry value for AGENT_BROWSER_PLUGINS. The CDP URL travels in plugin
 * `args` (not env) because the registry is re-read from the client env on
 * every invocation and forwarded in the command envelope, so a bridge URL
 * change never leaves a stale value in a long-lived daemon's environment.
 */
export function instrumentPluginRegistry({
  cdpUrl,
  pluginPath,
}: {
  cdpUrl: string;
  pluginPath: string;
}) {
  return JSON.stringify([
    {
      args: [pluginPath, cdpUrl],
      capabilities: ["browser.provider"],
      command: process.execPath,
      name: INSTRUMENT_PROVIDER_NAME,
    },
  ]);
}

/** Write the plugin script into dir (idempotent) and return its path. */
export async function writeInstrumentProviderPlugin(dir: string) {
  const pluginPath = path.join(dir, PLUGIN_FILENAME);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(pluginPath, INSTRUMENT_PROVIDER_PLUGIN_SOURCE);
  return pluginPath;
}
