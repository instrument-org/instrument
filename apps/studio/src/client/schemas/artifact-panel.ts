import { z } from "zod";

// Self-contained traversal check: defense-in-depth before the request reaches
// the backend (the real guard). Kept dependency-free so this renderer schema
// does not pull node:path into the browser bundle.
const filePathSchema = z
  .string()
  .refine(
    (val) => !val.split(/[/\\]/).includes(".."),
    "Path must not contain '..' segments",
  );

export const artifactPanelSchema = z.object({
  filePath: filePathSchema,
  type: z.literal("file"),
});

export type ArtifactPanel = z.output<typeof artifactPanelSchema>;
