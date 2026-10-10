import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import type { ComponentProps, ReactElement } from "react";

/**
 * A web page's row or tile with the page on hover: its whole title, which
 * the row may have cut short, and under it where the page is, as a person
 * reads an address. Props the trigger is handed (a context menu's, say)
 * reach the row.
 */
export function PageTooltip({
  children,
  title,
  url,
  ...props
}: Omit<ComponentProps<typeof TooltipTrigger>, "title"> & {
  children: ReactElement;
  title: string | undefined;
  url: string;
}) {
  const address = readableAddress(url);
  return (
    <Tooltip>
      <TooltipTrigger asChild {...props}>
        {children}
      </TooltipTrigger>
      <TooltipContent collisionPadding={10} maxWidth="22rem">
        {title ? (
          <span className="block font-medium wrap-break-word">{title}</span>
        ) : null}
        <span
          className={
            title
              ? "block break-all text-popover-foreground/60"
              : "block break-all"
          }
        >
          {address}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * An address the way a person reads it: the host and the path, decoded, with
 * no scheme, no trailing slash, and no query, which is the part only the site
 * reads.
 */
export function readableAddress(url: string): string {
  if (!URL.canParse(url)) {
    return url;
  }
  const parsed = new URL(url);
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  const address = `${parsed.host}${path}`.replace(/\/$/, "");
  try {
    return decodeURI(address);
  } catch {
    return address;
  }
}
