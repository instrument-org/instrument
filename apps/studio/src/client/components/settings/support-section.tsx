import { openReportDialog } from "@/client/atoms/report-dialog";
import { settingAnchor } from "@/client/components/settings/settings-index";
import {
  BlockToolbarButton,
  blockToolbarButtonClassName,
  wrapLinesClassName,
} from "@/client/components/code-block";
import { CopyButton } from "@/client/components/copy-button";
import { Button } from "@/client/components/ui/button";
import { Switch } from "@/client/components/ui/switch";
import { Card } from "@/client/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { feedbackReport } from "@/client/lib/problem-reports";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { ArrowElbowDownLeftIcon } from "@phosphor-icons/react/ArrowElbowDownLeft";
import { ArrowsHorizontalIcon } from "@phosphor-icons/react/ArrowsHorizontal";
import { DownloadSimpleIcon } from "@phosphor-icons/react/DownloadSimple";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSettingsAsk } from "@/client/components/settings/settings-ask";
import { useState } from "react";
import { toast } from "@/client/lib/toast";
import { SettingsSection } from "@/client/components/settings/general-section";
import { ChatTeardropTextIcon } from "@phosphor-icons/react/ChatTeardropText";

/** Telling the team what went wrong: sending feedback, what is sent without asking, and the log a report includes. */
export function SupportSection() {
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">Support</h3>
      <SendFeedback />
      <SettingsSection title="Problem reports">
        <DiagnosticLog />
      </SettingsSection>
    </div>
  );
}

function SendFeedback() {
  return (
    <Card className="p-4">
      <div
        className="flex items-center gap-3.5"
        {...settingAnchor("send-feedback")}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-brand-600 text-white">
          <ChatTeardropTextIcon className="size-5" weight="fill" />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-medium">Something isn&apos;t working?</p>
          <p className="text-xs text-muted-foreground">
            Tell us what happened and we&apos;ll look into it.
          </p>
        </div>
        <Button
          className="shrink-0 rounded-full px-5"
          onClick={() => {
            openReportDialog(feedbackReport({ surface: "settings" }));
          }}
          size="sm"
          variant="brand"
        >
          Send feedback
        </Button>
      </div>
    </Card>
  );
}

/**
 * Where someone is sent when they are asked for their log.
 *
 * In Advanced because most people never need it, and out of the developer-only
 * tab because the people who need it are not developers: the whole point is a
 * support conversation that can say "open settings and send me this" to anyone.
 *
 * Reading it and saving a copy, rather than a path into the app's own data
 * directory. That directory holds the databases and settings the app runs on,
 * and pointing someone at it to hunt for one file puts everything else in the
 * same window. Reading first is the other half: what is in here is worth
 * looking at before sending it to anyone.
 */
type LogLevel = "error" | "plain" | "warn";

const LOG_LEVEL_CLASS: Record<LogLevel, string> = {
  error: "text-destructive",
  plain: "",
  warn: "text-warning-700 dark:text-warning-300",
};

/**
 * The most lines the viewer will draw.
 *
 * One element per line is what makes a level readable at a glance, and it is
 * also what puts a ceiling on how many lines can be drawn before scrolling
 * costs more than it is worth. The cap sits above what the byte cap on the
 * read can usually produce, so it only bites on a log of unusually short lines.
 */
const MAX_VIEWED_LINES = 4000;

