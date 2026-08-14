import { BrandIcon } from "@/client/components/brand-icon";
import { type TabIconName } from "@instrument-org/shared/icons";
import { type Icon } from "@phosphor-icons/react";
import { CardsThreeIcon } from "@phosphor-icons/react/CardsThree";
import { CodeIcon } from "@phosphor-icons/react/Code";
import { CreditCardIcon } from "@phosphor-icons/react/CreditCard";
import { FileTextIcon } from "@phosphor-icons/react/FileText";
import { FlaskIcon } from "@phosphor-icons/react/Flask";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { GraduationCapIcon } from "@phosphor-icons/react/GraduationCap";
import { TableIcon } from "@phosphor-icons/react/Table";
import { TerminalIcon } from "@phosphor-icons/react/Terminal";

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
