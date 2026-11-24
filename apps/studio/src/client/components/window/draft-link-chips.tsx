import { AttachedItemPreview } from "@/client/components/attached-item-preview";
import { updateDraftAtom } from "@/client/drafts/store";
import { type Draft } from "@/shared/drafts";
import { chatAddressOf, instrumentLinkOf } from "@instrument-org/shared";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { SquaresFourIcon } from "@phosphor-icons/react/SquaresFour";
import { useSetAtom } from "jotai";
import { useContext } from "react";

import { draftLinksOf } from "./draft-links";
import { ShellContext } from "./shell-context";

/** The pages, apps and chats a draft names, as chips in its composer, each taken off the draft by its x. */
export function DraftLinkChips({ draft }: { draft: Draft }) {
  const shell = useContext(ShellContext);
  const updateDraft = useSetAtom(updateDraftAtom);
  return draftLinksOf(draft).map((item) => {
    const url = item.kind === "chat" ? chatAddressOf(item.chat) : item.url;
    const label =
      item.kind === "chat" ? (shell?.chatTitles.get(item.chat) ?? url) : url;
    return (
      <AttachedItemPreview
        icon={
          item.kind === "chat" ? (
            <ChatCircleIcon />
          ) : instrumentLinkOf(item.url) === undefined ? (
            <GlobeIcon />
          ) : (
            <SquaresFourIcon />
          )
        }
        key={url}
        label={label}
        onRemove={() => {
          updateDraft({
            id: draft.id,
            update: ({ context, ...rest }) => {
              const left = (context ?? []).filter((each) =>
                each.kind === "chat"
                  ? chatAddressOf(each.chat) !== url
                  : each.kind !== "link" || each.url !== url,
              );
              return left.length > 0 ? { ...rest, context: left } : rest;
            },
          });
        }}
        tooltip={url}
      />
    );
  });
}
