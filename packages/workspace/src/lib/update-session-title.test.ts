import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Session } from "../schemas/session";
import { StoreId } from "../schemas/store-id";
import { createMockTaskConfigForDir } from "../test/helpers/mock-task-config";
import { TypedError } from "./errors";
import { isSessionTitleAutoReplaceable } from "./generate-session-title";
import { Store } from "./store";
import { updateSessionTitle } from "./update-session-title";
import { getWorkspaceConfig } from "./workspace-config";

vi.mock("./store", () => ({
  Store: { getSession: vi.fn(), saveSession: vi.fn() },
}));
vi.mock("./generate-session-title", () => ({
  isSessionTitleAutoReplaceable: vi.fn(),
}));

const mockGetSession = vi.mocked(Store.getSession);
const mockSaveSession = vi.mocked(Store.saveSession);
const mockIsAutoReplaceable = vi.mocked(isSessionTitleAutoReplaceable);

const taskId = createMockTaskConfigForDir("/tmp/instrument-test-task");
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
        taskId,
        title: "Login bug fix",
      }),
    ).resolves.toBe(true);

    expect(mockSaveSession).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Login bug fix" }),
      taskId,
    );
    // Snapshot check short-circuits the settings-name heuristic entirely.
    expect(mockIsAutoReplaceable).not.toHaveBeenCalled();
  });

  it("skips when the user renamed while generation was in flight", async () => {
    mockGetSession.mockReturnValue(okAsync(storedSession("My cool app")));

    await expect(
      updateSessionTitle({
        expectedCurrentTitle: "Fix login bug",
        sessionId,
        taskId,
        title: "Login bug fix",
      }),
    ).resolves.toBe(false);

    expect(mockSaveSession).not.toHaveBeenCalled();
  });

  it("falls back to isSessionTitleAutoReplaceable when no expected title is given", async () => {
    mockGetSession.mockReturnValue(okAsync(storedSession("Untitled chat")));
    mockIsAutoReplaceable.mockResolvedValue(true);

    await expect(
      updateSessionTitle({ sessionId, taskId, title: "Weather inquiry" }),
    ).resolves.toBe(true);

    expect(mockIsAutoReplaceable).toHaveBeenCalledWith({
      taskId,
      title: "Untitled chat",
    });
    expect(mockSaveSession).toHaveBeenCalled();
  });

  it("returns false without saving when the fallback guard rejects", async () => {
    mockGetSession.mockReturnValue(okAsync(storedSession("User title")));
    mockIsAutoReplaceable.mockResolvedValue(false);

    await expect(
      updateSessionTitle({ sessionId, taskId, title: "Weather inquiry" }),
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
        taskId,
        title: "Login bug fix",
      }),
    ).resolves.toBe(false);

    expect(captureException).toHaveBeenCalled();
  });
});
