import { CopyButton } from "@/client/components/copy-button";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { useOpenInApp } from "@/client/hooks/use-open-in-app";
import {
  useGesturesFor,
  wantsNewTab,
  wantsNewWindow,
} from "@/client/hooks/use-open-target";
import { formatAbsoluteTime } from "@/client/lib/relative-time";
import { toast } from "@/client/lib/toast";
import { useTimedFlag } from "@/client/hooks/use-timed-flag";
import { isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  type ChatId,
  ChatIdSchema,
  isSendablePrompt,
  type MessageDraft,
  type MessageKind,
  parseMessage,
  promptFenceOf,
  promptSentAt,
} from "@instrument-org/workspace/client";
import { ArrowUpRightIcon } from "@phosphor-icons/react/ArrowUpRight";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/EnvelopeSimple";
import { ExportIcon } from "@phosphor-icons/react/Export";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns/format";
import { isSameDay } from "date-fns/isSameDay";
import { isSameYear } from "date-fns/isSameYear";
import { type ReactNode, useContext, useState } from "react";

import { MarkdownChatContext } from "./markdown-chat-context";
import { messageKindOf } from "./message-kind";
import { ReplyPartContext } from "./reply-part-context";
import { chatListed } from "./window/chat-list-query";
import { useListedChat } from "./window/chat-tab-menu";
import { projectColor } from "./window/project-colors";
import { projectTint } from "./window/project-tint";
import { useProjectsById } from "./window/projects-by-id";
import { chatHref } from "./window/window-href";

const ADDRESS = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/** Gmail's own address, which is all the browser row needs to name the browser. */
const GMAIL_HOME = "https://mail.google.com/";

/**
 * The ways out of a message: Copy takes the whole, and Send opens an email
 * filled in, in the mail app or in Gmail, or shares anything else. A message
 * the agent sends itself has Copy alone, since the user only reads it. The
 * message is read when a button is pressed, so a surface whose message is
 * being edited hands over what it says at that moment.
 */
