import { displayLocale } from "@/client/lib/display-locale";
import { openReportDialog } from "@/client/atoms/report-dialog";
import { openSettings } from "@/client/atoms/settings-modal";
import { Button } from "@/client/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { useAppTabs } from "@/client/components/window/app-tabs";
import { pendingProblemReport } from "@/client/lib/problem-reports";
import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { cn } from "@/client/lib/utils";
import { type BellNotice } from "@/shared/notices";
import { type PendingProblem } from "@/shared/problem-reports";
import { APP_NAME } from "@instrument-org/shared";
import { BellIcon } from "@phosphor-icons/react/Bell";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/ArrowsClockwise";
import { MegaphoneSimpleIcon } from "@phosphor-icons/react/MegaphoneSimple";
import { NewspaperClippingIcon } from "@phosphor-icons/react/NewspaperClipping";
import { ShieldCheckIcon } from "@phosphor-icons/react/ShieldCheck";
import { UserCircleIcon } from "@phosphor-icons/react/UserCircle";
import { ShieldWarningIcon } from "@phosphor-icons/react/ShieldWarning";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

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
  const appTabs = useAppTabs();
  const openAction = (notice: BellNotice) => {
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
      appTabs.open(notice.action.href);
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
        if (next && unseen.length > 0) {
          markSeen.mutate({ ids: unseen.map((notice) => notice.id) });
        }
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <Button
          aria-label={
            hasProblems || unseen.length > 0
              ? "Notifications, something new"
              : "Notifications"
          }
          // The new-tab plus's grey, across the bar.
          className="relative size-7 text-muted-foreground/70 [-webkit-app-region:no-drag]"
          size="icon-sm"
          variant="ghost-toolbar"
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
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-95 overflow-hidden p-0">
        <div className="flex h-10 items-center border-b border-border px-4 text-[13px] font-semibold">
          Notifications
        </div>
        {empty ? (
          <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
            You don't have any notifications.
          </p>
        ) : (
          <div className="max-h-[min(480px,calc(var(--radix-popover-content-available-height)/var(--content-zoom)))] divide-y divide-border overflow-y-auto">
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
  useEffect(() => {
    // A notice whose cause went away (an account signed in again, a choice
    // made in Settings) leaves the list, and its toast goes with it.
    for (const id of shown.current) {
      if (!notices.some((notice) => notice.id === id)) {
        shown.current.delete(id);
        toast.dismiss(id);
      }
    }
    for (const notice of notices) {
      if (notice.severity === "info" || asked.current.has(notice.id)) {
        continue;
      }
      asked.current.add(notice.id);
      void rpcClient.notices.claimToast
        .call({ id: notice.id })
        .then((granted) => {
          if (!granted) {
            return;
          }
          const show = warns(notice) ? toast.warning : toast.info;
          shown.current.add(notice.id);
          show(notice.title, {
            id: notice.id,
            action: notice.action && {
              label: notice.action.label,
              onClick: () => {
                onAction(notice);
              },
            },
            description: notice.body,
            duration: notice.severity === "critical" ? Infinity : undefined,
          });
        })
        .catch(() => {
          // A toast that couldn't be claimed waits in the bell like the rest.
        });
    }
  }, [notices, onAction]);
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
  update: ArrowsClockwiseIcon,
  "whats-new": NewspaperClippingIcon,
} satisfies Record<BellNotice["kind"], unknown>;

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
  const Icon = warns(notice) ? ShieldWarningIcon : NOTICE_ICON[notice.kind];

  return (
    <div className="flex gap-3 px-4 py-3">
      <span
        className={cn(
          "mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-muted",
          warns(notice)
            ? "text-warning-700 dark:text-warning-300"
            : "text-brand-600",
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 text-[13px] font-medium">
            {notice.title}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatWhen(Date.parse(notice.publishedAt))}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{notice.body}</p>
        <div className="mt-2 flex gap-1.5">
          {notice.action && (
            <Button onClick={onAction} size="xs" variant="outline">
              {notice.action.label}
            </Button>
          )}
          <Button
            disabled={dismiss.isPending}
            onClick={() => {
              dismiss.mutate();
            }}
            size="xs"
            variant="ghost"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
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
  const title = crashed
    ? `${APP_NAME} quit unexpectedly`
    : `${APP_NAME} didn't close properly`;
  const line = crashed
    ? "Sending a report helps us fix what went wrong."
    : "It may have stopped responding before it was quit. A report helps us find out why.";

  return (
    <div className="flex gap-3 px-4 py-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-destructive">
        <WarningCircleIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 text-[13px] font-medium">
            {title}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatWhen(problem.lastAt)}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{line}</p>
        <div className="mt-2 flex gap-1.5">
          <Button onClick={onReport} size="xs" variant="outline">
            Send a report
          </Button>
          <Button
            disabled={dismiss.isPending}
            onClick={() => {
              dismiss.mutate();
            }}
            size="xs"
            variant="ghost"
          >
            Dismiss
          </Button>
        </div>
      </div>
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
