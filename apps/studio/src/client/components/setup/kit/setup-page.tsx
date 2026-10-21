import { Button } from "@/client/components/ui/button";
import { cn } from "@/client/lib/utils";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { type ReactNode } from "react";

/**
 * One page of setup, as Figma draws every one: an optional picture over a
 * serif title and a gray line under it, the page's own content, and the
 * footer at the window's foot. The body scrolls on its own when the window
 * is zoomed past what fits, and the footer stays put.
 */
export function SetupPage({
  align = "top",
  children,
  className,
  footer,
  hero,
  subtitle,
  title,
}: {
  /** `top` sits under the window's band, as most frames do; `center` sits mid-window. */
  align?: "center" | "top";
  children?: ReactNode;
  className?: string;
  /** A `SetupFooter`, or nothing for a page with no footer (Welcome back). */
  footer?: ReactNode;
  /** What sits over the title: an illustration, the app icon, a brand tile. */
  hero?: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-17">
        <div
          className={cn(
            "flex min-h-full flex-col items-center pb-6",
            align === "center" ? "justify-center" : "pt-11",
            className,
          )}
        >
          {hero && <div className="mb-6 flex justify-center">{hero}</div>}
          <h1 className="max-w-235 text-center font-serif text-3xl/[38px] font-medium text-foreground">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-3 max-w-150 text-center text-base text-muted-foreground">
              {subtitle}
            </p>
          )}
          {children}
        </div>
      </div>
      {footer}
    </div>
  );
}

/**
 * Setup's footer: Back at the left, and at the right Continue in one of
 * Figma's four variants. `primary` is the way on; `quiet` is Continue drawn
 * as a plain button, so it reads as a skip; `off` is Continue not yet
 * available; `none` has no Continue, only `skip` when a page offers one.
 * Back shows wherever `onBack` is given and `back` isn't false.
 */
export function SetupFooter({
  back = true,
  label = "Continue",
  next = "primary",
  onBack,
  onContinue,
  pending = false,
  skip,
}: {
  back?: boolean;
  /** What Continue says. */
  label?: string;
  next?: "none" | "off" | "primary" | "quiet";
  onBack?: () => void;
  onContinue?: () => void;
  /** Continue is on its way: shown, and not pressable twice. */
  pending?: boolean;
  /** A quiet link in Continue's place, on a page whose way on is a skip ("Not now"). */
  skip?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex shrink-0 items-center justify-between px-8 pt-5 pb-6">
      <div className="flex min-w-50">
        {back && onBack && (
          <Button
            className="h-9 px-5 text-muted-foreground"
            onClick={onBack}
            variant="ghost"
          >
            <CaretLeftIcon />
            Back
          </Button>
        )}
      </div>
      <div className="flex items-center gap-6">
        {skip && (
          <Button
            className="h-9 px-5 text-muted-foreground"
            onClick={skip.onClick}
            variant="ghost"
          >
            {skip.label}
          </Button>
        )}
        {next !== "none" && (
          <Button
            className="h-10 px-5 text-base"
            disabled={next === "off" || pending}
            onClick={onContinue}
            variant={next === "quiet" ? "default" : "brand"}
          >
            {label}
          </Button>
        )}
      </div>
    </div>
  );
}
