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
import { noteTabCommand } from "../tab-activity";
import {
  agentDownloadsFolder,
  notePageDownload,
  pageDownloadsNote,
} from "./page-downloads";

const CHAT = ChatIdSchema.parse("2026-11-27-reports");
const newTab = () => browserTargetOf(StoreId.newTabId());

beforeEach(() => {
  createMockChatConfig(CHAT);
});

describe("a download a page an agent drives starts", () => {
  it("goes in the downloads folder of the chat that last acted in the tab", () => {
    const tab = newTab();
    noteTabCommand(tab, { chatId: CHAT, sessionId: StoreId.newSessionId() });

    expect(agentDownloadsFolder(tab)).toBe(
      path.join(MOCK_WORKSPACE_DIRS.work, CHAT, "downloads"),
    );
  });

  it("is the person's in a tab no session acted in", () => {
    expect(agentDownloadsFolder(newTab())).toBeUndefined();
  });

  it("is told to the session that drove the tab, once as it begins and again as it ends", () => {
    const tab = newTab();
    const session = StoreId.newSessionId();
    noteTabCommand(tab, { chatId: CHAT, sessionId: session });
    const saved = path.join("/work", "downloads", "report (1).csv");

    notePageDownload(tab, "d1", { path: saved, state: "running" });
    const begun = pageDownloadsNote(session);
    notePageDownload(tab, "d1", { path: saved, state: "completed" });
    const ended = pageDownloadsNote(session);

    expect(
      [begun, ended, pageDownloadsNote(session)].map((note) =>
        note?.replace(tab, "<tab>"),
      ),
    ).toEqual([
      `The page in tab <tab> is downloading report (1).csv to ${shellPath(saved)}; a later result says when it finishes.\n`,
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
    noteTabCommand(tab, { chatId: CHAT, sessionId: session });

    notePageDownload(tab, "d1", { path: "/w/downloads/report.csv", state });

    expect(pageDownloadsNote(session)?.replace(tab, "<tab>")).toContain(line);
  });

  it("tells nobody of a tab no session acted in", () => {
    const session = StoreId.newSessionId();
    notePageDownload(newTab(), "d1", { path: "/x.csv", state: "completed" });

    expect(pageDownloadsNote(session)).toBeUndefined();
  });
});
