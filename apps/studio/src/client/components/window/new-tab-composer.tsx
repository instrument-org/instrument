import {
  PromptInput,
  type PromptInputRef,
} from "@/client/components/prompt-input";
import { draftsAtom } from "@/client/drafts/store";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { createMessageOptions } from "@/client/lib/message-sends";
import { projectFolderPath } from "@/client/lib/show-in-files";
import { storageLocationQueryOptions } from "@/client/lib/output-folder";
import { commandKeyHeld } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { folderHref } from "@/shared/computer-href";
import { draftOfGroup } from "@/shared/drafts";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type ReactNode, useEffect, useRef } from "react";

import { chatListOptions } from "./chat-list-query";
import { SoftKey } from "./group-sidebar";
import { useShell } from "./shell-context";
import { useTabGroupActions } from "./tab-groups";
import { chatOfGroup } from "./window-href";
import { useWindowTabs } from "./window-tabs";

/** The keys Files takes on a new tab, which the window leaves alone elsewhere so Files' own ⌘O still opens. */
const FILES_KEY = { darwin: "CmdOrCtrl+O", default: "CmdOrCtrl+O" };

/** The caret into the address field of the tab up, with what is in it selected. */
function focusAddressField() {
  const field = document.querySelector<HTMLInputElement>(
    "[data-app-tab-active] [data-tab-location] input",
  );
  field?.focus();
  field?.select();
}

/**
 * A new tab in a group: today's composer, centered with the caret in it,
 * and Browse and Files under it. What is sent goes to the group's chat,
 * starting it in a group that has none, and the tab closes as the chat
 * takes its place. In a group whose chat has not started, what is typed is
 * written into the group's draft, so closing the group keeps it.
 */
export function NewTabComposer({
  group,
  tabId,
}: {
  group: string;
  tabId: string;
}) {
  const shell = useShell();
  const windowTabs = useWindowTabs();
  const groups = useTabGroupActions();
  const isActive = useIsActiveTab();
  const inputRef = useRef<PromptInputRef>(null);
  const [defaultModelURI, setDefaultModelURI] = useDefaultModelURI();
  const chatId = chatOfGroup(group);
  const draftId = draftOfGroup(group);
  const drafts = useAtomValue(draftsAtom);
  const draft = drafts.find((entry) => entry.id === draftId);
  const { data: sessionId } = useQuery({
    ...chatListOptions(),
    select: (chats) => chats.find((entry) => entry.id === chatId)?.sessionId,
  });
  const info = useQuery(
    rpcClient.workspace.chats.live.info.experimental_liveOptions({
      enabled: chatId !== undefined,
      input: { id: chatId ?? ("" as never) },
    }),
  );
  const modelURI = info.data?.modelURI ?? defaultModelURI;
  const createMessage = useMutation(createMessageOptions());
  const location = useQuery(storageLocationQueryOptions()).data;
  const projectId = draft?.projectId;
  const { data: chatProject } = useQuery({
    ...chatListOptions(),
    select: (chats) => chats.find((entry) => entry.id === chatId)?.project,
  });
  const project = shell.projects.find(
    (entry) => entry.id === (projectId ?? chatProject),
  );

  const openFiles = () => {
    if (!location) {
      return;
    }
    const folder = project
      ? projectFolderPath(location.rootDir, project.name)
      : location.rootDir;
    windowTabs.visitHref(tabId, folderHref(folder));
  };

  // Files' key works here alone, so a Files tab keeps ⌘O for opening what is selected.
  useEffect(() => {
    if (!isActive) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === "o" &&
        commandKeyHeld(event) &&
        !event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault();
        openFiles();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  });

  useEffect(() => {
    if (isActive) {
      inputRef.current?.focus();
    }
  }, [isActive]);

  return (
    <div className="grid h-full place-items-center overflow-y-auto bg-background px-8 pb-20">
      <div className="w-full max-w-160">
        <PromptInput
          autoFocus
          draftKey={
            draftId === undefined
              ? { id: `new-tab:${tabId}`, scope: "transient" }
              : { draftId, scope: "draft" }
          }
          isLoading={false}
          keyboardHome
          {...(modelURI ? { modelURI } : {})}
          onModelChange={setDefaultModelURI}
          onSubmit={(send) => {
            if (draftId !== undefined) {
              shell.startChat(draftId, send);
              return;
            }
            if (chatId === undefined || !sessionId) {
              return;
            }
            createMessage.mutate({
              files: send.files,
              folders: send.folders,
              id: chatId,
              modelURI: send.modelURI,
              prompt: send.prompt,
              sessionId,
            });
            groups.setChatOpen(group, true);
            windowTabs.close(tabId);
          }}
          placeholder="What do you need?"
          ref={inputRef}
        />
        <div className="mt-3 flex gap-3">
          <NewTabButton
            icon={<GlobeIcon className="size-4.5 text-foreground/60" />}
            keys={formatAcceleratorText(WINDOW_SHORTCUTS.search.accelerator)}
            label="Browse"
            onClick={focusAddressField}
          />
          <NewTabButton
            icon={<FolderSimpleIcon className="size-4.5 text-foreground/60" />}
            keys={formatAcceleratorText(FILES_KEY)}
            label="Files"
            onClick={openFiles}
          />
        </div>
      </div>
    </div>
  );
}

function NewTabButton({
  icon,
  keys,
  label,
  onClick,
}: {
  icon: ReactNode;
  keys: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex h-10 flex-1 items-center gap-2.5 rounded-xl bg-card px-3.5 text-[13px] font-medium text-foreground/80 shadow-xs ring-1 ring-border hover:bg-foreground/[0.03] hover:text-foreground"
      onClick={onClick}
      type="button"
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      <SoftKey>{keys}</SoftKey>
    </button>
  );
}
