import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Session } from "../schemas/session";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { TypedError } from "./errors";
import { Store } from "./store";
import { updateSessionTitle } from "./update-session-title";
import { getWorkspaceConfig } from "./workspace-config";

vi.mock("./store", () => ({
  Store: { getSession: vi.fn(), saveSession: vi.fn() },
}));

const mockGetSession = vi.mocked(Store.getSession);
const mockSaveSession = vi.mocked(Store.saveSession);

const chatId = createMockChatConfigForDir("/tmp/instrument-test-task");
const sessionId = StoreId.newSessionId();

function storedSession(title: string): Session.Type {
  return { createdAt: new Date(0), id: sessionId, title };
}

describe("updateSessionTitle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveSession.mockReturnValue(okAsync(storedSession("saved")));
  });

  it("replaces when the stored title still matches expectedCurrentTitle", async () => {
    mockGetSession.mockReturnValue(okAsync(storedSession("Fix login bug")));

    await expect(
      updateSessionTitle({
        expectedCurrentTitle: "Fix login bug",
        sessionId,
        chatId,
        title: "Login bug fix",
      }),
    ).resolves.toBe(true);

    expect(mockSaveSession).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Login bug fix" }),
      chatId,
    );
  });

  it("skips when the user renamed while generation was in flight", async () => {
    mockGetSession.mockReturnValue(okAsync(storedSession("My cool app")));

    await expect(
      updateSessionTitle({
        expectedCurrentTitle: "Fix login bug",
        sessionId,
        chatId,
        title: "Login bug fix",
      }),
    ).resolves.toBe(false);

    expect(mockSaveSession).not.toHaveBeenCalled();
  });

  it("replaces an untitled session's title when no expected title is given", async () => {
    mockGetSession.mockReturnValue(okAsync(storedSession("Untitled chat")));

    await expect(
      updateSessionTitle({ sessionId, chatId, title: "Weather inquiry" }),
    ).resolves.toBe(true);

    expect(mockSaveSession).toHaveBeenCalled();
  });

  it("keeps a titled session's title when no expected title is given", async () => {
    mockGetSession.mockReturnValue(okAsync(storedSession("User title")));

    await expect(
      updateSessionTitle({ sessionId, chatId, title: "Weather inquiry" }),
    ).resolves.toBe(false);

    expect(mockSaveSession).not.toHaveBeenCalled();
  });

  it("returns false and captures the error when the save fails", async () => {
    mockGetSession.mockReturnValue(okAsync(storedSession("Fix login bug")));
    mockSaveSession.mockReturnValue(
      errAsync(new TypedError.Storage("disk full")),
    );
    const captureException = vi
      .spyOn(getWorkspaceConfig(), "captureException")
      .mockReturnValue(undefined);

    await expect(
      updateSessionTitle({
        expectedCurrentTitle: "Fix login bug",
        sessionId,
        chatId,
        title: "Login bug fix",
      }),
    ).resolves.toBe(false);

    expect(captureException).toHaveBeenCalled();
  });
});
