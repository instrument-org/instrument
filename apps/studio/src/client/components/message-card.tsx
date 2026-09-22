import { CopyButton } from "@/client/components/copy-button";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { cn, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  type MessageDraft,
  type MessageKind,
  parseMessage,
} from "@instrument-org/workspace/client";
import { ArrowUpRightIcon } from "@phosphor-icons/react/ArrowUpRight";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { ChatsIcon } from "@phosphor-icons/react/Chats";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/EnvelopeSimple";
import { ExportIcon } from "@phosphor-icons/react/Export";
import { MegaphoneIcon } from "@phosphor-icons/react/Megaphone";
import { NoteIcon } from "@phosphor-icons/react/Note";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useContext } from "react";

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
 * reply's own type, and the ways out. Each part copies on its own from the
 * control that shows while it is hovered, and Copy takes the whole.
 *
 * Nothing sends from here. An email opens in a mail app or Gmail filled in,
 * and on macOS anything shares to Messages or wherever the user picks.
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
  const kind = KIND[message.kind];
  const canShare = isMacOS();
  const settled = !isStreaming && message.body !== "";

  const shareIt = () => {
    share.mutate({ text: message.body });
  };

  return (
    <div className="not-prose my-2 w-full min-w-0 rounded-xl border border-border bg-card text-card-foreground shadow-xs">
      <div className="flex min-w-0 items-center gap-2 border-b border-border px-3.5 py-2 text-xs text-muted-foreground [&_svg]:size-3.5">
        {kind.icon}
        <span className="shrink-0">{kind.label}</span>
        {message.to && (
          <CopyablePart inline label="Copy recipient" value={message.to}>
            <span className="truncate">
              to <span className="text-foreground">{message.to}</span>
            </span>
          </CopyablePart>
        )}
        {message.via && <span className="shrink-0">· {message.via}</span>}
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
      <div className="flex flex-col gap-2 px-3.5 py-3">
        {message.subject && (
          <CopyablePart label="Copy subject" value={message.subject}>
            <p className="text-sm font-semibold">{message.subject}</p>
          </CopyablePart>
        )}
        <CopyablePart label="Copy body" value={message.body}>
          <p className="text-sm/[1.55] whitespace-pre-wrap">
            {message.body || " "}
          </p>
        </CopyablePart>
      </div>
      <div className="flex items-center gap-1.5 px-3.5 pb-3">
        <Button
          disabled={!settled}
          onClick={() => void navigator.clipboard.writeText(wholeOf(message))}
          size="xs"
          variant="default"
        >
          Copy
        </Button>
        <span className="ml-auto">
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
                  <EnvelopeSimpleIcon className="size-4" />
                  Open in Mail
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    openExternal(gmailOf(message), { addReferral: false });
                  }}
                >
                  <ArrowUpRightIcon className="size-4" />
                  Open in Gmail
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
        </span>
      </div>
    </div>
  );
}

/** A ```message fence in a reply, drawn as the card while it streams in. */
export function MessageFence({ code }: { code: string }) {
  const { isStreaming } = useContext(MarkdownTaskContext);
  return <MessageCard isStreaming={isStreaming} message={parseMessage(code)} />;
}

/** A part of the message with its own copy control, shown while hovered. */
function CopyablePart({
  children,
  inline = false,
  label,
  value,
}: {
  children: ReactNode;
  /** In the head's single line, where the control centers on the text. */
  inline?: boolean;
  /** What the control copies, as its name: "Copy subject". */
  label: string;
  value: string;
}) {
  return (
    <div
      className={cn(
        "group/part relative flex min-w-0 gap-1",
        inline ? "items-center" : "items-start",
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <CopyButton
        className={cn(
          "shrink-0 rounded-sm text-muted-foreground opacity-0 group-hover/part:opacity-100 hover:bg-muted/50 hover:text-foreground focus-visible:opacity-100",
          inline ? "-my-1 p-1" : "p-1",
        )}
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

/** Everything, the way it pastes: an email's subject over its body. */
function wholeOf(message: MessageDraft): string {
  return message.subject
    ? `Subject: ${message.subject}\n\n${message.body}`
    : message.body;
}
