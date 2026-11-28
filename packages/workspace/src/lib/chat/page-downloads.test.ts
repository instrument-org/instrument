import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import {
  createMockChatConfig,
  MOCK_WORKSPACE_DIRS,
} from "../../test/helpers/mock-chat-config";
import { browserTargetOf } from "../../types";
import { shellPath } from "../shell-path";
import { noteTabCommand, noteTabPages } from "../tab-activity";
import {
  agentDownloadsFolder,
  notePageDownload,
  pageDownloadsNote,
} from "./page-downloads";

const CHAT = ChatIdSchema.parse("2026-11-27-reports");
const told = (sessionId: StoreId.Session) => pageDownloadsNote({ sessionId });
const newTab = () => browserTargetOf(StoreId.newTabId());

beforeEach(() => {
  createMockChatConfig(CHAT);
});

describe("a download a page an agent drives starts", () => {
  it("goes in the downloads folder of the chat that last acted in the tab", () => {
    const tab = newTab();
    noteTabCommand(
      { tabId: tab, targetId: tab },
      { chatId: CHAT, sessionId: StoreId.newSessionId() },
    );

    expect(agentDownloadsFolder(tab)).toBe(
      path.join(MOCK_WORKSPACE_DIRS.work, CHAT, "downloads"),
    );
  });

  it("is told to the session that drove the tab, from the page that draws it now", () => {
    // A tab on an HTML file, walked to another file and back since the
    // session drove it, drawn by a new page.
    const tabId = StoreId.newTabId();
    const first = newTab();
    const next = newTab();
    const session = StoreId.newSessionId();
    noteTabCommand(
      { tabId, targetId: first },
      { chatId: CHAT, sessionId: session },
    );
    noteTabPages([{ id: tabId, targetId: next }]);
    const saved = path.join("/work", "downloads", "report.csv");

    expect(agentDownloadsFolder(next)).toBe(
      path.join(MOCK_WORKSPACE_DIRS.work, CHAT, "downloads"),
    );
    notePageDownload(next, "d2", { path: saved, state: "completed" });

    expect(told(session)).toBe(
      `The page in tab ${tabId} downloaded report.csv to ${shellPath(saved)}.\n`,
    );
  });

  it("is the person's in a tab no session acted in", () => {
    expect(agentDownloadsFolder(newTab())).toBeUndefined();
  });

  it("is told to the session that drove the tab, once as it begins and again as it ends", () => {
    const tab = newTab();
    const session = StoreId.newSessionId();
    noteTabCommand(
      { tabId: tab, targetId: tab },
      { chatId: CHAT, sessionId: session },
    );
    const saved = path.join("/work", "downloads", "report (1).csv");

    notePageDownload(tab, "d1", { path: saved, state: "running" });
    const begun = told(session);
    notePageDownload(tab, "d1", { path: saved, state: "completed" });
    const ended = told(session);

    expect(
      [begun, ended, told(session)].map((note) => note?.replace(tab, "<tab>")),
    ).toEqual([
      `The page in tab <tab> is downloading report (1).csv to ${shellPath(saved)}; the file is incomplete until a later result says it finished.\n`,
      `The page in tab <tab> downloaded report (1).csv to ${shellPath(saved)}.\n`,
      undefined,
    ]);
  });

  it.each([
    ["completed", "downloaded report.csv to /w/downloads/report.csv."],
    [
      "canceled",
      "The download of report.csv the page in tab <tab> started was canceled.",
    ],
    [
      "failed",
      "The download of report.csv the page in tab <tab> started failed.",
    ],
  ] as const)("says one that ended %s", (state, line) => {
    const tab = newTab();
    const session = StoreId.newSessionId();
    noteTabCommand(
      { tabId: tab, targetId: tab },
      { chatId: CHAT, sessionId: session },
    );

    notePageDownload(tab, "d1", { path: "/w/downloads/report.csv", state });

    expect(told(session)?.replace(tab, "<tab>")).toContain(line);
  });

  it("tells nobody of a tab no session acted in", () => {
    const session = StoreId.newSessionId();
    notePageDownload(newTab(), "d1", { path: "/x.csv", state: "completed" });

    expect(told(session)).toBeUndefined();
  });
});
