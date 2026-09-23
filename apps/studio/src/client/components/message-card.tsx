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
import { useTimedFlag } from "@/client/hooks/use-timed-flag";
import { isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  type MessageDraft,
  type MessageKind,
  parseMessage,
} from "@instrument-org/workspace/client";
import { ArrowUpRightIcon } from "@phosphor-icons/react/ArrowUpRight";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { ChatsIcon } from "@phosphor-icons/react/Chats";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/EnvelopeSimple";
import { ExportIcon } from "@phosphor-icons/react/Export";
import { MegaphoneIcon } from "@phosphor-icons/react/Megaphone";
import { NoteIcon } from "@phosphor-icons/react/Note";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useContext, useState } from "react";

import { MarkdownTaskContext } from "./markdown-task-context";

const KIND: Record<MessageKind, { icon: ReactNode; label: string }> = {
  chat: { icon: <ChatsIcon />, label: "Message" },
  comment: { icon: <ChatCircleIcon />, label: "Comment" },
  email: { icon: <EnvelopeSimpleIcon />, label: "Email" },
  other: { icon: <NoteIcon />, label: "Text" },
  post: { icon: <MegaphoneIcon />, label: "Post" },
  text: { icon: <ChatCircleIcon />, label: "Text" },
};

const ADDRESS = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/**
 * Words the user will send as their own, drawn as the thing they are rather
 * than as prose: what it is and who it is for, the subject and body in the
 * reply's own type, and the ways out. The subject and body each copy from the
 * control that shows while they are hovered, an address copies when clicked,
 * and Copy takes the whole.
 *
 * Nothing sends from here. An email opens filled in, in the mail app or in
 * Gmail in the browser, each named with its icon, and on macOS anything shares
 * to Messages or wherever the user picks.
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
  const openExternal = useOpenExternalLink();
  const share = useMutation(rpcClient.utils.shareText.mutationOptions());
  const { data: targets } = useQuery(
    rpcClient.utils.sendTargets.queryOptions({
      enabled: message.kind === "email",
      staleTime: Infinity,
    }),
  );
  const { active: copied, trigger: showCopied } = useTimedFlag();
  const kind = KIND[message.kind];
  const canShare = isMacOS();
  const settled = !isStreaming && message.body !== "";

  const shareIt = () => {
    share.mutate({ text: message.body });
  };

  const copyWhole = async () => {
    await navigator.clipboard.writeText(wholeOf(message));
    showCopied();
  };

  return (
    <div className="not-prose my-2 w-full min-w-0 rounded-xl border border-border bg-card text-card-foreground shadow-xs">
      <div className="flex min-w-0 items-center gap-2 border-b border-border px-3.5 py-2 text-xs text-muted-foreground [&_svg]:size-3.5">
        {kind.icon}
        <span className="min-w-0 truncate">
          {message.via
            ? `${message.via} ${kind.label.toLowerCase()}`
            : kind.label}
          {message.to && (
            <>
              {" to "}
              <Recipient to={message.to} />
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
        <Button
          disabled={!settled}
          onClick={() => void copyWhole()}
          size="xs"
          variant="outline"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied" : "Copy"}
        </Button>
        {message.kind === "email" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={!settled} size="xs" variant="brand">
                Send
                <CaretDownIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom">
              <DropdownMenuItem
                onSelect={() => {
                  openExternal(mailtoOf(message), { addReferral: false });
                }}
              >
                <AppIcon fallback={<EnvelopeSimpleIcon />} target={targets?.mail} />
                Open in {targets?.mail?.name ?? "Mail"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  openExternal(gmailOf(message), { addReferral: false });
                }}
              >
                <AppIcon fallback={<ArrowUpRightIcon />} target={targets?.browser} />
                {targets?.browser
                  ? `Open Gmail in ${targets.browser.name}`
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
              disabled={!settled}
              onClick={shareIt}
              size="xs"
              variant="brand"
            >
              <ExportIcon />
              Share
            </Button>
          )
        )}
      </div>
    </div>
  );
}

/** A ```message fence in a reply, drawn as the card while it streams in. */
export function MessageFence({ code }: { code: string }) {
  const { isStreaming } = useContext(MarkdownTaskContext);
  return <MessageCard isStreaming={isStreaming} message={parseMessage(code)} />;
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

/** Everything, the way it pastes: an email's subject over its body. */
function wholeOf(message: MessageDraft): string {
  return message.subject
    ? `Subject: ${message.subject}\n\n${message.body}`
    : message.body;
}
