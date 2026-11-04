import { openSettings } from "@/client/atoms/settings-modal";
import { CopyButton } from "@/client/components/copy-button";
import { useIsSetupUp } from "@/client/components/setup/use-setup-state";
import { Popover, PopoverTrigger } from "@/client/components/ui/popover";
import { useNow } from "@/client/components/window/use-now";
import { formatRelativeTime } from "@/client/lib/relative-time";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  type ExceptionEvent,
  formatExceptionEvent,
} from "@instrument-org/shared/exceptions";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import {
  capturedOf,
  frameLocation,
  recentBreadcrumbs,
  splitFrames,
  timesLabel,
  whereOf,
} from "./developer-errors-model";
import { InkHeading, InkPopover } from "./ink-popover";

const LINK_CLASS = "text-white/70 hover:text-white";

/**
 * What the app has captured since it started or was last cleared, from any
 * process, as a count on the band. Absent while there is nothing to report.
 * Opens onto the list beside the whole of one error.
 */
export function DeveloperErrors() {
  const { data } = useQuery(
    rpcClient.utils.live.exceptions.experimental_liveOptions({}),
  );
  const [open, setOpen] = useState(false);
  const isSetupUp = useIsSetupUp();
  const events = (data ?? []).toReversed();
  const total = events.reduce((sum, event) => sum + event.count, 0);

  if (total === 0) {
    // Stays closed when the next error arrives, once the last one is cleared.
    if (open) {
      setOpen(false);
    }
    return null;
  }
  const label = `${total} ${total === 1 ? "error" : "errors"}`;

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          className="flex shrink-0 items-center gap-1 border-l border-white/10 px-2.5 whitespace-nowrap text-ink-alert hover:bg-white/8 aria-expanded:bg-white/10"
          type="button"
        >
          <WarningCircleIcon className="size-3.25" />
          {label}
        </button>
      </PopoverTrigger>
      <InkPopover
        align="end"
        className="flex h-105 w-190"
        style={{ maxWidth: "calc(90vw / var(--content-zoom))" }}
      >
        <ErrorsPanel
          events={events}
          label={label}
          onViewLog={
            isSetupUp
              ? undefined
              : () => {
                  setOpen(false);
                  openSettings({ diagnosticLog: true, tab: "General" });
                }
          }
        />
      </InkPopover>
    </Popover>
  );
}

