import { z } from "zod";

const SupportedEditorIdSchema = z.enum([
  "alacritty",
  "cmd",
  "cursor",
  "iterm",
  "powershell",
  "terminal",
  "vscode",
]);

export type SupportedEditorId = z.output<typeof SupportedEditorIdSchema>;

export const OpenTaskInTypeSchema = z.union([
  z.literal("show-in-folder"),
  SupportedEditorIdSchema,
]);

export type OpenTaskInType = z.output<typeof OpenTaskInTypeSchema>;

export const SupportedEditorSchema = z.object({
  available: z.boolean(),
  id: SupportedEditorIdSchema,
  name: z.string(),
});

export type SupportedEditor = z.output<typeof SupportedEditorSchema>;
