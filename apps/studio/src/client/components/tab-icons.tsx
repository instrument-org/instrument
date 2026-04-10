import { StudioIcon } from "@/client/components/studio-icon";
import { type TabIconName } from "@instrument-org/shared/icons";
import {
  CreditCard,
  FileText,
  FlaskConical,
  Globe,
  type LucideIcon,
  MessageCircle,
  SquareDashed,
  Squircle,
  TableProperties,
  Telescope,
  Terminal,
} from "lucide-react";

export const IconMap: Record<TabIconName, LucideIcon | typeof StudioIcon> = {
  "credit-card": CreditCard,
  "file-text": FileText,
  "flask-conical": FlaskConical,
  globe: Globe,
  "message-circle": MessageCircle,
  quests: StudioIcon, // TODO(rename)
  "square-dashed": SquareDashed,
  squircle: Squircle,
  "table-properties": TableProperties,
  telescope: Telescope,
  terminal: Terminal,
} as const;
