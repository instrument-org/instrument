import { StudioIcon } from "@/client/components/studio-icon";
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

export const IconMap: Record<TabIconName, Icon | typeof StudioIcon> = {
  bug: BugIcon,
  "credit-card": CreditCardIcon,
  "file-text": FileTextIcon,
  "flask-conical": FlaskIcon,
  globe: GlobeIcon,
  "our-app": StudioIcon,
  "table-properties": TableIcon,
  terminal: TerminalIcon,
} as const;
