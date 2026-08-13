import { BrandIcon } from "@/client/components/brand-icon";
import { type TabIconName } from "@instrument-org/shared/icons";
import {
  CardsThreeIcon,
  CodeIcon,
  CreditCardIcon,
  FileTextIcon,
  FlaskIcon,
  GlobeIcon,
  GraduationCapIcon,
  type Icon,
  TableIcon,
  TerminalIcon,
} from "@phosphor-icons/react";

export const IconMap: Record<TabIconName, Icon | typeof BrandIcon> = {
  code: CodeIcon,
  "credit-card": CreditCardIcon,
  "file-text": FileTextIcon,
  "flask-conical": FlaskIcon,
  globe: GlobeIcon,
  "graduation-cap": GraduationCapIcon,
  "our-app": BrandIcon,
  project: CardsThreeIcon,
  "table-properties": TableIcon,
  terminal: TerminalIcon,
} as const;
