import { displayLocale } from "@/client/lib/display-locale";
import { openReportDialog } from "@/client/atoms/report-dialog";
import { openSettings } from "@/client/atoms/settings-modal";
import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { Button } from "@/client/components/ui/button";
import { BELL_TOASTER } from "@/client/components/ui/sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { useWindow } from "@/client/components/window/context";
import { chatOfHref } from "@/client/components/window/window-href";
import {
  SIDEBAR_ICON_BUTTON,
  SIDEBAR_POPOVER_WIDTH,
  SidebarPopoverAnchor,
} from "@/client/components/window/sidebar-popover";
import { useTabGroupActions } from "@/client/components/window/tab-groups";
import { pendingProblemReport } from "@/client/lib/problem-reports";
import { formatAbsoluteTime } from "@/client/lib/relative-time";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { cn } from "@/client/lib/utils";
import { type BellNotice, isSignInAccountType } from "@/shared/notices";
import { type PendingProblem } from "@/shared/problem-reports";
import { APP_NAME } from "@instrument-org/shared";
import { BellIcon } from "@phosphor-icons/react/Bell";
import { ExclamationMarkIcon } from "@phosphor-icons/react/ExclamationMark";
import { MegaphoneSimpleIcon } from "@phosphor-icons/react/MegaphoneSimple";
import { ShieldCheckIcon } from "@phosphor-icons/react/ShieldCheck";
import { SparkleIcon } from "@phosphor-icons/react/Sparkle";
import { UserCircleIcon } from "@phosphor-icons/react/UserCircle";
import { ShieldWarningIcon } from "@phosphor-icons/react/ShieldWarning";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { XIcon } from "@phosphor-icons/react/X";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * The window's notifications, in its corner: what needs the person, and what
 * we have to tell them, and nothing else. A crash or hang from an earlier
 * session waits here to be sent or dismissed, under a red dot, and never
 * toasts, so someone whose app keeps crashing can let it wait. Notices from
 * us put a brand dot on the bell until it's opened; an important one also
 * toasts once, ever, and only one toasts per launch.
 */
