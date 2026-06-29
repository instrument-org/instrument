import { normalizeTaskFilePath } from "@instrument-org/workspace/client";
import { z } from "zod";

// Self-contained traversal check: defense-in-depth before the request reaches
// the backend (the real guard). Kept dependency-free so this renderer schema
// does not pull node:path into the browser bundle.
//
// Writers source filePath from either the task file index (bare) or a
// tool output (agent-facing "./"-prefixed convention). Normalize here, at
// the single point every artifactPanel write/read passes through, so the
// rest of the app can compare and display filePath without caring which
// convention it came from.
const filePathSchema = z
  .string()
  .refine(
    (val) => !val.split(/[/\\]/).includes(".."),
    "Path must not contain '..' segments",
  )
  .transform(normalizeTaskFilePath);

export const artifactPanelSchema = z.discriminatedUnion("type", [
  z.object({
    filePath: filePathSchema,
    modifiedAt: z.number(),
    type: z.literal("file"),
  }),
  // The agent browser, hosted in the artifact panel area. The target is derived
  // from the task id + selected session, so no extra fields are needed.
  z.object({ type: z.literal("browser") }),
]);

export type ArtifactPanel = z.output<typeof artifactPanelSchema>;
