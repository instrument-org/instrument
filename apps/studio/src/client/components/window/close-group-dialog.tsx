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
 * Asked before a group whose agent is working closes: the group's row as the
 * sidebar draws it, then Stop and close under Return and Keep open under
 * Escape.
 */
export function CloseGroupDialog({
  entry,
  onCancel,
  onConfirm,
}: {
  entry: TabGroup | undefined;
  onCancel: () => void;
  onConfirm: (entry: TabGroup) => void;
}) {
  const stopRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
      open={entry !== undefined}
    >
      <AlertDialogContent
        className="max-w-100"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          stopRef.current?.focus();
        }}
      >
        <AlertDialogTitle className="sr-only">
          Stop and close this tab group?
        </AlertDialogTitle>
        {entry && (
          <div className="pointer-events-none rounded-xl bg-foreground/[0.03] p-1">
            <GroupRow chatTitles={NO_TITLES} entry={entry} isUp />
          </div>
        )}
        <AlertDialogFooter>
          <Button onClick={onCancel} variant="outline">
            Keep open
            <KeyCap>Esc</KeyCap>
          </Button>
          <Button
            onClick={() => {
              if (entry) {
                onConfirm(entry);
              }
            }}
            ref={stopRef}
            variant="destructive"
          >
            Stop and close
            <KeyCap onColor>{osConventions().returnKey}</KeyCap>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
