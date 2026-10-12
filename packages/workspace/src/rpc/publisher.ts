import { EventPublisher } from "@orpc/server";

import { type AppEvent } from "../lib/apps/changed";
import { type RecordChanged } from "../lib/record-changes";
import { type WorkspaceSnapshot } from "../machines/workspace";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import {
  type WindowTabAnswer,
  type WindowTabRequest,
} from "../schemas/window-tab";
import { type BrowserTargetId } from "../types";

export const publisher = new EventPublisher<{
  /**
   * The user acted on an app outside the conversation: finished a sign-in,
   * saved a key, declined, disconnected. Published only by `appChanged`,
   * which the host app calls from the surfaces it owns; the chat is woken
   * with it.
   */
  "app.event": {
    /** The account the app is signed in as, when it is named. */
    account?: string;
    detail?: string;
    event: AppEvent;
    name: string;
    slug: string;
    /** For a web app, the site the work happens on. */
    web?: string;
  };
  /**
   * An app's folder or connection record changed. Carries no payload because
   * every listener re-reads the list. Published only by `appChanged`.
   */
  "app.updated": null;
  /**
   * A background process in this chat appeared, ended, or was removed. Carries
   * no detail because every listener re-reads the list, and deliberately not
   * published per chunk of output: what a viewer needs is whether the process
   * is still there, not what it just printed.
   */
  "backgroundProcesses.changed": {
    id: ChatId;
  };
  /**
   * The agent sent a command to this chat's browser. One per command rather
   * than a start/stop pair: the agent's browser work arrives as separate tool
   * calls seconds apart, so where one stretch of it ends is a question for
   * whoever is displaying it, not one this can answer.
   */
  "browser.agentActivity": {
    id: ChatId;
    /** The guest the command went to: a task's own, or a tab of the window's it was handed. */
    targetId: BrowserTargetId;
  };
  /**
   * A memory was saved, corrected, or forgotten. Carries no payload because
   * every listener re-reads the folder.
   */
  "memory.changed": null;
  "message.removed": {
    id: ChatId;
    messageId: StoreId.Message;
    sessionId: StoreId.Session;
  };
  "message.updated": {
    id: ChatId;
    messageId: StoreId.Message;
    sessionId: StoreId.Session;
  };
  "part.updated": {
    id: ChatId;
    part: SessionMessagePart.Type;
  };
  /**
   * Something about one record moved: its transcript, its sessions, its
   * settings or state, its agent, or the record itself is gone. Published
   * where the change is made (the store's write layer, the record writer,
   * the session actor), so a view that re-reads on it
   * hears every change without keeping a list of events. Read through
   * `recordChanges` in `lib/record-changes.ts`.
   */
  "record.changed": RecordChanged;
  "runtime.log.updated": {
    id: ChatId;
  };
  "session.done": {
    id: ChatId;
    sessionId: StoreId.Session;
  };
  /**
   * The workspace skills directory changed: a skill was installed, revised, or
   * deleted. Carries no payload because every listener re-reads the list.
   */
  "skill.changed": null;
  /**
   * An agent asking the window to act on its tabs: open one (on screen, or
   * behind whatever is up), point one at something else, close one, or bring
   * one forward. Each ask carries a request id, which the window's answer
   * comes back under.
   */
  "window.tab": WindowTabRequest & { id: ChatId };
  /**
   * The window answering an ask: the tab it acted on or made, by the id the
   * conversation names it with and a task can be handed, or why it did
   * nothing.
   */
  "window.tabDone": WindowTabAnswer & { id: ChatId };
  "workspaceActor.snapshot": WorkspaceSnapshot;
}>({
  // Per subscription, starting empty when it subscribes: what a subscriber
  // that is still busy with one event holds of the ones after it. Many of
  // these carry something that cannot be read back later (a tab ask, a
  // tool call starting), so they queue rather than leave only the newest. A
  // live route re-reading state on them collapses a burst into one read
  // (`liveRead`), so queuing costs it nothing.
  maxBufferedEvents: 100,
});
