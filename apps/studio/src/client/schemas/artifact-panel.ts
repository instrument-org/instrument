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

export const artifactPanelSchema = z.discriminatedUnion("type", [
  // Legacy app-preview route state is accepted for old links, but the project
  // page intentionally ignores it while app-builder preview is dormant.
  z.object({ type: z.literal("app"), versionRef: z.string().optional() }),
  z.object({
    filePath: filePathSchema,
    fileVersion: z.string().optional(),
    type: z.literal("file"),
  }),
]);

export type ArtifactPanel = z.output<typeof artifactPanelSchema>;