export function MessageActions({
  disabled = false,
  getMessage,
  kind,
  sender,
}: {
  disabled?: boolean;
  getMessage: () => MessageDraft;
  kind: MessageKind;
  sender?: MessageDraft["sender"];
}) {
  const openExternal = useOpenExternalLink();
  const share = useMutation(rpcClient.utils.shareText.mutationOptions());
  const { data: targets } = useQuery(
    rpcClient.utils.sendTargets.queryOptions({
      enabled: kind === "email",
      staleTime: Infinity,
    }),
  );
  // Named and marked the way every "Open in" names the browser.
  const browser = useOpenInApp(
    kind === "email" ? { url: GMAIL_HOME } : undefined,
  );
  const canShare = isMacOS();
  const userSends = sender !== "agent";

  const shareIt = () => {
    share.mutate({ text: getMessage().body });
  };

  return (
    <>
      <CopyWholeButton disabled={disabled} getMessage={getMessage} />
      {!userSends ? null : kind === "email" ? (
        // Not modal: a modal menu takes focus and the page from under it, and
        // a card drawn inside the Markdown editor is redrawn when the editor
        // loses them, taking the menu's trigger, and so the menu, with it.
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button disabled={disabled} size="xs" variant="brand">
              Send
              <CaretDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom">
            <DropdownMenuItem
              onSelect={() => {
                openExternal(mailtoOf(getMessage()), { addReferral: false });
              }}
            >
              <AppIcon
                fallback={<EnvelopeSimpleIcon />}
                target={targets?.mail}
              />
              Open in {targets?.mail?.name ?? "Mail"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                openExternal(gmailOf(getMessage()), { addReferral: false });
              }}
            >
              <AppIcon fallback={<ArrowUpRightIcon />} target={browser} />
              {browser.appName
                ? `Open Gmail in ${browser.appName}`
                : "Open in Gmail"}
            </DropdownMenuItem>
            {canShare && (
              <DropdownMenuItem onSelect={shareIt}>
                <ExportIcon className="size-4" />
                Share…
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        canShare && (
          <Button
            disabled={disabled}
            onClick={shareIt}
            size="xs"
            variant="brand"
          >
            <ExportIcon />
            Share
          </Button>
        )
      )}
    </>
  );
}

/**
 * Words to send to someone, drawn as the thing they are rather than as prose: what it is and who it is for, the subject and body in the
 * reply's own type, and the ways out. The subject and body each copy from the
 * control that shows while they are hovered, an address copies when clicked,
 * and Copy takes the whole.
 *
 * Nothing sends from here. An email opens filled in, in the mail app or in
 * Gmail in the browser, each named with its icon, and on macOS anything shares
 * to Messages or wherever the user picks. One the agent sends itself only
 * shows the words and copies.
 */
export function MessageCard({
  file,
  isStreaming = false,
  message,
}: {
  /** The file the message lives in, when it has one, opened from the head. */
  file?: { name: string; open: () => void };
  isStreaming?: boolean;
  message: MessageDraft;
}) {
  const kind = messageKindOf(message.kind);
  const settled = !isStreaming && message.body !== "";

  return (
    <div className="not-prose my-2 w-full min-w-0 rounded-xl border border-border bg-card text-card-foreground shadow-xs first:mt-0 last:mb-0">
      <div className="flex min-w-0 items-center gap-2 border-b border-border px-3.5 py-2 text-xs text-muted-foreground [&_svg]:size-3.5">
        {kind.icon}
        <span className="min-w-0 truncate">
          {message.kind === "prompt" ? (
            <PromptFor to={message.to} />
          ) : (
            <>
              {message.via
                ? `${message.via} ${kind.label.toLowerCase()}`
                : kind.label}
              {message.to && (
                <>
                  {" to "}
                  <Recipient to={message.to} />
                </>
              )}
            </>
          )}
        </span>
        {file && (
          <button
            className="ml-auto flex min-w-0 items-center gap-1 rounded-sm px-1 hover:text-foreground"
            onClick={file.open}
            type="button"
          >
            <span className="truncate">{file.name}</span>
            <ArrowUpRightIcon className="shrink-0" />
          </button>
        )}
      </div>
      {message.subject && (
        <div className="border-b border-border px-1.5 py-1">
          <CopyablePart label="Copy subject" value={message.subject}>
            <p className="text-sm">
              <span className="mr-1 text-muted-foreground">Subject</span>{" "}
              <span className="font-semibold">{message.subject}</span>
            </p>
          </CopyablePart>
        </div>
      )}
      <div className="px-1.5 py-1.5">
        <CopyablePart label="Copy body" value={message.body}>
          <p className="text-sm/[1.55] whitespace-pre-wrap">
            {message.body || " "}
          </p>
        </CopyablePart>
      </div>
      <div className="flex items-center justify-end gap-1.5 px-3.5 pb-3">
        {message.kind === "prompt" ? (
          <PromptActions disabled={!settled} message={message} />
        ) : (
          <MessageActions
            disabled={!settled}
            getMessage={() => message}
            kind={message.kind}
            sender={message.sender}
          />
        )}
      </div>
    </div>
  );
}

/** A ```message fence in a reply, drawn as the card while it streams in. */
export function MessageFence({ code }: { code: string }) {
  const { isStreaming } = useContext(MarkdownChatContext);
  return <MessageCard isStreaming={isStreaming} message={parseMessage(code)} />;
}

/** Copy, taking the whole message as it pastes, and saying so for a moment. */
function CopyWholeButton({
  disabled,
  getMessage,
  variant = "outline",
}: {
  disabled: boolean;
  getMessage: () => MessageDraft;
  variant?: "brand" | "outline";
}) {
  const { active: copied, trigger: showCopied } = useTimedFlag();
  const copyWhole = async () => {
    await navigator.clipboard.writeText(wholeOf(getMessage()));
    showCopied();
  };
  return (
    <Button
      disabled={disabled}
      onClick={() => void copyWhole()}
      size="xs"
      variant={variant}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

/**
 * Where a prompt goes, as the head of its card says it: another app's agent
 * by name, or a new chat, in the project of the chat it is in when that chat
 * has one.
 */
function PromptFor({ to }: { to?: string }) {
  const { chatId } = useContext(MarkdownChatContext);
  const projectId = useListedChat(chatId ?? NO_CHAT)?.project;
  const project = useProjectsById().get(projectId ?? "");
  return (
    <>
      {"Prompt for "}
      <span className="text-foreground">{to ?? "a new chat"}</span>
      {to === undefined && project && (
        <>
          {" in "}
          <span
            className="font-medium text-(--project-tint-ink) project-tint"
            style={projectTint(projectColor(project))}
          >
            {project.emoji ? `${project.emoji} ` : ""}
            {project.name}
          </span>
        </>
      )}
    </>
  );
}

/** No chat, for a card outside one, which no listed chat matches. */
const NO_CHAT = ChatIdSchema.parse("no-chat");

/**
 * A prompt's ways out. One for a new chat, in a reply, has Send, which starts
 * that chat on these words in this chat's project and model and opens it the
 * way a link to a chat opens; once sent, the card says when and has Open chat
 * in its place, on every device, so it is never sent twice by accident. A
 * prompt for another app's agent, or one outside a reply, only copies, and
 * Copy is then the filled button.
 */
function PromptActions({
  disabled,
  message,
}: {
  disabled: boolean;
  message: MessageDraft;
}) {
  const part = useContext(ReplyPartContext);
  const { chatId } = useContext(MarkdownChatContext);
  const gesturesFor = useGesturesFor();
  const queryClient = useQueryClient();
  const send = useMutation(
    rpcClient.workspace.chats.sendPrompt.mutationOptions(),
  );
  const fence =
    part && isSendablePrompt(message)
      ? promptFenceOf(part.text, message.body)
      : undefined;
  const getMessage = () => message;
  if (!part || !chatId || fence === undefined) {
    return (
      <CopyWholeButton
        disabled={disabled}
        getMessage={getMessage}
        variant="brand"
      />
    );
  }
  const sent = promptSentAt(part.metadata, fence);

  // Opened as a link to the chat in a reply opens: beside on a plain click,
  // in a tab of its own on a modified one.
  const openChat = (chat: ChatId, event: ClickModifiers) => {
    const gestures = gesturesFor(
      { href: chatHref(chat), kind: "screen" },
      { isLink: true },
    );
    const open = gestures.destinations.find((entry) => entry.id === "open");
    const inFront = gestures.destinations.find(
      (entry) => entry.id === "openNewTab",
    );
    if (wantsNewWindow(event) && inFront) {
      inFront.run();
    } else if (wantsNewTab(event) && gestures.separate) {
      gestures.separate.run();
    } else {
      open?.run();
    }
  };

  const sendIt = async (event: ClickModifiers) => {
    let started;
    try {
      started = await send.mutateAsync({
        body: message.body,
        id: chatId,
        messageId: part.metadata.messageId,
        partId: part.metadata.id,
        sessionId: part.metadata.sessionId,
      });
    } catch (error) {
      toast.error("Couldn't start the chat", { cause: error });
      return;
    }
    if (started.sessionId) {
      // Known at once to the chat's screen, which asks for its session.
      queryClient.setQueryData(
        rpcClient.workspace.chats.session.queryKey({
          input: { id: started.chat },
        }),
        { sessionId: started.sessionId },
      );
    }
    // The window opens only a chat its list has.
    await chatListed(queryClient, started.listed);
    openChat(started.chat, event);
  };

  if (sent) {
    const at = new Date(sent.at);
    return (
      <>
        <span
          className="mr-auto text-xs text-muted-foreground"
          title={formatAbsoluteTime(at)}
        >
          Sent {sentTime(at)}
        </span>
        <CopyWholeButton disabled={disabled} getMessage={getMessage} />
        <Button
          onClick={(event) => {
            openChat(sent.chat, modifiersOf(event));
          }}
          size="xs"
          variant="default"
        >
          <ChatCircleIcon />
          Open chat
        </Button>
      </>
    );
  }
  return (
    <>
      <CopyWholeButton disabled={disabled} getMessage={getMessage} />
      <Button
        disabled={disabled || send.isPending}
        onClick={(event) => void sendIt(modifiersOf(event))}
        size="xs"
        variant="brand"
      >
        Send
      </Button>
    </>
  );
}

type ClickModifiers = {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

/** The keys held at a click, kept past the click for an open that comes later. */
function modifiersOf(event: ClickModifiers): ClickModifiers {
  const { altKey, ctrlKey, metaKey, shiftKey } = event;
  return { altKey, ctrlKey, metaKey, shiftKey };
}

/** When a prompt was sent: its time today, its date before that. */
function sentTime(at: Date): string {
  const now = new Date();
  if (isSameDay(at, now)) {
    return format(at, "p");
  }
  return format(at, isSameYear(at, now) ? "MMM d" : "MMM d, yyyy");
}

/** The icon of the app a Send row opens, or a glyph where there is none. */
function AppIcon({
  fallback,
  target,
}: {
  fallback: ReactNode;
  target?: null | { iconUrl: null | string };
}) {
  return target?.iconUrl ? (
    <img alt="" className="size-4" src={target.iconUrl} />
  ) : (
    <span className="flex size-4 items-center justify-center [&_svg]:size-4">
      {fallback}
    </span>
  );
}

/** An address that copies when clicked, saying so in its tooltip. */
function CopyableAddress({ address }: { address: string }) {
  const [open, setOpen] = useState(false);
  const { active: copied, trigger } = useTimedFlag();
  return (
    // A press closes a tooltip, so it is held open while it says the copy
    // happened.
    <Tooltip onOpenChange={setOpen} open={open || copied}>
      <TooltipTrigger asChild>
        <button
          className="text-foreground underline decoration-muted-foreground decoration-dotted underline-offset-2"
          onClick={() => {
            void navigator.clipboard.writeText(address).then(trigger);
          }}
          type="button"
        >
          {address}
        </button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : "Copy address"}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A part of the message with its own copy control, floated in the part's top
 * corner while hovered so the text keeps the card's full width.
 */
function CopyablePart({
  children,
  label,
  value,
}: {
  children: ReactNode;
  /** What the control copies, as its name: "Copy subject". */
  label: string;
  value: string;
}) {
  return (
    <div className="group/part relative min-w-0 px-2 py-1.5">
      {children}
      <CopyButton
        className="absolute top-1 right-1 rounded-sm bg-card p-1 text-muted-foreground opacity-0 shadow-xs ring-1 ring-border group-hover/part:opacity-100 hover:text-foreground focus-visible:opacity-100"
        iconSize={13}
        label={label}
        onCopy={() => navigator.clipboard.writeText(value)}
      />
    </div>
  );
}

function gmailOf(message: MessageDraft): string {
  const to = (message.to?.match(ADDRESS) ?? []).join(",");
  return `https://mail.google.com/mail/?${query({ body: message.body, fs: "1", su: message.subject, to, view: "cm" })}`;
}

function mailtoOf(message: MessageDraft): string {
  const to = (message.to?.match(ADDRESS) ?? []).join(",");
  return `mailto:${to}?${query({ body: message.body, subject: message.subject })}`;
}

/** The query a mail link carries, encoded the way mail apps read it. */
function query(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value ?? "")}`)
    .join("&");
}

/**
 * Who the message is for, as written. A name or a team is only read, so only
 * an email address copies: it is the one part the user would paste somewhere.
 */
function Recipient({ to }: { to: string }) {
  // A capturing split leaves every address at an odd index.
  const parts = to.split(new RegExp(`(${ADDRESS.source})`));
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <CopyableAddress address={part} key={index} />
    ) : (
      <span className="text-foreground" key={index}>
        {part}
      </span>
    ),
  );
}

/** Everything, the way it pastes: an email's subject over its body. */
function wholeOf(message: MessageDraft): string {
  return message.subject
    ? `Subject: ${message.subject}\n\n${message.body}`
    : message.body;
}
