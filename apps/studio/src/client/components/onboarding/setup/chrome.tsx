import { useSetup } from "@/client/components/onboarding/setup/context";
import {
  PROGRESS_DOTS,
  progressDot,
} from "@/client/components/onboarding/setup/flow";
import { Button } from "@/client/components/ui/button";
import { WindowControls } from "@/client/components/window-controls";
import { cn, isMacOS } from "@/client/lib/utils";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { type ComponentProps, type ReactNode } from "react";

/**
 * One page of the setup assistant, in the rhythm of a setup assistant: one
 * question per page, an illustration on top, Back at the bottom left, the
 * progress dots in the middle, Skip and the next button at the right.
 *
 * `footer={false}` leaves the bar off, for the pages that stand alone
 * (Welcome, Welcome back). Back shows whenever there is a page behind this
 * one, unless `back={false}`.
 */
export function SetupPage({
  align = "center",
  back,
  children,
  footer = true,
  next,
  skip,
}: {
  align?: "center" | "top";
  back?: boolean;
  children: ReactNode;
  footer?: boolean;
  next?: {
    disabled?: boolean;
    label: string;
    onClick: () => void;
    /** The light button, for a page whose choice is not made yet. */
    quiet?: boolean;
  };
  skip?: { label?: string; onClick: () => void };
}) {
  const { dispatch, state } = useSetup();
  const dot = progressDot(state.step);
  const hasBack = (back ?? true) && state.history.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div
          className={cn(
            "flex min-h-full flex-col items-center px-20 pb-6",
            align === "center" && "justify-center",
          )}
        >
          {children}
        </div>
      </div>
      {footer && (
        <div className="flex h-19 shrink-0 items-center px-8">
          <div className="flex w-56">
            {hasBack && (
              <button
                className="flex items-center gap-1 text-sm font-medium text-foreground/55 hover:text-foreground/80"
                onClick={() => {
                  dispatch({ type: "back" });
                }}
                type="button"
              >
                <CaretLeftIcon className="size-3.75" weight="bold" />
                Back
              </button>
            )}
          </div>
          <div className="flex flex-1 justify-center">
            {dot !== null && <ProgressDots active={dot} />}
          </div>
          <div className="flex w-56 items-center justify-end gap-6">
            {skip && (
              <button
                className="text-sm font-medium text-foreground/55 hover:text-foreground/80"
                onClick={skip.onClick}
                type="button"
              >
                {skip.label ?? "Skip"}
              </button>
            )}
            {next && (
              <SetupPill
                disabled={next.disabled}
                kind={next.quiet ? "light" : "brand"}
                onClick={next.onClick}
              >
                {next.label}
              </SetupPill>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressDots({ active }: { active: number }) {
  return (
    <div aria-hidden className="flex items-center gap-2">
      {Array.from({ length: PROGRESS_DOTS }, (_, index) => (
        <span
          className={cn(
            "h-1.5 rounded-full transition-all",
            index === active
              ? "w-5 bg-foreground/70"
              : "w-1.5 bg-foreground/15",
          )}
          key={index}
        />
      ))}
    </div>
  );
}

/** The assistant's rounded buttons: the brand one that moves on, or a light one. */
export function SetupPill({
  className,
  kind = "brand",
  size = "default",
  ...props
}: Omit<ComponentProps<typeof Button>, "size" | "variant"> & {
  kind?: "brand" | "light";
  size?: "default" | "large" | "small";
}) {
  return (
    <Button
      className={cn(
        "rounded-full font-medium",
        size === "default" && "h-10 px-6 text-sm",
        size === "large" && "h-11 px-8 text-[15px]",
        size === "small" && "h-8 px-4 text-[13px]",
        kind === "brand" && "shadow-[0_8px_18px_-8px_rgba(11,96,86,0.7)]",
        className,
      )}
      variant={kind === "brand" ? "brand" : "default"}
      {...props}
    />
  );
}

/** A page's illustration, serif title, and the line under it. */
export function SetupHead({
  illustration,
  subtitle,
  title,
}: {
  illustration?: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      {illustration && <div className="mb-5">{illustration}</div>}
      <h1 className="font-serif text-[34px] leading-[1.15] font-medium tracking-tight text-foreground">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-3 max-w-140 text-[15px] leading-relaxed text-balance text-foreground/60">
          {subtitle}
        </p>
      )}
    </div>
  );
}

/** An inset group of rows, with an optional caption above and note below. */
export function SetupGroup({
  caption,
  children,
  className,
  note,
}: {
  caption?: string;
  children: ReactNode;
  className?: string;
  note?: ReactNode;
}) {
  return (
    <div className={cn("w-130", className)}>
      {caption && (
        <p className="mb-1.5 px-4 text-xs font-medium text-foreground/45">
          {caption}
        </p>
      )}
      <div className="divide-y divide-foreground/[0.07] overflow-hidden rounded-2xl bg-card shadow-xs ring-1 ring-black/[0.07] dark:ring-white/10">
        {children}
      </div>
      {note && <p className="mt-2 px-4 text-xs text-foreground/45">{note}</p>}
    </div>
  );
}

export function SetupRow({
  control,
  detail,
  icon,
  title,
}: {
  control?: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3.5 px-4 py-3">
      {icon}
      <div className="flex min-w-0 flex-1 flex-col text-left">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {detail && <span className="text-xs text-foreground/50">{detail}</span>}
      </div>
      {control}
    </div>
  );
}

/** A small pill naming the account or provider the person connected. */
export function ConnectedChip({
  checked = false,
  icon,
  label,
}: {
  /** A brand check after the label, for a connection that just worked. */
  checked?: boolean;
  icon?: ReactNode;
  label: string;
}) {
  return (
    <div className="mb-6 flex h-8 items-center gap-2 rounded-full bg-card/80 pr-3 pl-1 text-[13px] text-foreground/70 ring-1 ring-black/[0.06]">
      {icon && (
        <span className="flex size-6 items-center justify-center rounded-full bg-card">
          {icon}
        </span>
      )}
      {label}
      {checked && (
        <CheckCircleIcon
          className="-mr-1 size-3.5 text-brand-600 dark:text-brand-400"
          weight="fill"
        />
      )}
    </div>
  );
}

/** A quiet link under a page's content: another way to go, or a retry. */
export function SetupQuietLink({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "text-[13px] font-medium text-foreground/55 hover:text-foreground/80",
        className,
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

/**
 * The ground every page sits on, with the title bar's drag strip at the top
 * (clear of the macOS traffic lights, and holding the window's own buttons
 * where the app draws them) and the soft glow under it. Someone new has the
 * window at setup's fixed size, so there is no Maximize.
 */
export function SetupGround({ children }: { children: ReactNode }) {
  const { returning } = useSetup();
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-background select-none">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-110 bg-[radial-gradient(52%_100%_at_50%_0%,color-mix(in_oklab,var(--color-brand-200)_60%,transparent)_0%,transparent_74%)] dark:opacity-30"
      />
      <div
        className={cn(
          "relative flex h-12 shrink-0 justify-end [-webkit-app-region:drag]",
          isMacOS() && "pl-20",
        )}
      >
        <WindowControls maximizable={returning} />
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
