import { cn } from "@/client/lib/utils";
import { InfoIcon } from "@phosphor-icons/react/Info";
import { LightbulbIcon } from "@phosphor-icons/react/Lightbulb";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { WarningOctagonIcon } from "@phosphor-icons/react/WarningOctagon";
import {
  Children,
  type ComponentProps,
  isValidElement,
  type ReactNode,
} from "react";
import { type ExtraProps } from "react-markdown";

import { type AlertType, alertTypeOf } from "./remark-reply-asides";

const ALERTS: Record<
  AlertType,
  { className: string; icon: ReactNode; label: string; titleClassName: string }
> = {
  caution: {
    className: "bg-error-500/[0.07] dark:bg-error-500/[0.14]",
    icon: <WarningOctagonIcon />,
    label: "Caution",
    titleClassName: "text-error-700 dark:text-error-300",
  },
  important: {
    className: "bg-brand-500/[0.07] dark:bg-brand-500/[0.14]",
    icon: <WarningCircleIcon />,
    label: "Important",
    titleClassName: "text-brand-text",
  },
  note: {
    className: "bg-muted",
    icon: <InfoIcon />,
    label: "Note",
    titleClassName: "text-muted-foreground",
  },
  tip: {
    className: "bg-muted",
    icon: <LightbulbIcon />,
    label: "Tip",
    titleClassName: "text-muted-foreground",
  },
  warning: {
    className: "bg-warning-500/[0.09] dark:bg-warning-500/[0.13]",
    icon: <WarningIcon />,
    label: "Warning",
    titleClassName: "text-warning-700 dark:text-warning-300",
  },
};

/** Whether a rendered child is the paragraph `remarkReplyAsides` marked as an alert's title. */
const isAlertTitle = (child: ReactNode) =>
  isValidElement<ExtraProps>(child) &&
  child.props.node?.properties.dataAlertTitle !== undefined;

/**
 * A blockquote, drawn as what `remarkReplyAsides` marked it: a GitHub alert
 * as a quiet aside with its type's mark and title, and any other quote as a
 * quote. A quote's source line is a paragraph of its own inside it, set
 * small and muted in CSS (`p[data-quote-source]`), so the quote's border
 * runs down beside it.
 */
export function ReplyBlockquote({
  children,
  node,
  ...props
}: ComponentProps<"blockquote"> & ExtraProps) {
  const alert = alertTypeOf(node?.properties.dataAlert);
  if (!alert) {
    return <blockquote {...props}>{children}</blockquote>;
  }
  const { className, icon, label, titleClassName } = ALERTS[alert];
  const parts = Children.toArray(children);
  const title = parts.find(isAlertTitle);
  const body = parts.filter(
    (part) =>
      part !== title && (typeof part !== "string" || part.trim() !== ""),
  );
  return (
    <aside
      className={cn(
        "my-[1.25em] rounded-xl px-[1em] py-[0.75em] first:mt-0 last:mb-0",
        className,
      )}
      data-alert={alert}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0",
          titleClassName,
          body.length > 0 && "mb-1",
        )}
      >
        {icon}
        <span className="min-w-0 [&>p]:m-0 [&>p]:inline">{title ?? label}</span>
      </div>
      <div className="[&>:first-child]:mt-0 [&>:last-child]:mb-0">{body}</div>
    </aside>
  );
}
