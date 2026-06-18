import { normalizeProjectFilePath } from "@instrument-org/workspace/client";
import { z } from "zod";

// Self-contained traversal check: defense-in-depth before the request reaches
// the backend (the real guard). Kept dependency-free so this renderer schema
// does not pull node:path into the browser bundle.
//
// Writers source filePath from either the project file index (bare) or a
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
  .transform(normalizeProjectFilePath);

export const artifactPanelSchema = z.object({
  filePath: filePathSchema,
  type: z.literal("file"),
});

export type ArtifactPanel = z.output<typeof artifactPanelSchema>;
