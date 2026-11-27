import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { rpcClient } from "@/client/rpc/client";
import { type PageDialog, type PageDialogAnswer } from "@/shared/browser";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

/** The oldest dialog a tab's page is waiting on, or null. */
export function useGuestPageDialog(
  targetId: BrowserTargetId | null,
): PageDialog | null {
  const { data } = useQuery(
    rpcClient.browser.live.pageDialogs.experimental_liveOptions(),
  );
  return data?.find((dialog) => dialog.targetId === targetId) ?? null;
}

/**
 * A page's own dialog over its tab, the way a browser shows one: the page
 * stays in view behind it and waits until it is answered.
 */
export function PageDialogSheet({ dialog }: { dialog: PageDialog }) {
  const [text, setText] = useState(dialog.defaultValue ?? "");
  const { isPending, mutate } = useMutation(
    rpcClient.browser.answerPageDialog.mutationOptions(),
  );
  const answer = (given: PageDialogAnswer) => {
    mutate({ answer: given, id: dialog.id });
  };
  // Chromium's own words for a page that holds its going up.
  const going =
    dialog.kind === "leave"
      ? { button: "Leave", title: "Leave site?" }
      : dialog.kind === "reload"
        ? { button: "Reload", title: "Reload site?" }
        : undefined;
  const title = going?.title ?? `${dialog.site} says`;
  return (
    <div
      className="absolute inset-0 z-20 flex items-start justify-center p-6"
      role="presentation"
    >
      <form
        aria-label={title}
        className="w-full max-w-md space-y-4 rounded-xl border bg-popover p-5 shadow-float-lg"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            answer({ accept: false });
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          answer(
            dialog.kind === "prompt"
              ? { accept: true, text }
              : { accept: true },
          );
        }}
        role="dialog"
      >
        <div className="space-y-1">
          <p className="font-medium break-words">{title}</p>
          <p className="text-sm break-words whitespace-pre-wrap text-muted-foreground">
            {going ? "Changes you made may not be saved." : dialog.message}
          </p>
        </div>
        {dialog.kind === "prompt" && (
          <Input
            aria-label={dialog.message || "Answer"}
            autoFocus
            onChange={(event) => {
              setText(event.target.value);
            }}
            spellCheck={false}
            value={text}
          />
        )}
        <div className="flex justify-end gap-2">
          {dialog.kind !== "alert" && (
            <Button
              disabled={isPending}
              onClick={() => {
                answer({ accept: false });
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
          )}
          <Button
            autoFocus={dialog.kind !== "prompt"}
            disabled={isPending}
            size="sm"
            type="submit"
          >
            {going?.button ?? "OK"}
          </Button>
        </div>
      </form>
    </div>
  );
}
