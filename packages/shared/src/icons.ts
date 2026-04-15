import { type IconName as LucideIconName } from "lucide-react/dynamic";
import { z } from "zod";

const TAB_ICONS = [
  "credit-card",
  "file-text",
  "flask-conical",
  "globe",
  "our-app",
  "table-properties",
  "message-circle",
  "square-dashed",
  "telescope",
  "squircle",
  "terminal",
] as const satisfies ("our-app" | LucideIconName)[];

export const TabIconsSchema = z.enum(TAB_ICONS);

export type TabIconName = (typeof TAB_ICONS)[number];
