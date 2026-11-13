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
import { type TabGroup } from "./tab-groups";

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
 * Asked before groups whose agents are working close, once for all of them:
 * each group's row as the sidebar draws it, then Stop and close under Return
 * and Keep open under Escape, which closes none of what was asked.
 */
export function CloseGroupDialog({
  entries,
  onCancel,
  onConfirm,
}: {
  entries: readonly TabGroup[] | undefined;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const stopRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
      open={entries !== undefined}
    >
      <AlertDialogContent
        className="max-w-100"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          stopRef.current?.focus();
        }}
      >
        <AlertDialogTitle className="sr-only">
          {entries && entries.length > 1
            ? "Stop and close these tab groups?"
            : "Stop and close this tab group?"}
        </AlertDialogTitle>
        {entries && (
          <div className="pointer-events-none flex max-h-80 flex-col gap-0.5 overflow-hidden rounded-xl bg-foreground/[0.03] p-1">
            {entries.map((entry) => (
              <GroupRow
                chatTitles={NO_TITLES}
                entry={entry}
                isUp
                key={entry.group}
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
