import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { type MacAppBackend } from "./backend";
import { MACOS_REFUSAL_META } from "./refusal";
import { type MacAppDefinition, MacosRefused, ToolRefusal } from "./tool";

/**
 * One Mac app's MCP server: its tools, each answering with its data as
 * `structuredContent` and the same as text. A refusal is `isError` with the
 * words for it; macOS keeping Instrument out of the app also names the app
 * and why under `MACOS_REFUSAL_META`, which is how the app-call path knows
 * to raise the macOS card rather than pass the words on.
 */
export function createMacAppServer(
  app: MacAppDefinition,
  backend: MacAppBackend,
): McpServer {
  const server = new McpServer({ name: app.server, version: "1.0.0" });
  for (const tool of app.tools) {
    server.registerTool(
      tool.name,
      {
        annotations: {
          openWorldHint: false,
          readOnlyHint: tool.readOnly,
          ...(!tool.readOnly && { destructiveHint: false }),
        },
        description: tool.description,
        inputSchema: tool.input,
        outputSchema: tool.output,
      },
      async (args, { signal }): Promise<CallToolResult> => {
        try {
          const answer = await tool.call(args, {
            app: { bundleId: app.bundleId, name: app.name },
            backend,
            signal,
          });
          return {
            content: [{ text: answer.text, type: "text" }],
            structuredContent: answer.structured,
          };
        } catch (error) {
          if (error instanceof MacosRefused) {
            return {
              _meta: {
                [MACOS_REFUSAL_META]: {
                  bundleId: app.bundleId,
                  reason: error.reason,
                },
              },
              content: [{ text: error.message, type: "text" }],
              isError: true,
            };
          }
          if (error instanceof ToolRefusal) {
            return {
              content: [{ text: error.message, type: "text" }],
              isError: true,
            };
          }
          throw error;
        }
      },
    );
  }
  return server;
}
