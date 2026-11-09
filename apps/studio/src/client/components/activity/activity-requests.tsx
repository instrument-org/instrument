import { settingsModalAtom } from "@/client/atoms/settings-modal";
import { APPS_HREF, CHATS_HREF } from "@/client/atoms/window";
import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { CopyButton } from "@/client/components/copy-button";
import {
  type ActivityRequest,
  modelOf,
  type Turn,
} from "@/client/components/activity/activity-timeline";
import { pathOf, SCREEN_ROUTES } from "@/client/components/window/window-href";
import { useGesturesFor } from "@/client/hooks/use-open-target";
import { displayLocale } from "@/client/lib/display-locale";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { modelDisplayName } from "@instrument-org/ai-gateway/client";
import { AIProviderTypeSchema } from "@instrument-org/shared";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { ArrowUpRightIcon } from "@phosphor-icons/react/ArrowUpRight";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { useQuery } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { type ReactNode } from "react";

/**
 * The AI requests behind Activity: one chat turn's requests a line each,
 * and everything recorded about one request. None of it holds what was
 * said.
 */

const KIND_LABELS: Record<ActivityRequest["kind"], string> = {
  decision: "Decision",
  image: "Image",
  language: "LLM",
  search: "Search",
};

const PURPOSE_LABELS: Record<ActivityRequest["purpose"], string> = {
  "account-check": "Account check",
  "app-search": "App search",
  chat: "Chat",
  "chat-search": "Chat search",
  "chat-title": "Chat title",
  "emoji-suggestion": "Emoji suggestion",
  "next-message": "Suggested reply",
  image: "Image",
  other: "Other",
  "settings-search": "Settings search",
  task: "Task",
  "title-check": "Title check",
  "project-backfill": "Project sorting",
  "project-suggestion": "Project suggestion",
  "web-search": "Web search",
  "work-summary": "Work summary",
  "x-search": "X search",
};

const SURFACE_LABELS: Record<
  NonNullable<ActivityRequest["surface"]>,
  string
> = {
  agent: "Agent",
  apps: "Apps",
  chats: "Chats",
  draft: "Draft",
  settings: "Settings",
  projects: "Projects",
};

const STATUS_LABELS: Record<ActivityRequest["status"], string> = {
  failed: "Failed",
  finished: "Finished",
  limited: "Stopped at a limit",
  stopped: "Stopped",
};

const fullDateFormat = new Intl.DateTimeFormat(displayLocale, {
  dateStyle: "medium",
  timeStyle: "medium",
});
const compactNumber = new Intl.NumberFormat(displayLocale, {
  maximumFractionDigits: 1,
  notation: "compact",
});
const wholeNumber = new Intl.NumberFormat(displayLocale);

function formatDuration(ms: null | number) {
  if (ms === null) {
    return "";
  }
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** A model id without its maker's prefix, which the connection's mark already says. */
function shortModel(id: null | string) {
  return id?.split("/").at(-1) ?? "";
}

/**
 * A model's name as the model picker shows it, or one derived from its id for
 * one the catalog does not list (a decision model, the model an alias or a
 * router resolved to, or one no longer offered).
 */
export function useModelName() {
  const { data } = useQuery(
    rpcClient.gateway.models.live.list.experimental_liveOptions(),
  );
  const names = new Map<string, string>();
  for (const model of data?.models ?? []) {
    names.set(model.canonicalId, model.name);
    names.set(shortModel(model.canonicalId), model.name);
  }
  return (id: null | string) =>
    id === null
      ? ""
      : (names.get(id) ?? names.get(shortModel(id)) ?? modelDisplayName(id));
}

/** The screen a request's origin opens, when it is somewhere that still exists. */
function originHref(row: ActivityRequest) {
  if (row.chatId) {
    return row.chatTitle
      ? pathOf(SCREEN_ROUTES.chat, { id: row.chatId })
      : undefined;
  }
  switch (row.surface) {
    case "apps": {
      return APPS_HREF;
    }
    case "chats":
    case "projects": {
      return CHATS_HREF;
    }
    default: {
      return undefined;
    }
  }
}

function originOf(row: ActivityRequest) {
  if (row.chatId) {
    return row.chatTitle ?? "Deleted chat";
  }
  return row.surface ? SURFACE_LABELS[row.surface] : "";
}

/** The mark of the provider a request went to, or the room for one. */
export function ConnectionMark({
  className = "size-3.5",
  type,
}: {
  className?: string;
  type: null | string;
}) {
  const parsed = AIProviderTypeSchema.safeParse(type);
  return parsed.success ? (
    <AIProviderIcon
      className={cn("shrink-0", className)}
      colored
      type={parsed.data}
    />
  ) : (
    <span className={cn("shrink-0", className)} />
  );
}

/** Where a request came from, as a link to it when it is somewhere that still exists. */
function OriginLink({ row }: { row: ActivityRequest }) {
  const gesturesFor = useGesturesFor();
  const closeSettings = useSetAtom(settingsModalAtom);
  const href = originHref(row);
  const gestures = href ? gesturesFor({ href, kind: "screen" }) : undefined;
  const label = originOf(row);
  if (!gestures) {
    return (
      <span
        className={cn("truncate", row.chatId && !row.chatTitle && "italic")}
      >
        {label}
      </span>
    );
  }
  return (
    <button
      className="flex min-w-0 items-center gap-1 hover:text-foreground hover:underline"
      onAuxClick={(event) => {
        event.stopPropagation();
        gestures.onAuxClick(event);
      }}
      onClick={(event) => {
        event.stopPropagation();
        gestures.onClick(event);
        closeSettings(null);
      }}
      title={`Open ${label}`}
      type="button"
    >
      <span className="truncate">{label}</span>
      <ArrowUpRightIcon className="size-3 shrink-0" />
    </button>
  );
}

function ModelLabel({
  mark = true,
  row,
}: {
  mark?: boolean;
  row: ActivityRequest;
}) {
  const modelName = useModelName();
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {mark ? <ConnectionMark type={row.connectionType} /> : null}
      {modelOf(row) === null ? (
        <span className="truncate text-muted-foreground italic">Unknown</span>
      ) : (
        <span className="truncate">
          {modelName(modelOf(row))}
          {row.imageQuality && (
            <span className="text-muted-foreground">{` · ${qualityWord(row.imageQuality)}`}</span>
          )}
        </span>
      )}
    </span>
  );
}