function DiagnosticLog() {
  // Settings opened by a link to the log arrives with the viewer already up.
  // Compared by identity, so a second such link while Settings is open opens
  // the viewer again after it was closed.
  const ask = useSettingsAsk();
  const [viewerOpen, setViewerOpen] = useState(ask?.log === true);
  const [trackedAsk, setTrackedAsk] = useState(ask);
  if (ask !== trackedAsk) {
    setTrackedAsk(ask);
    if (ask?.log === true) {
      setViewerOpen(true);
    }
  }
  // Wrapped by default: the first thing anyone does here is read, and a stack
  // trace that runs off the right edge has to be scrolled to before it can be.
  const [wrapLines, setWrapLines] = useState(true);

  const logQuery = useQuery({
    ...rpcClient.utils.readDiagnosticLog.queryOptions(),
    enabled: viewerOpen,
  });

  const saveLogMutation = useMutation(
    rpcClient.utils.saveDiagnosticLog.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't save the log", { cause: error });
      },
      onSuccess: ({ status }) => {
        switch (status) {
          case "failed": {
            toast.error("Couldn't save the log");

            break;
          }
          case "no-log": {
            toast.error("There's no log to save yet");

            break;
          }
          case "saved": {
            toast.success("Saved the log");

            break;
          }
          // No default
        }
      },
    }),
  );

  return (
    <Card className="p-4">
      <div className="space-y-3" {...settingAnchor("diagnostic-log")}>
        <div className="space-y-1">
          <div className="text-sm font-medium">Diagnostic log</div>
          <p className="text-xs text-muted-foreground">
            {APP_NAME} keeps a private log on this computer. Problem reports
            include its last lines, which can name your files, so you can read
            them before you send one.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setViewerOpen(true);
            }}
            size="sm"
            variant="outline"
          >
            View log
          </Button>
          <DownloadLogButton
            disabled={saveLogMutation.isPending}
            onDownload={() => {
              saveLogMutation.mutate();
            }}
          />
        </div>
        <AutomaticErrorReports />
        <FeedbackOffers />
      </div>

      <Dialog onOpenChange={setViewerOpen} open={viewerOpen}>
        {/*
          The log scrolls, not the dialog. `DialogContent` scrolls itself by
          default, which for a pane of thousands of lines moves the title out of
          view and leaves nothing to orient against. Naming the rows lets the
          second one shrink below its content so the pane inside it can take the
          overflow instead.
        */}
        <DialogContent
          aria-describedby={undefined}
          className="grid-rows-[auto_minmax(0,1fr)] overflow-y-hidden"
          maxHeight="44rem"
          maxWidth="60rem"
        >
          <DialogHeader>
            <DialogTitle>Diagnostic log</DialogTitle>
          </DialogHeader>
          {/*
            `min-w-0` is what keeps a log inside the dialog. A grid item refuses
            to shrink under its own content by default, and a stack trace is one
            unbreakable path per line, so without it the pane grows to the widest
            line and carries the dialog out past the window with it. Zero lets
            the pane be narrower than its text, which is what gives `overflow`
            something to scroll.

            The controls sit over the pane rather than inside the scroller so
            they stay put while it moves, in the same idiom code blocks and
            diagrams use for the same job.
          */}
          <div className="relative min-h-0 min-w-0">
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
              <BlockToolbarButton
                icon={wrapLines ? ArrowElbowDownLeftIcon : ArrowsHorizontalIcon}
                label="Wrap lines"
                onClick={() => {
                  setWrapLines(!wrapLines);
                }}
                pressed={wrapLines}
              />
              <CopyButton
                className={blockToolbarButtonClassName}
                disabled={!logQuery.data}
                iconSize={12}
                label="Copy log"
                onCopy={async () => {
                  await navigator.clipboard.writeText(
                    logQuery.data?.text ?? "",
                  );
                }}
                tooltip="Copy log"
              />
              <BlockToolbarButton
                icon={DownloadSimpleIcon}
                label="Download log"
                onClick={() => {
                  saveLogMutation.mutate();
                }}
              />
            </div>
            <div className="h-full rounded-md border border-border bg-muted/40">
              <div
                className={cn(
                  "h-full overflow-auto scroll-fade-y p-3 select-text",
                  wrapLines && wrapLinesClassName,
                )}
              >
                {logQuery.isPending ? (
                  <p className="text-xs text-muted-foreground">
                    Reading the log...
                  </p>
                ) : logQuery.data ? (
                  // No whitespace class of its own: `pre` already does not wrap,
                  // so the toggle above adds wrapping rather than fighting it.
                  <pre className="pr-24 font-mono text-xs leading-5">
                    {toLogLines(logQuery.data.text).map((line, index) => (
                      <div
                        className={LOG_LEVEL_CLASS[line.level]}
                        // Lines repeat and carry no id, so position is the only
                        // thing telling them apart. The list is rebuilt whole
                        // whenever the text changes, so nothing reorders under it.
                        key={index}
                      >
                        {line.text}
                      </div>
                    ))}
                  </pre>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    There&rsquo;s no log yet. It fills up as you use the app.
                  </p>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * Whether crashes and app errors are sent without asking. It's turned on from
 * a report's own checkbox, so this is where it's turned off.
 */
function AutomaticErrorReports() {
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const setSendAutomatically = useMutation(
    rpcClient.problems.setSendAutomatically.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't change that setting", { cause: error });
      },
    }),
  );
  return (
    <label className="flex items-start justify-between gap-4 border-t border-border pt-3">
      <span className="space-y-1">
        <span className="block text-sm font-medium">
          Send error reports automatically
        </span>
        <span className="block text-xs text-muted-foreground">
          When {APP_NAME} crashes or runs into an error, it sends a report
          without asking. Chats are never sent automatically.
        </span>
      </span>
      <Switch
        checked={preferences?.sendErrorReportsAutomatically === true}
        disabled={setSendAutomatically.isPending}
        onCheckedChange={(enabled) => {
          setSendAutomatically.mutate({ enabled });
        }}
      />
    </label>
  );
}

