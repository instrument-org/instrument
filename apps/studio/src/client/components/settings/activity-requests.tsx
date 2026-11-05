import { settingsModalAtom } from "@/client/atoms/settings-modal";
import { APPS_HREF, CHATS_HREF } from "@/client/atoms/window";
import { AIProviderIcon } from "@/client/components/ai-provider-icon";
import { CopyButton } from "@/client/components/copy-button";
import {
  type ActivityRequest,
  leadOf,
  modelOf,
  type Turn,
  turnText,
} from "@/client/components/settings/activity-timeline";
import { pathOf, SCREEN_ROUTES } from "@/client/components/window/window-href";
import { useGesturesFor } from "@/client/hooks/use-open-target";
import { displayLocale } from "@/client/lib/display-locale";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { modelDisplayName } from "@instrument-org/ai-gateway/client";
import { AIProviderTypeSchema } from "@instrument-org/shared";
import {
  ChatIdSchema,
  StoreId,
  turnMessageOf,
} from "@instrument-org/workspace/client";
import { ArrowDownIcon } from "@phosphor-icons/react/ArrowDown";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { ArrowUpRightIcon } from "@phosphor-icons/react/ArrowUpRight";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { type ReactNode } from "react";

/**
 * The AI requests behind Settings › Activity: one chat turn's requests in
 * the columns the request log has always used, and everything recorded
 * about one request. None of it holds what was said.
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

const dateFormat = new Intl.DateTimeFormat(displayLocale, {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
});
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

/**
 * A turn's columns, in the request log's words, each at least its width (in
 * layout px) and sharing the room left over.
 */
const COLUMNS: {
  cell: (row: ActivityRequest) => ReactNode;
  label: string;
  right?: boolean;
  width: number;
}[] = [
  {
    cell: (row) => (
      <span className="truncate text-muted-foreground tabular-nums">
        {dateFormat.format(row.startedAt)}
      </span>
    ),
    label: "Date",
    // Fits the widest date and time a row shows ("Dec 28, 12:59 PM").
    width: 148,
  },
  {
    cell: (row) => (
      <span className="truncate">{PURPOSE_LABELS[row.purpose]}</span>
    ),
    label: "For",
    width: 116,
  },
  { cell: (row) => <ModelLabel row={row} />, label: "Model", width: 150 },
  {
    cell: (row) => (
      <span className="truncate text-muted-foreground">
        <ResultText row={row} />
      </span>
    ),
    label: "Result",
    width: 76,
  },
  {
    cell: (row) => (
      <span className="truncate text-muted-foreground tabular-nums">
        <Tokens count={row.totalTokens} />
      </span>
    ),
    label: "Tokens",
    right: true,
    width: 76,
  },
];

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

/** The requests one chat turn made, newest first, each opening its own detail. */
export function TurnDetail({
  onBack,
  onOpen,
  turn,
}: {
  onBack: () => void;
  onOpen: (id: string) => void;
  turn: Turn;
}) {
  const modelName = useModelName();
  const text = turnText(turn, modelName);
  const lead = leadOf(turn);
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <BackToActivity label="Activity" onBack={onBack} />
      </div>
      <div className="flex items-center gap-3">
        <ConnectionMark
          className="size-4"
          type={lead?.connectionType ?? null}
        />
        <div className="min-w-0">
          <div className="truncate font-medium">{text.primary}</div>
          <div className="truncate text-sm text-muted-foreground">
            {text.secondary}
          </div>
        </div>
      </div>
      <TurnMessage turn={turn} />
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <div
          className="flex h-9 items-center border-b border-border text-xs font-medium text-muted-foreground"
          role="row"
        >
          {COLUMNS.map((column, index) => (
            <div
              className={cn(
                "flex min-w-0 shrink-0 items-center gap-1 px-3",
                column.right && "justify-end",
                index === 0 && "text-foreground",
              )}
              key={column.label}
              role="columnheader"
              style={{ flex: `1 0 ${column.width}px` }}
            >
              {column.label}
              {index === 0 ? <ArrowDownIcon className="size-3" /> : null}
            </div>
          ))}
        </div>
        {turn.requests.map((request) => (
          <button
            className="flex h-9 w-full items-center border-b border-border text-left text-sm last:border-b-0 hover:bg-foreground/5"
            key={request.id}
            onClick={() => {
              onOpen(request.id);
            }}
            type="button"
          >
            {COLUMNS.map((column) => (
              <div
                className={cn(
                  "flex min-w-0 shrink-0 items-center px-3",
                  column.right && "justify-end",
                )}
                key={column.label}
                style={{ flex: `1 0 ${column.width}px` }}
              >
                {column.cell(request)}
              </div>
            ))}
          </button>
        ))}
      </div>
    </div>
  );
}

const timeFormat = new Intl.DateTimeFormat(displayLocale, {
  hour: "numeric",
  minute: "2-digit",
});

/**
 * What went with the message a chat turn answered: the person's words, the
 * activity note it carried as the model read it, and whether the chat looked
 * up names with `instrument activity`. Nothing for a turn no message of
 * theirs started, or whose chat is gone.
 */
function TurnMessage({ turn }: { turn: Turn }) {
  const first = turn.requests.at(-1);
  const chat = ChatIdSchema.safeParse(first?.chatId);
  const session = StoreId.SessionSchema.safeParse(first?.sessionId);
  const { data: messages } = useQuery({
    ...rpcClient.workspace.message.list.queryOptions({
      input:
        chat.success && session.success
          ? { id: chat.data, sessionId: session.data }
          : skipToken,
    }),
    retry: false,
  });
  const message =
    messages && first ? turnMessageOf(messages, first.startedAt) : undefined;
  if (!message) {
    return null;
  }
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card px-4 py-3 text-sm">
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">
          {`${timeFormat.format(message.at)} · You wrote`}
        </div>
        <p className="line-clamp-3 whitespace-pre-wrap">{message.text}</p>
      </div>
      {message.noteLines ? (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">
            Your activity sent with it
          </div>
          <div className="font-mono text-xs leading-5">
            {message.noteLines.map((line, index) => (
              <div key={index}>{line}</div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          No activity sent with it.
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        {message.lookedUp
          ? "The chat looked up names."
          : "The chat didn't look up any names."}
      </div>
    </div>
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
    <div className="space-y-6">
      <div className="flex items-center gap-2">
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
          <div className="divide-y rounded-xl bg-card px-4 shadow-sm">
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
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-4 py-1.5 text-sm">
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
