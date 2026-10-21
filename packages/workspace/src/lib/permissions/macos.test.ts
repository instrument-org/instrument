import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { getWorkspaceConfig } from "../workspace-config";
import {
  macAppStanding,
  macosGuardedRoot,
  noteMacosFolderAnswer,
  setMacosForwarder,
  watchForMacosAsking,
  watchMacosPrompt,
} from "./macos";

vi.mock(import("../workspace-config"), () => ({
  getWorkspaceConfig: vi.fn(),
}));

/** A config with only the Mac keys these read. */
function macConfig(config: {
  macAppAccess?: () => Promise<"allowed">;
  macosPromptOnScreen?: () => Promise<boolean>;
}) {
  // `as`: a config with the keys this reads, not a whole one.
  vi.mocked(getWorkspaceConfig).mockReturnValue(
    config as unknown as ReturnType<typeof getWorkspaceConfig>,
  );
}

/** What `promise` settled to within `ms`, or "pending". */
const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, sleep(ms).then(() => "pending" as const)]);

describe("watchMacosPrompt", () => {
  it("raises nothing for a slow look while no prompt is on screen", async () => {
    macConfig({ macosPromptOnScreen: () => Promise.resolve(false) });
    const onAsking = vi.fn(() => Promise.resolve());

    expect(await watchMacosPrompt(sleep(700), onAsking)).toBe(false);
    expect(onAsking).not.toHaveBeenCalled();
  });

  it("says macOS is asking once its prompt shows while the look waits", async () => {
    macConfig({ macosPromptOnScreen: () => Promise.resolve(true) });
    const onAsking = vi.fn(() => Promise.resolve());

    expect(await watchMacosPrompt(new Promise(() => {}), onAsking)).toBe(true);
    expect(onAsking).toHaveBeenCalledTimes(1);
  });

  it("asks nothing of the window list for a look that answers at once", async () => {
    const onScreen = vi.fn(() => Promise.resolve(true));
    macConfig({ macosPromptOnScreen: onScreen });

    expect(await watchMacosPrompt(Promise.resolve(), vi.fn())).toBe(false);
    expect(onScreen).not.toHaveBeenCalled();
  });
});

describe("macAppStanding", () => {
  it("reads a check macOS holds back as its prompt being up, when the prompt is on screen", async () => {
    macConfig({
      // macOS holds the check while its prompt for the app is up.
      macAppAccess: () => new Promise(() => {}),
      macosPromptOnScreen: () => Promise.resolve(true),
    });

    expect(
      await macAppStanding({ bundleId: "com.apple.Notes", name: "Notes" }),
    ).toBe("not-asked");
  });

  it("does not read a slow check as asking with no prompt on screen", async () => {
    macConfig({
      macAppAccess: () => new Promise(() => {}),
      macosPromptOnScreen: () => Promise.resolve(false),
    });

    expect(
      await within(
        macAppStanding({ bundleId: "com.apple.Notes", name: "Notes" }),
        700,
      ),
    ).toBe("pending");
  });
});

// Once set, the forwarder stays for the rest of the file, which reads
// nothing it forwards.
describe("in the bash worker", () => {
  it("sends what its shell learns of macOS to the main thread", () => {
    const watch = vi.fn();
    const unwatch = vi.fn();
    const folderAnswer = vi.fn();
    setMacosForwarder({ folderAnswer, unwatch, watch });
    const asker = {
      chatId: ChatIdSchema.parse("test-chat"),
      sessionId: StoreId.newSessionId(),
    };

    const stop = watchForMacosAsking(asker, "/Users/mac-user/Downloads");
    stop();
    noteMacosFolderAnswer("/Users/mac-user/Downloads/a.pdf", "denied");

    expect(watch).toHaveBeenCalledWith(
      expect.any(String),
      asker,
      "/Users/mac-user/Downloads",
    );
    expect(unwatch).toHaveBeenCalledWith(watch.mock.calls[0]?.[0]);
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
