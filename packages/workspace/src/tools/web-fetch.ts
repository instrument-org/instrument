import ms from "ms";
import { z } from "zod";

import { executeError } from "../lib/execute-error";
import { setupTool } from "./create-tool";

export const WebFetch = setupTool({
  inputSchema: z.object({
    url: z.string().optional().meta({ description: "URL to read." }),
  }),
  name: "web_fetch",
  outputSchema: z.json(),
}).create({
  description: "Read content from a web page or PDF.",
  execute: () =>
    Promise.resolve(
      executeError("Web fetch must be executed by the selected AI provider."),
    ),
  readOnly: true,
  timeoutMs: ms("1 second"),
  toModelOutput: ({ output }) => ({ type: "json", value: output }),
});