/**
 * Whether the agent may offer, on a card in a chat, to send the team a problem
 * it found. Turned off from the card itself, so this is where it comes back.
 */
function FeedbackOffers() {
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const setOfferFeedback = useMutation(
    rpcClient.problems.setOfferFeedback.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't change that setting", { cause: error });
      },
    }),
  );
  return (
    <label className="flex items-start justify-between gap-4 border-t border-border pt-3">
      <span className="space-y-1">
        <span className="block text-sm font-medium">Ask for feedback</span>
        <span className="block text-xs text-muted-foreground">
          Now and then, {APP_NAME} asks how a chat went, and it can offer to
          send us what happened when something breaks. Nothing is sent unless
          you say so.
        </span>
      </span>
      <Switch
        checked={preferences?.offerFeedback !== false}
        disabled={setOfferFeedback.isPending}
        onCheckedChange={(enabled) => {
          setOfferFeedback.mutate({ enabled });
        }}
      />
    </label>
  );
}

/**
 * Icon only, in both the card and the viewer.
 *
 * The action needs no label: a download glyph says it, and the words for it
 * ("save a copy", "export") each read as something slightly different from what
 * happens. The tooltip carries the name for anyone who wants one.
 */
function DownloadLogButton({
  disabled,
  onDownload,
}: {
  disabled: boolean;
  onDownload: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label="Download log"
          disabled={disabled}
          onClick={onDownload}
          size="icon-sm"
          variant="ghost"
        >
          <DownloadSimpleIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Download log</TooltipContent>
    </Tooltip>
  );
}

/**
 * Split the log into lines tagged by severity.
 *
 * Severity is the only thing worth coloring here. The two formats this reads
 * are the packaged build's `[level]` line and development's JSON per line, so
 * both spellings are matched rather than one parser being chosen for a shape
 * that varies by build.
 */
function toLogLines(text: string): { level: LogLevel; text: string }[] {
  return text
    .split("\n")
    .slice(-MAX_VIEWED_LINES)
    .map((line) => {
      if (/\[error\]|"level"\s*:\s*"error"/i.test(line)) {
        return { level: "error" as const, text: line };
      }
      if (/\[warn\]|"level"\s*:\s*"warn"/i.test(line)) {
        return { level: "warn" as const, text: line };
      }
      return { level: "plain" as const, text: line };
    });
}