function ErrorsPanel({
  events,
  label,
  onViewLog,
}: {
  events: ExceptionEvent[];
  label: string;
  /** Opens the log, where the window can show Settings. */
  onViewLog?: () => void;
}) {
  const now = useNow().getTime();
  const [picked, setPicked] = useState<string>();
  const { mutate: clearAll } = useMutation(
    rpcClient.utils.clearExceptions.mutationOptions({}),
  );
  const selected =
    events.find((event) => event.fingerprint === picked) ?? events[0];

  return (
    <>
      <div className="flex w-75 shrink-0 flex-col border-r border-white/8">
        <InkHeading
          end={
            <>
              {onViewLog && (
                <button
                  className={LINK_CLASS}
                  onClick={onViewLog}
                  type="button"
                >
                  View log
                </button>
              )}
              <button
                className={LINK_CLASS}
                onClick={() => {
                  void navigator.clipboard.writeText(
                    events
                      .map((event) => formatExceptionEvent(event))
                      .join("\n\n"),
                  );
                }}
                type="button"
              >
                Copy all
              </button>
              <button
                className={LINK_CLASS}
                onClick={() => {
                  clearAll();
                }}
                type="button"
              >
                Clear all
              </button>
            </>
          }
        >
          {label}
        </InkHeading>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {events.map((event) => (
            <button
              className={cn(
                "flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-white/6",
                event === selected && "bg-white/10 hover:bg-white/10",
              )}
              key={event.fingerprint}
              onClick={() => {
                setPicked(event.fingerprint);
              }}
              type="button"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-white">
                  {capturedOf(event)?.value}
                </span>
                <span className="mt-1 block truncate text-white/50">
                  {event.process} · {whereOf(event)}
                </span>
              </span>
              <span className="shrink-0 text-right text-white/50">
                <span
                  className={cn("block", event.count > 1 && "text-ink-alert")}
                >
                  {timesLabel(event.count)}
                </span>
                <span className="mt-1 block">
                  {formatRelativeTime(new Date(event.lastAt), now)}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
      {selected && (
        <ErrorDetail event={selected} key={selected.fingerprint} now={now} />
      )}
    </>
  );
}

function ErrorDetail({ event, now }: { event: ExceptionEvent; now: number }) {
  const [showLibrary, setShowLibrary] = useState(false);
  const { mutate: clearOne } = useMutation(
    rpcClient.utils.clearException.mutationOptions({}),
  );
  const captured = capturedOf(event);
  const frames = captured && splitFrames(captured);
  const causes = event.exceptions.slice(0, -1).toReversed();
  const context = Object.entries(event.context).filter(
    ([key, value]) => value !== undefined && key !== "componentStack",
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <InkHeading
        end={
          <>
            <CopyButton
              className="size-5 rounded-sm p-0.5 text-white/70 hover:bg-white/10 hover:text-white"
              iconSize={12}
              onCopy={() =>
                navigator.clipboard.writeText(formatExceptionEvent(event))
              }
            />
            <button
              className={LINK_CLASS}
              onClick={() => {
                clearOne({ fingerprint: event.fingerprint });
              }}
              type="button"
            >
              Clear
            </button>
          </>
        }
      >
        {captured?.type}
      </InkHeading>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div>
          <div className="text-[13px] leading-5 wrap-break-word text-white">
            {captured?.value}
          </div>
          <div className="mt-1 text-white/50">
            {event.handled ? "Caught" : "Uncaught"} in {event.process},{" "}
            {timesLabel(event.count)}, last{" "}
            {formatRelativeTime(new Date(event.lastAt), now)}.
          </div>
        </div>
        {frames && (frames.app.length > 0 || frames.library.length > 0) && (
          <Section label="Stack">
            {frames.app.map((frame, index) => (
              <FrameRow
                file={frameLocation(frame)}
                key={`${frame.filename}:${index}`}
                name={frame.function}
              />
            ))}
            {frames.library.length > 0 && !showLibrary && (
              <button
                className="py-0.5 text-white/50 hover:text-white"
                onClick={() => {
                  setShowLibrary(true);
                }}
                type="button"
              >
                Show {frames.library.length} library{" "}
                {frames.library.length === 1 ? "frame" : "frames"}
              </button>
            )}
            {showLibrary &&
              frames.library.map((frame, index) => (
                <FrameRow
                  dim
                  file={frameLocation(frame)}
                  key={`${frame.filename}:${index}`}
                  name={frame.function}
                />
              ))}
          </Section>
        )}
        {causes.length > 0 && (
          <Section label="Caused by">
            {causes.map((cause, index) => (
              <div className="py-0.5 wrap-break-word" key={index}>
                {cause.type}: {cause.value}
              </div>
            ))}
          </Section>
        )}
        {recentBreadcrumbs(event).length > 0 && (
          <Section label="Before it happened">
            {recentBreadcrumbs(event).map((crumb, index) => (
              <div className="flex gap-3 py-0.5" key={index}>
                <span className="shrink-0 text-white/50">
                  {new Date(crumb.timestamp).toLocaleTimeString()}
                </span>
                <span
                  className="min-w-0 truncate text-white/80"
                  title={crumb.message}
                >
                  {crumb.category} {crumb.message}
                </span>
              </div>
            ))}
          </Section>
        )}
        {context.length > 0 && (
          <Section label="Context">
            {context.map(([key, value]) => (
              <div className="flex gap-3 py-0.5" key={key}>
                <span className="shrink-0 text-white/50">{key}</span>
                <span className="min-w-0 break-all">{value}</span>
              </div>
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div>
      <div className="mb-1.5 text-white/50">{label}</div>
      {children}
    </div>
  );
}

function FrameRow({
  dim = false,
  file,
  name,
}: {
  dim?: boolean;
  file: string;
  name: string;
}) {
  return (
    <div
      className={cn(
        "flex justify-between gap-4 py-0.5",
        dim ? "text-white/50" : "text-white/90",
      )}
    >
      <span className="truncate">{name}</span>
      <span className="shrink-0 text-white/60">{file}</span>
    </div>
  );
}
