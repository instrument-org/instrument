import { z } from "zod";

const TAB_ICONS = [
  "credit-card",
  "file-text",
  "flask-conical",
  "globe",
  "our-app",
  "table-properties",
  "terminal",
  "bug",
] as const;

export const TabIconsSchema = z.enum(TAB_ICONS);

export type TabIconName = (typeof TAB_ICONS)[number];
