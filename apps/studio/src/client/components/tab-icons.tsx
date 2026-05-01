import { AppIcon } from "@/client/components/studio-icon";
import { type TabIconName } from "@instrument-org/shared/icons";
import {
  BugIcon,
  CreditCardIcon,
  FileTextIcon,
  FlaskIcon,
  GlobeIcon,
  type Icon,
  TableIcon,
  TerminalIcon,
} from "@phosphor-icons/react";

export const IconMap: Record<TabIconName, Icon | typeof AppIcon> = {
  bug: BugIcon,
  "credit-card": CreditCardIcon,
  "file-text": FileTextIcon,
  "flask-conical": FlaskIcon,
  globe: GlobeIcon,
  "our-app": AppIcon,
  "table-properties": TableIcon,
  terminal: TerminalIcon,
} as const;
