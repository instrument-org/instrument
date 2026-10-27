import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { macAppNamed } from "./apps";
import { systemBackend } from "./backend";
import { createMacAppServer } from "./server";

/**
 * The bundled Mac apps' MCP server over stdio, started by the app-call path
 * as a local MCP app's server is: `<this file> <server name>`, with the
 * helper's path in `INSTRUMENT_MAC_HELPER` where the build carries it.
 *
 * It runs as Node from the app's own executable, as a child of the app, and
 * starts the helper and `osascript` as children of its own, so macOS holds
 * the app responsible for all of them and asks about Instrument.
 */
const name = process.argv[2] ?? "";
const app = macAppNamed(name);
if (app === undefined) {
  process.stderr.write(`No Mac app server is called "${name}".\n`);
  process.exit(64);
}
const server = createMacAppServer(
  app,
  systemBackend(process.env.INSTRUMENT_MAC_HELPER || undefined),
);
await server.connect(new StdioServerTransport());
