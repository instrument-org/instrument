import { SiteIcon } from "@/client/components/inline-link";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { isWebPage } from "@/client/lib/open-target";
import { tidyLink, titleLabel } from "@/client/lib/tidy-link";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { CopyIcon } from "@phosphor-icons/react/Copy";
import { LinkBreakIcon } from "@phosphor-icons/react/LinkBreak";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { type PromptLink } from "./prompt-editor-links";

/**
 * What a link in the reply box offers while the caret is in it: where it
 * goes, then Open, Copy, and for linked words Edit and Unlink.
 *
 * The page's title shows only when this computer already has it, from a page
 * the app's browser opened or a link sent before. Nothing here asks the page:
 * an address in the box is one the person has not sent yet, and may never.
 *
 * Every control keeps the editor's focus on a press, so the caret stays in
 * the link the bar is about; only the address field, while editing, takes it.
 */
export function PromptLinkBar({
  link,
  onDone,
  onEdit,
  onOpen,
  onRemove,
}: {
  link: PromptLink;
  /** Editing ended, saved or not: the caret goes back to the box. */
  onDone: () => void;
  onEdit: (href: string) => void;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const web = isWebPage(link.href);
  const { data: pageTitle } = useQuery(
    rpcClient.history.live.title.experimental_liveOptions({
      input: web ? { url: link.href } : skipToken,
    }),
  );
  const titled = pageTitle ? titleLabel(pageTitle, link.href) : undefined;
  const address = tidyLink(link.href, link.href)?.shown ?? link.href;

  if (draft !== null) {
    return (
      <form
        className="flex items-center gap-1 py-0.5 pr-0.5 pl-2"
        onSubmit={(event) => {
          event.preventDefault();
          const href = draft.trim();
          if (href && href !== link.href) {
            onEdit(href);
          }
          setDraft(null);
          onDone();
        }}
      >
        <input
          aria-label="Link address"
          autoFocus
          className="h-7 w-72 min-w-0 bg-transparent text-sm outline-none"
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setDraft(null);
              onDone();
            }
          }}
          value={draft}
        />
        <button
          className="h-7 rounded-lg px-2 text-sm font-medium hover:bg-accent"
          type="submit"
        >
          Save
        </button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-0.5 p-0.5">
      <BarButton label="Open" onPress={onOpen}>
        {web && <SiteIcon className="mr-0.5" href={link.href} />}
        <span className="max-w-56 truncate">{titled ?? address}</span>
        {titled && (
          <span className="ml-0.5 max-w-48 truncate text-xs text-muted-foreground">
            {address}
          </span>
        )}
      </BarButton>
      <span className="mx-1.5 h-5 w-px shrink-0 bg-border" />
      <BarButton label="Open" onPress={onOpen}>
        <ArrowSquareOutIcon className="size-4 text-muted-foreground" />
        <span>Open</span>
      </BarButton>
      {link.labeled && (
        <BarButton
          icon
          label="Edit link"
          onPress={() => {
            setDraft(link.href);
          }}
        >
          <PencilSimpleIcon className="size-4 text-muted-foreground" />
        </BarButton>
      )}
      <BarButton
        icon
        label="Copy link"
        onPress={() => {
          void navigator.clipboard.writeText(link.href).catch(() => undefined);
        }}
      >
        <CopyIcon className="size-4 text-muted-foreground" />
      </BarButton>
      {link.labeled && (
        <BarButton icon label="Unlink" onPress={onRemove}>
          <LinkBreakIcon className="size-4 text-muted-foreground" />
        </BarButton>
      )}
    </div>
  );
}

function BarButton({
  children,
  icon = false,
  label,
  onPress,
}: {
  children: React.ReactNode;
  icon?: boolean;
  label: string;
  onPress: () => void;
}) {
  const button = (
    <button
      aria-label={icon ? label : undefined}
      className={cn(
        "flex h-7 shrink-0 items-center justify-center gap-1 rounded-lg text-sm hover:bg-accent",
        icon ? "w-7" : "px-2",
      )}
      // Mousedown, defaulted out, so pressing never takes the caret out of
      // the link this bar is about.
      onMouseDown={(event) => {
        event.preventDefault();
        onPress();
      }}
      // A press from the keyboard, which brings no mousedown.
      onClick={(event) => {
        if (event.detail === 0) {
          onPress();
        }
      }}
      type="button"
    >
      {children}
    </button>
  );
  if (!icon) {
    return button;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
