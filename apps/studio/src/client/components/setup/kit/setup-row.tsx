import { Button } from "@/client/components/ui/button";
import { cn } from "@/client/lib/utils";
import { APP_NAME } from "@instrument-org/shared";
import { BellRingingIcon } from "@phosphor-icons/react/BellRinging";
import { BellSimpleIcon } from "@phosphor-icons/react/BellSimple";
import { BellSimpleSlashIcon } from "@phosphor-icons/react/BellSimpleSlash";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { Children, Fragment, type ReactNode } from "react";

/**
 * A row in a white card: an icon in its well, two lines, and what the row
 * offers at its end. `muted` is the warm well for a state that is fine but
 * not what was hoped for, such as notifications turned off. In a
 * `SetupRowList` the row is one of the list's, with no card of its own, and
 * `icon` is drawn as given (a `BrandTile`, the app icon).
 */
export function SetupRow({
  className,
  end,
  icon,
  inList = false,
  line,
  muted = false,
  title,
}: {
  className?: string;
  /** A small button (`SetupRowButton`), or a word saying where the row stands. */
  end?: ReactNode;
  icon: ReactNode;
  inList?: boolean;
  line?: ReactNode;
  muted?: boolean;
  title: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex max-w-full items-center gap-3.5",
        inList
          ? "h-16 w-140 py-3 pr-3 pl-2"
          : "w-115 rounded-2xl border bg-card py-3 pr-4 pl-3",
        className,
      )}
    >
      {inList ? (
        icon
      ) : (
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-[11px] [&_svg]:size-5",
            muted
              ? "bg-brown-100 text-brown-700 dark:bg-white/5 dark:text-brown-300"
              : "bg-brand-25 text-brand-700 dark:bg-white/5 dark:text-brand-300",
          )}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {line && <p className="text-xs text-muted-foreground">{line}</p>}
      </div>
      {end}
    </div>
  );
}

/**
 * Rows stacked in one white card, a hairline between each two that starts
 * where the rows' text does.
 */
export function SetupRowList({
  children,
  className,
}: {
  /** `SetupRow`s with `inList`. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex max-w-full flex-col rounded-2xl border bg-card p-2",
        className,
      )}
    >
      {Children.toArray(children).map((row, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <div aria-hidden className="pl-17.5">
              <div className="h-px bg-gray-100 dark:bg-white/5" />
            </div>
          )}
          {row}
        </Fragment>
      ))}
    </div>
  );
}

/** The small button at a row's end: `primary` for the way on, plain otherwise. */
export function SetupRowButton({
  children,
  disabled,
  onClick,
  primary = false,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <Button
      className="h-7.5 px-4.5 text-xs"
      disabled={disabled}
      onClick={onClick}
      variant={primary ? "brand" : "default"}
    >
      {children}
    </Button>
  );
}

/**
 * The notifications row in each of its states: asking, a test notification
 * sent and waiting on its click, allowed, and turned off by the system.
 */
export function NotificationRow({
  line,
  onAllow,
  onOpenSettings,
  onSendAgain,
  state,
}: {
  /** The line under "Notifications" while asking, which Figma words two ways. */
  line?: string;
  onAllow?: () => void;
  onOpenSettings?: () => void;
  onSendAgain?: () => void;
  state: "allowed" | "ask" | "off" | "sent";
}) {
  switch (state) {
    case "ask": {
      return (
        <SetupRow
          end={
            onAllow && (
              <SetupRowButton onClick={onAllow} primary>
                Allow
              </SetupRowButton>
            )
          }
          icon={<BellSimpleIcon />}
          line={line ?? "Finished tasks and questions"}
          title="Notifications"
        />
      );
    }
    case "sent": {
      return (
        <SetupRow
          end={
            onSendAgain && (
              <SetupRowButton onClick={onSendAgain}>Send again</SetupRowButton>
            )
          }
          icon={<BellRingingIcon />}
          line="If it didn't show up, we can send another one"
          title="Click the notification we just sent"
        />
      );
    }
    case "allowed": {
      return (
        <SetupRow
          end={
            <span className="flex items-center gap-1.5 text-sm font-medium text-brand-700 dark:text-brand-300">
              <CheckCircleIcon className="size-4" />
              Allowed
            </span>
          }
          icon={<BellSimpleIcon />}
          line="Finished tasks and questions"
          title="Notifications"
        />
      );
    }
    case "off": {
      return (
        <SetupRow
          end={
            onOpenSettings && (
              <SetupRowButton onClick={onOpenSettings}>
                Open settings
              </SetupRowButton>
            )
          }
          icon={<BellSimpleSlashIcon />}
          line={`Your computer is blocking them for ${APP_NAME}. Enable them in settings.`}
          muted
          title="Notifications are turned off"
        />
      );
    }
  }
}
