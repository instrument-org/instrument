import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/client/components/ui/alert-dialog";
import { Button } from "@/client/components/ui/button";
import { osConventions } from "@/client/lib/utils";
import { type ChatId } from "@instrument-org/workspace/client";
import { useRef } from "react";

import { GroupRow } from "./group-sidebar";
import { type WorkingChat } from "./tab-groups";

const NO_TITLES = new Map<ChatId, string>();

/** A key printed on a button, so the dialog reads as answerable from the keyboard. */
function KeyCap({
  children,
  onColor = false,
}: {
  children: string;
  onColor?: boolean;
}) {
  return (
    <span
      className={
        onColor
          ? "ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] bg-white/20 px-1 text-[11px] font-medium text-white"
          : "ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] bg-foreground/6 px-1 text-[11px] font-medium text-muted-foreground ring-1 ring-foreground/8"
      }
    >
      {children}
    </span>
  );
}

/**
 * Asked before groups close while chats in them are working, once for all
 * of them: a row for each chat at work, whichever of its group's chats it
 * is, named by the chat and drawn as the sidebar draws a chat's group, then
 * Stop and close under Return and Keep open under Escape, which closes none
 * of what was asked.
 */
export function CloseGroupDialog({
  groupCount,
  onCancel,
  onConfirm,
  working,
}: {
  /** How many groups are closing, working or not. */
  groupCount: number;
  onCancel: () => void;
  onConfirm: () => void;
  /** The chats at work in them; the dialog is up while there are any. */
  working: readonly WorkingChat[] | undefined;
}) {
  const stopRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
      open={working !== undefined}
    >
      <AlertDialogContent
        className="max-w-100"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          stopRef.current?.focus();
        }}
      >
        <AlertDialogTitle className="sr-only">
          {groupCount > 1
            ? "Stop and close these tab groups?"
            : "Stop and close this tab group?"}
        </AlertDialogTitle>
        {working && (
          <div className="pointer-events-none flex max-h-80 flex-col gap-0.5 overflow-hidden rounded-xl bg-foreground/[0.03] p-1">
            {working.map(({ chat, group }) => (
              <GroupRow
                chatTitles={NO_TITLES}
                entry={{
                  chat,
                  group,
                  kind: "chat",
                  pinned: false,
                  title: chat.title,
                }}
                isUp
                key={chat.id}
              />
            ))}
          </div>
        )}
        <AlertDialogFooter>
          <Button onClick={onCancel} variant="outline">
            Keep open
            <KeyCap>Esc</KeyCap>
          </Button>
          <Button onClick={onConfirm} ref={stopRef} variant="destructive">
            Stop and close
            <KeyCap onColor>{osConventions().returnKey}</KeyCap>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