/** An image's quality as the log says it: "Low", "Medium". */
function qualityWord(quality: string) {
  return quality.charAt(0).toUpperCase() + quality.slice(1);
}

function ProviderLabel({ row }: { row: ActivityRequest }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <ConnectionMark type={row.connectionType} />
      <span className="truncate">
        {row.connectionName ?? row.connectionType ?? "Unknown"}
      </span>
    </span>
  );
}

function ResultText({ row }: { row: ActivityRequest }) {
  return (
    <span className={cn(row.status === "failed" && "text-destructive")}>
      {STATUS_LABELS[row.status]}
    </span>
  );
}

/** A token count in compact form, with the exact count on hover. */
function Tokens({
  count,
  empty = "",
}: {
  count: null | number;
  empty?: string;
}) {
  return count === null ? (
    empty
  ) : (
    <span title={wholeNumber.format(count)}>{compactNumber.format(count)}</span>
  );
}

const clockFormat = new Intl.DateTimeFormat(displayLocale, {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

/**
 * One chat turn's requests, oldest first, a line each: when it started,
 * what it was for, how it ended and its tokens. Each opens what was
 * recorded about it.
 */
export function RequestRows({
  onOpen,
  turn,
}: {
  onOpen: (id: string) => void;
  turn: Turn;
}) {
  return (
    <div className="flex flex-col">
      {turn.requests.toReversed().map((request) => (
        <button
          className="flex h-8 items-center gap-3 rounded-md px-2 text-left text-[13px] hover:bg-foreground/5"
          key={request.id}
          onClick={() => {
            onOpen(request.id);
          }}
          type="button"
        >
          <span className="w-21 shrink-0 text-muted-foreground tabular-nums">
            {clockFormat.format(request.startedAt)}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {PURPOSE_LABELS[request.purpose]}
          </span>
          <span className="shrink-0 text-muted-foreground">
            <ResultText row={request} />
          </span>
          <span className="w-10 shrink-0 text-right text-muted-foreground tabular-nums">
            <Tokens count={request.totalTokens} empty="–" />
          </span>
          <CaretRightIcon className="size-3 shrink-0 text-muted-foreground" />
        </button>
      ))}
    </div>
  );
}

/** How long a turn's requests took, from the first starting to the last ending. */
export function turnDuration(turn: Turn) {
  const ends = turn.requests.map(
    (request) => request.startedAt + (request.durationMs ?? 0),
  );
  const starts = turn.requests.map((request) => request.startedAt);
  if (starts.length === 0) {
    return "";
  }
  return formatDuration(Math.max(...ends) - Math.min(...starts));
}

function BackToActivity({
  label,
  onBack,
}: {
  label: string;
  onBack: () => void;
}) {
  return (
    <button
      className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      onClick={onBack}
      type="button"
    >
      <ArrowLeftIcon className="size-4" />
      {label}
    </button>
  );
}

/** Everything recorded about one request, with a way back to its turn. */
export function RequestDetail({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
}) {
  const { data: row } = useQuery(
    rpcClient.workspace.activity.byId.queryOptions({ input: { id } }),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pr-8">
        <BackToActivity label="Back" onBack={onBack} />
        <span className="flex-1" />
        {row ? (
          <CopyButton
            className="rounded-sm p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            label="Copy details"
            onCopy={() =>
              navigator.clipboard.writeText(JSON.stringify(row, null, 2))
            }
            tooltip="Copy details"
          />
        ) : null}
      </div>
      {row ? (
        <>
          <div className="flex items-center gap-3">
            <ConnectionMark type={row.connectionType} />
            <div className="min-w-0">
              <div className="truncate font-medium">
                {`${PURPOSE_LABELS[row.purpose]} · ${KIND_LABELS[row.kind]}`}
              </div>
              <div className="truncate text-sm text-muted-foreground">
                {originOf(row) || "No chat"}
              </div>
            </div>
          </div>
          <div className="divide-y divide-border">
            <DetailGroup title="Request">
              <Detail label="Started">
                {fullDateFormat.format(row.startedAt)}
              </Detail>
              <Detail label="Duration">
                {formatDuration(row.durationMs) || "Not recorded"}
              </Detail>
              <Detail label="Result">
                <ResultText row={row} />
                {row.finishReason ? `, ${row.finishReason}` : ""}
              </Detail>
              {row.error ? <ErrorDetail error={row.error} /> : null}
              <Detail label="From">
                {originOf(row) ? (
                  <span className="flex">
                    <OriginLink row={row} />
                  </span>
                ) : (
                  "None"
                )}
              </Detail>
              <Detail code label="Request ID">
                {row.id}
              </Detail>
              {row.responseId ? (
                <Detail code label="Response ID">
                  {row.responseId}
                </Detail>
              ) : null}
            </DetailGroup>
            <DetailGroup title="Model">
              <Detail label="Provider">
                <ProviderLabel row={row} />
              </Detail>
              <Detail label="Model">
                <ModelLabel mark={false} row={row} />
              </Detail>
              <Detail code={row.modelRequested !== null} label="Asked for">
                {row.modelRequested ?? "Not recorded"}
              </Detail>
              <Detail code={row.modelServed !== null} label="Answered by">
                {row.modelServed ?? "Not reported separately"}
              </Detail>
              {row.imageQuality ? (
                <Detail label="Image quality">
                  {qualityWord(row.imageQuality)}
                </Detail>
              ) : null}
            </DetailGroup>
            <DetailGroup title="Tokens">
              <Detail label="Input">
                <Tokens count={row.inputTokens} empty="Not reported" />
              </Detail>
              {row.cacheReadTokens ? (
                <Detail label="From cache">
                  <Tokens count={row.cacheReadTokens} />
                </Detail>
              ) : null}
              {row.cacheWriteTokens ? (
                <Detail label="Cache write">
                  <Tokens count={row.cacheWriteTokens} />
                </Detail>
              ) : null}
              <Detail label="Output">
                <Tokens count={row.outputTokens} empty="Not reported" />
              </Detail>
              {row.reasoningTokens ? (
                <Detail label="Reasoning">
                  <Tokens count={row.reasoningTokens} />
                </Detail>
              ) : null}
            </DetailGroup>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * An error as a person reads it: the message a provider put in a JSON body
 * when there is one, with the whole text kept below it.
 */
function readableError(error: string) {
  const start = error.indexOf("{");
  if (start === -1) {
    return { message: error, raw: undefined };
  }
  try {
    const body: unknown = JSON.parse(error.slice(start));
    const nested =
      typeof body === "object" && body !== null && "error" in body
        ? body.error
        : body;
    const message =
      typeof nested === "object" && nested !== null && "message" in nested
        ? nested.message
        : undefined;
    return typeof message === "string"
      ? { message, raw: error }
      : { message: error, raw: undefined };
  } catch {
    return { message: error, raw: undefined };
  }
}

function ErrorDetail({ error }: { error: string }) {
  const { message, raw } = readableError(error);
  return (
    <Detail label="Error">
      <span className="block">{message}</span>
      {raw ? (
        <code className="mt-1 block font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">
          {raw}
        </code>
      ) : null}
    </Detail>
  );
}

function DetailGroup({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <div className="py-3">
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function Detail({
  children,
  code = false,
  label,
}: {
  children: ReactNode;
  code?: boolean;
  label: string;
}) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 py-1.5 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 break-words",
          code && "font-mono text-xs leading-5",
        )}
      >
        {children}
      </span>
    </div>
  );
}
