import { PAGE_EDIT_CHANNEL } from "@/shared/page-editor-channels";
import { lastBrowserAgentActivity } from "@instrument-org/workspace/electron";
import { type Input, ipcMain, type WebContents } from "electron";

import { personJustUsedTab, USER_INPUT_WINDOW_MS } from "./external-app-links";
import { type GuestRecord, guests } from "./guest-registry";
import { log } from "./log";

/**
 * Whether something entered into a tab's page is a person's. An agent's
 * command enters text as the same real input a person's typing is, so an
 * entry counts when a person clicked or pressed a key in the tab within the
 * last few seconds, or when no agent has sent the tab a command in that long:
 * dictation and a paste from a menu come with no key of the person's at all.
 */
export function isPersonEdit(
  record: Pick<GuestRecord, "role" | "userInputAt">,
  agentAt: number | undefined,
  now = Date.now(),
) {
  return (
    record.role === "webview" &&
    (personJustUsedTab(record, now) ||
      agentAt === undefined ||
      now - agentAt > USER_INPUT_WINDOW_MS)
  );
}

/** Marks a tab's page as holding something a person entered, until it loads another document. */
export function notePersonEdit(record: GuestRecord, from: "frame" | "page") {
  if (record.edited) {
    return;
  }
  record.edited = true;
  log.info(`page edited guest=${record.id} from=${from}`);
}

/** Whether a key event is a character being typed, where a chord or an arrow is not. */
export function isTypedCharacter(
  input: Pick<Input, "control" | "key" | "meta" | "type">,
) {
  return (
    input.type === "keyDown" &&
    input.key.length === 1 &&
    !input.control &&
    !input.meta
  );
}

/**
 * Whether a key a person typed went to a frame below the page's main one.
 * Such a frame has no preload to say whether it landed in a field, so it
 * counts as something entered.
 */
export function typedIntoFrame(contents: WebContents) {
  const focused = contents.focusedFrame;
  return (
    focused !== null &&
    focused.frameTreeNodeId !== contents.mainFrame.frameTreeNodeId
  );
}

/** Whether a person entered something into the page since its document loaded. */
export function isEdited(contents: WebContents | null | undefined) {
  return (contents ? guests.get(contents.id)?.edited : undefined) ?? false;
}

/**
 * Takes what a guest's preload says was entered into its page's main
 * document, typed there or put back by the browser as the page came back.
 */
export function listenForPageEdits() {
  ipcMain.on(PAGE_EDIT_CHANNEL, (event) => {
    const contents = event.sender;
    const record = guests.get(contents.id);
    if (
      !record ||
      record.edited ||
      event.senderFrame?.frameTreeNodeId !== contents.mainFrame.frameTreeNodeId
    ) {
      return;
    }
    const targetId = record.entry?.targetId;
    const agentAt =
      targetId === undefined ? undefined : lastBrowserAgentActivity(targetId);
    if (isPersonEdit(record, agentAt)) {
      notePersonEdit(record, "page");
    }
  });
}
