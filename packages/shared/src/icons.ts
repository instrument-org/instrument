import { z } from "zod";

const TAB_ICONS = [
  "code",
  "credit-card",
  "file-text",
  "flask-conical",
  "globe",
  "graduation-cap",
  "our-app",
  "project",
  "table-properties",
  "terminal",
] as const;

export const TabIconsSchema = z.enum(TAB_ICONS);

export type TabIconName = z.output<typeof TabIconsSchema>;