export function NotificationsBell() {
  const { data: problems = [] } = useQuery(
    rpcClient.problems.live.pending.experimental_liveOptions(),
  );
  const { data: notices = [] } = useQuery(
    rpcClient.notices.live.list.experimental_liveOptions(),
  );
  const [open, setOpen] = useState(false);
  const markSeen = useMutation(rpcClient.notices.markSeen.mutationOptions());
  const { openScreen } = useWindow();
  const groups = useTabGroupActions();
  const openAction = (notice: BellNotice) => {
    // Acting on a notice from its toast has shown it, so the bell's dot for
    // it goes too.
    if (!notice.seen) {
      markSeen.mutate({ ids: [notice.id] });
    }
    if (notice.action && "settings" in notice.action) {
      setOpen(false);
      openSettings({
        ...(notice.action.setting && { setting: notice.action.setting }),
        tab: notice.action.settings,
      });
      return;
    }
    if (notice.action && "href" in notice.action) {
      setOpen(false);
      // A chat's notice comes forward at the chat's tab, where it has one.
      const chat = chatOfHref(notice.action.href);
      if (chat === undefined) {
        openScreen(notice.action.href, { newTab: true });
      } else {
        groups.revealChat(chat);
      }
      return;
    }
    void openNoticeLink(notice);
  };
  // A critical notice keeps the dot red until its cause is gone, seen or
  // not, as a problem does: there is nothing to do but act on it.
  const hasProblems =
    problems.length > 0 ||
    notices.some((notice) => notice.severity === "critical");
  const unseen = notices.filter((notice) => !notice.seen);
  const empty = problems.length === 0 && notices.length === 0;

  useToastLoudNotices(notices, openAction);

  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next);
        // The bell lists what its toasts said, and they'd sit over it.
        if (next) {
          for (const notice of notices) {
            toast.dismiss(notice.id);
          }
        }
        if (next && unseen.length > 0) {
          markSeen.mutate({ ids: unseen.map((notice) => notice.id) });
        }
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <button
          aria-label={
            hasProblems || unseen.length > 0
              ? "Notifications, something new"
              : "Notifications"
          }
          className={cn("relative", SIDEBAR_ICON_BUTTON)}
          type="button"
        >
          <BellIcon className="size-4" />
          {(hasProblems || unseen.length > 0) && (
            <span
              className={cn(
                "absolute top-1 right-1 size-2 rounded-full ring-2 ring-ground",
                hasProblems ? "bg-destructive" : "bg-brand-600",
              )}
            />
          )}
        </button>
      </PopoverTrigger>
      <SidebarPopoverAnchor side="bottom" />
      <PopoverContent
        align="start"
        // A narrow sidebar's width breaks a notice's words, so there it runs
        // out past the sidebar.
        className="min-w-72 overflow-hidden p-0"
        // Focus the panel, not its first row's button, so opening the bell
        // doesn't light that row up; Tab still walks into the rows.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (event.currentTarget instanceof HTMLElement) {
            event.currentTarget.focus();
          }
        }}
        style={{ width: SIDEBAR_POPOVER_WIDTH }}
      >
        <div className="flex h-11 items-center px-4 text-[13px] font-semibold">
          Notifications
        </div>
        {empty ? (
          <div className="flex flex-col items-center gap-2 px-4 pt-4 pb-9 text-center">
            <span className="grid size-9 place-items-center rounded-full bg-foreground/6 text-muted-foreground">
              <BellIcon className="size-4.5" />
            </span>
            <p className="text-[13px] text-muted-foreground">
              You're all caught up.
            </p>
          </div>
        ) : (
          <div className="flex max-h-[min(480px,calc(var(--radix-popover-content-available-height)/var(--content-zoom)))] flex-col gap-px overflow-y-auto px-1.5 pb-1.5">
            {problems.map((problem) => (
              <ProblemItem
                key={problem.fingerprint}
                onReport={() => {
                  setOpen(false);
                  openReportDialog(pendingProblemReport(problem));
                }}
                problem={problem}
              />
            ))}
            {notices.map((notice) => (
              <NoticeItem
                key={notice.id}
                notice={notice}
                onAction={() => {
                  openAction(notice);
                }}
              />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Toasts a notice marked important or critical, once: the main process says
 * whether this one may go (never toasted, nothing else toasted this launch)
 * and remembers that it did. A critical one stays until it's closed or its
 * notice leaves the list.
 */
function useToastLoudNotices(
  notices: BellNotice[],
  onAction: (notice: BellNotice) => void,
) {
  const asked = useRef(new Set<string>());
  const shown = useRef(new Set<string>());
  const listed = useRef<BellNotice[]>([]);
  const focused = useSyncExternalStore(subscribeToWindowFocus, () =>
    document.hasFocus(),
  );
  useEffect(() => {
    listed.current = notices;
    // A notice whose cause went away (an account signed in again, a choice
    // made in Settings) leaves the list, and its toast goes with it.
    for (const id of shown.current) {
      if (!notices.some((notice) => notice.id === id)) {
        shown.current.delete(id);
        toast.dismiss(id);
      }
    }
    // A toast spent while the window is behind another app is never seen, as
    // when an update restart brings the window back without focus, so it
    // waits for the window to be focused.
    if (!focused) {
      return;
    }
    for (const notice of notices) {
      if (notice.severity === "info" || asked.current.has(notice.id)) {
        continue;
      }
      asked.current.add(notice.id);
      void rpcClient.notices.claimToast
        .call({ id: notice.id })
        .then((granted) => {
          // Its cause may have gone while the answer was on its way.
          if (!granted || !listed.current.some(({ id }) => id === notice.id)) {
            return;
          }
          shown.current.add(notice.id);
          showNoticeToast(notice, () => {
            onAction(notice);
          });
        })
        .catch(() => {
          // A toast that couldn't be claimed waits in the bell like the rest.
        });
    }
  }, [focused, notices, onAction]);
}

/**
 * Toasts a notice as the bell's card, from the bell's corner: critical ones
 * stay until closed. Closing it leaves the notice in the bell; its action
 * closes it and does what it says.
 */
export function showNoticeToast(notice: BellNotice, onAction: () => void) {
  toast.drawn(
    (id) => (
      <BellRow
        action={
          notice.action && {
            label: notice.action.label,
            onClick: () => {
              toast.dismiss(id);
              onAction();
            },
          }
        }
        body={notice.body}
        onDismiss={() => {
          toast.dismiss(id);
        }}
        title={notice.title}
        {...noticeLook(notice)}
      />
    ),
    {
      actionable: !!notice.action,
      description: notice.body,
      duration: notice.severity === "critical" ? Infinity : undefined,
      id: notice.id,
      title: notice.title,
      toasterId: BELL_TOASTER,
      warning: warns(notice),
    },
  );
}

function subscribeToWindowFocus(onChange: () => void) {
  window.addEventListener("focus", onChange);
  window.addEventListener("blur", onChange);
  return () => {
    window.removeEventListener("focus", onChange);
    window.removeEventListener("blur", onChange);
  };
}

function openNoticeLink(notice: BellNotice) {
  if (!notice.action || !("url" in notice.action)) {
    return Promise.resolve();
  }
  return rpcClient.utils.openExternalLink
    .call({ url: notice.action.url })
    .catch((error: unknown) => {
      toast.error("Couldn't open that link", { cause: error });
    });
}

/**
 * Whether a notice warns, drawn with the warning shield and toasted as a
 * warning: a critical one, and a security one loud enough to toast.
 */
function warns(notice: BellNotice): boolean {
  return (
    notice.severity === "critical" ||
    (notice.kind === "security" && notice.severity === "important")
  );
}

const NOTICE_ICON = {
  account: UserCircleIcon,
  announcement: MegaphoneSimpleIcon,
  security: ShieldCheckIcon,
  update: SparkleIcon,
  "whats-new": MegaphoneSimpleIcon,
} satisfies Record<BellNotice["kind"], unknown>;

/**
 * How urgent a row reads, in its icon's color: a problem or a critical
 * notice is red, one that warns is amber, and the rest are quiet.
 */
type Tone = "danger" | "neutral" | "warning";

const TONE_CLASS = {
  danger: "bg-destructive/10 text-destructive dark:bg-destructive/20",
  neutral: "bg-foreground/6 text-muted-foreground",
  warning:
    "bg-warning-500/15 text-warning-700 dark:bg-warning-500/15 dark:text-warning-300",
} satisfies Record<Tone, string>;

function noticeTone(notice: BellNotice): Tone {
  if (notice.severity === "critical") {
    return "danger";
  }
  return warns(notice) ? "warning" : "neutral";
}

/**
 * How a notice's row looks at its left: the icon for its kind, tinted by how
 * urgent it is. A signed-out account shows its provider's own mark instead,
 * so which account it is reads before the title does, with an amber badge
 * when signing back in is what the default model is waiting on.
 */
function noticeLook(
  notice: BellNotice,
): Pick<BellRowProps, "alert" | "icon" | "mark" | "tone"> {
  const setting =
    notice.action && "setting" in notice.action
      ? notice.action.setting
      : undefined;
  if (
    notice.kind === "account" &&
    setting !== undefined &&
    isSignInAccountType(setting)
  ) {
    return {
      alert: notice.severity === "critical",
      icon: NOTICE_ICON.account,
      mark: <AIProviderIcon className="size-4" colored type={setting} />,
      tone: "neutral",
    };
  }
  return {
    icon:
      notice.kind === "security" && warns(notice)
        ? ShieldWarningIcon
        : NOTICE_ICON[notice.kind],
    tone: noticeTone(notice),
  };
}

function NoticeItem({
  notice,
  onAction,
}: {
  notice: BellNotice;
  onAction: () => void;
}) {
  const dismiss = useMutation({
    mutationFn: () => rpcClient.notices.dismiss.call({ id: notice.id }),
    onError: (error) => {
      toast.error("Couldn't dismiss it", { cause: error });
    },
  });

  return (
    <BellRow
      action={
        notice.action && { label: notice.action.label, onClick: onAction }
      }
      at={Date.parse(notice.publishedAt)}
      body={notice.body}
      dismissing={dismiss.isPending}
      onDismiss={() => {
        dismiss.mutate();
      }}
      title={notice.title}
      {...noticeLook(notice)}
    />
  );
}

function ProblemItem({
  onReport,
  problem,
}: {
  onReport: () => void;
  problem: PendingProblem;
}) {
  const dismiss = useMutation({
    mutationFn: () =>
      rpcClient.problems.dismiss.call({ fingerprint: problem.fingerprint }),
    onError: (error) => {
      toast.error("Couldn't dismiss it", { cause: error });
    },
  });
  const crashed = problem.kind === "crash";

  return (
    <BellRow
      action={{ label: "Send a report", onClick: onReport }}
      at={problem.lastAt}
      body={
        crashed
          ? "Sending a report helps us fix what went wrong."
          : "It may have stopped responding before it was quit. A report helps us find out why."
      }
      dismissing={dismiss.isPending}
      icon={WarningCircleIcon}
      onDismiss={() => {
        dismiss.mutate();
      }}
      title={
        crashed
          ? `${APP_NAME} quit unexpectedly`
          : `${APP_NAME} didn't close properly`
      }
      tone="danger"
    />
  );
}

type BellRowProps = {
  action?: { label: string; onClick: () => void };
  /** An amber badge on the icon, for a row that needs the person now. */
  alert?: boolean;
  at?: number;
  body: string;
  dismissing?: boolean;
  icon: typeof BellIcon;
  /** Drawn in the icon's place, on the quiet circle, in its own colors. */
  mark?: ReactNode;
  onDismiss: () => void;
  title: string;
  tone: Tone;
};

/**
 * One row of the bell: its icon tinted by how urgent it is, the title and
 * when, the line under it, and its one action. Dismissing is the close
 * button that takes the time's place while the row is hovered or holds
 * focus, so a list of several doesn't read as a column of Dismiss buttons.
 *
 * As a toast (`at` left out) it is the same card on its own: no time, since
 * it has just come, and a close button that's always there and only closes
 * the toast, leaving the notice waiting in the bell.
 */
function BellRow({
  action,
  alert = false,
  at,
  body,
  dismissing = false,
  icon: Icon,
  mark,
  onDismiss,
  title,
  tone,
}: BellRowProps) {
  const inList = at !== undefined;
  return (
    <div
      className={cn(
        "group/row relative flex gap-3 rounded-xl pr-3 pl-2",
        // The list's rows stand further apart, for the hairline between them.
        inList ? "py-3.5" : "py-2.5",
        // A hairline above each row after the first, which a highlighted
        // row hides on both its edges so the highlight stands on its own.
        inList &&
          "before:pointer-events-none before:absolute before:inset-x-2 before:top-0 before:h-px before:bg-foreground/6 first:before:hidden hover:bg-foreground/4 hover:before:opacity-0 has-focus-visible:bg-foreground/4 has-focus-visible:before:opacity-0 [:has(:focus-visible)+&]:before:opacity-0 [:hover+&]:before:opacity-0",
      )}
    >
      <span
        className={cn(
          "relative grid size-8 shrink-0 place-items-center rounded-full",
          TONE_CLASS[tone],
        )}
      >
        {mark ?? <Icon className="size-4" weight="bold" />}
        {alert && (
          <span className="absolute -right-0.5 -bottom-0.5 grid size-3.5 place-items-center rounded-full bg-warning-500 text-warning-900 ring-2 ring-popover">
            <ExclamationMarkIcon className="size-2.5" weight="bold" />
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn("flex items-start gap-3", !inList && "pr-6")}>
          <span className="min-w-0 flex-1 text-[13px] leading-5 font-medium text-pretty">
            {title}
          </span>
          {inList && (
            <span
              className="shrink-0 text-[11px] leading-4.5 text-muted-foreground/50 tabular-nums group-hover/row:invisible group-has-focus-visible/row:invisible"
              title={formatAbsoluteTime(new Date(at))}
            >
              {formatWhen(at)}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[13px] leading-5 text-pretty text-muted-foreground">
          {body}
        </p>
        {action && (
          <Button
            className="mt-2"
            onClick={action.onClick}
            size="xs"
            variant="secondary"
          >
            {action.label}
          </Button>
        )}
      </div>
      <Button
        aria-label={inList ? "Dismiss" : "Close"}
        className={cn(
          "absolute right-2 size-6 text-muted-foreground/60 not-disabled:hover:text-muted-foreground",
          // Centered on the title's first line, whichever padding the row has.
          inList ? "top-3" : "top-2",
          inList &&
            "opacity-0 group-hover/row:opacity-100 group-has-focus-visible/row:opacity-100",
        )}
        disabled={dismissing}
        onClick={onDismiss}
        size="icon-sm"
        variant="ghost"
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}

function formatWhen(at: number) {
  const date = new Date(at);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString(displayLocale, {
        hour: "numeric",
        minute: "2-digit",
      })
    : date.toLocaleDateString(displayLocale, {
        day: "numeric",
        month: "short",
      });
}
