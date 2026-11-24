import {
  type ChosenItem,
  type Draft,
  type DraftContextItem,
} from "@/shared/drafts";
import { chatAddressOf, instrumentLinkOf } from "@instrument-org/shared";
import {
  type ChatId,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";

type Viewing = SessionMessageDataPart.ViewContextDataPart;

/** Something on a draft that goes by an address: a page, an app's front, another chat. */
export type DraftLink = Exclude<DraftContextItem, ChosenItem>;

/** What of a draft goes by its address, rather than from its composer. */
export function draftLinksOf(draft: Draft | undefined): DraftLink[] {
  return (draft?.context ?? []).flatMap((item): DraftLink[] =>
    item.kind === "chat" || item.kind === "link" ? [item] : [],
  );
}

/** A link as a message names it to the agent, and as the transcript's chip of it. */
export function sentLinkOf(
  item: DraftLink,
  chatTitle: (chat: ChatId) => string | undefined,
): {
  chip: SessionMessageDataPart.SentChip;
  link: NonNullable<Viewing["links"]>[number];
} {
  if (item.kind === "chat") {
    const title = chatTitle(item.chat);
    const url = chatAddressOf(item.chat);
    return {
      chip: { id: item.chat, kind: "chat", title: title ?? url },
      link: { ...(title === undefined ? {} : { title }), url },
    };
  }
  return {
    chip: {
      kind: instrumentLinkOf(item.url) === undefined ? "page" : "screen",
      title: item.url,
      url: item.url,
    },
    link: { url: item.url },
  };
}

/**
 * What goes with a message as on screen, with the links its draft names.
 * One opened as a tab (`opened`) has its chip, and is not told as open nowhere.
 */
export function withDraftLinks(
  viewing: undefined | Viewing,
  links: readonly DraftLink[],
  {
    chatTitle,
    opened = [],
    screen,
  }: {
    chatTitle: (chat: ChatId) => string | undefined;
    opened?: readonly string[];
    /** The screen the message is written on, where nothing else says. */
    screen: Viewing["screen"];
  },
): undefined | Viewing {
  if (links.length === 0) {
    return viewing;
  }
  const sent = links.map((item) => sentLinkOf(item, chatTitle));
  const named = sent.flatMap(({ link }) =>
    opened.includes(link.url) ? [] : [link],
  );
  return {
    screen,
    ...viewing,
    attached: [...(viewing?.attached ?? []), ...sent.map(({ chip }) => chip)],
    ...(named.length > 0
      ? { links: [...(viewing?.links ?? []), ...named] }
      : {}),
  };
}
