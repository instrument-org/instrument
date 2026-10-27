import ms from "ms";
import { dedent } from "radashi";
import { z } from "zod";

import { executeError } from "../lib/execute-error";
import { defineCapability } from "../lib/capabilities/define";
import { modelTool } from "../lib/capabilities/tool";

export const unavailableCapability = defineCapability({
  input: z.looseObject({}),
  name: "tools.unavailable",
  summary: "Stands in for a recorded call to a tool this build does not have.",
  surfaces: {
    tool: {
      description: dedent`
    A placeholder tool for unknown or unavailable tools.

    - This tool is used when a requested tool is not available or not implemented.
    - It provides a standardized response for missing functionality.
  `,
      execute: () =>
        Promise.resolve(
          executeError("This tool is not available or not implemented."),
        ),
      readOnly: true,
      timeoutMs: () => ms("1 second"),
      toModelOutput: () => {
        return {
          type: "error-text",
          value: "This tool is not available.",
        };
      },
      name: "unavailable",
      output: z.any(),
    },
  },
});

export const Unavailable = modelTool(unavailableCapability);
