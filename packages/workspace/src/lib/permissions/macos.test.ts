import { describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { getWorkspaceConfig } from "../workspace-config";
import {
  macAppStanding,
  macosGuardedRoot,
  noteMacosFolderAnswer,
  raiseMacosAsking,
  setMacosForwarder,
} from "./macos";

vi.mock(import("../workspace-config"), () => ({
  getWorkspaceConfig: vi.fn(),
}));

describe("macAppStanding", () => {
  it("reads a check macOS holds back as its prompt being up", async () => {
    // `as`: a config with the one key this reads, not a whole one.
    vi.mocked(getWorkspaceConfig).mockReturnValue({
      // macOS holds the check while its prompt for the app is up.
      macAppAccess: () => new Promise(() => {}),
    } as unknown as ReturnType<typeof getWorkspaceConfig>);

    expect(
      await macAppStanding({ bundleId: "com.apple.Notes", name: "Notes" }),
    ).toBe("not-asked");
  });
});

// Once set, the forwarder stays for the rest of the file, which reads
// nothing it forwards.
describe("in the bash worker", () => {
  it("sends what its shell learns of macOS to the main thread", async () => {
    const asking = vi.fn();
    const folderAnswer = vi.fn();
    setMacosForwarder({ asking, folderAnswer });
    const asker = {
      chatId: ChatIdSchema.parse("test-chat"),
      sessionId: StoreId.newSessionId(),
    };

    await raiseMacosAsking(asker, "/Users/mac-user/Downloads");
    noteMacosFolderAnswer("/Users/mac-user/Downloads/a.pdf", "denied");

    expect(asking).toHaveBeenCalledWith(asker, "/Users/mac-user/Downloads");
    expect(folderAnswer).toHaveBeenCalledWith(
      "/Users/mac-user/Downloads/a.pdf",
      "denied",
    );
  });
});

describe("macosGuardedRoot", () => {
  const home = "/Users/mac-user";

  it.each([
    ["/Users/mac-user/Desktop", "/Users/mac-user/Desktop"],
    ["/Users/mac-user/Documents/Pricing/q3.csv", "/Users/mac-user/Documents"],
    ["/Users/mac-user/Downloads/invoice.pdf", "/Users/mac-user/Downloads"],
    [
      "/Users/mac-user/Library/Mobile Documents/com~apple~CloudDocs/Notes",
      "/Users/mac-user/Library/Mobile Documents",
    ],
    ["/Volumes/Backup/Photos", "/Volumes/Backup"],
    ["/Users/mac-user/Library/Mail", undefined],
    ["/Users/mac-user/Desktopper", undefined],
    ["/Users/mac-user/code", undefined],
  ])("%s is guarded by %s", (hostPath, root) => {
    expect(macosGuardedRoot(hostPath, { home, platform: "darwin" })).toBe(root);
  });

  it("guards nothing off macOS", () => {
    expect(
      macosGuardedRoot("/Users/mac-user/Desktop", { home, platform: "linux" }),
    ).toBeUndefined();
  });
});
