import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { appRefusal, grantApp } from "./apps";
import { setDenied } from "./denials";
import { updatePermissionSettings } from "./rules";

// What the agent is told when it reaches for one of the person's Mac apps:
// a "Not now" in this chat holds by the app's name or its bundle id, and
// only an Always allow outranks it.
const app = { bundleId: "com.apple.mail", name: "Mail" };
const chat = ChatIdSchema.parse("chat-a");
const other = ChatIdSchema.parse("chat-b");

beforeEach(() => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "app-perms-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(rootDir),
    workspaceMachineDir: AbsolutePathSchema.parse(`${rootDir}-machine`),
  });
});

const settingFor = (level: "allow" | "never") =>
  updatePermissionSettings((settings) => ({
    ...settings,
    apps: [{ addedAt: new Date(), level, name: "Mail" }],
  }));

const NOT_NOW =
  "the person said not now to Mail in this chat. Don't look for another way to use it; say what you skipped without it.";

describe("appRefusal", () => {
  it.each([
    ["its name, spelled differently", " mail"],
    ["its bundle id", "com.apple.mail"],
  ])("holds a Not now given by %s, in that chat only", async (_, target) => {
    await setDenied(chat, "app", target, true);
    expect(await appRefusal(chat, app, undefined)).toBe(NOT_NOW);
    expect(await appRefusal(other, app, undefined)).toBe(
      "using Mail needs the person's yes first.",
    );
  });

  it("holds a Not now over the chat's own earlier grant", async () => {
    // By bundle id, which answers itself rather than asking Spotlight.
    await grantApp(chat, "com.apple.mail");
    expect(await appRefusal(chat, app, undefined)).toBeUndefined();
    await setDenied(chat, "app", "Mail", true);
    expect(await appRefusal(chat, app, undefined)).toBe(NOT_NOW);
  });

  it("lets an Always allow in Settings outrank a chat's Not now", async () => {
    await setDenied(chat, "app", "Mail", true);
    await settingFor("allow");
    expect(await appRefusal(chat, app, undefined)).toBeUndefined();
  });

  it("says Settings closed it when no chat said Not now", async () => {
    await settingFor("never");
    expect(await appRefusal(chat, app, undefined)).toBe(
      "Mail is marked Not allowed in Settings › Permissions, so Instrument won't use it. Tell the person what you skipped.",
    );
  });

  it("takes back a Not now when the person allows the app later", async () => {
    await setDenied(chat, "app", "Mail", true);
    await setDenied(chat, "app", "Mail", false);
    expect(await appRefusal(chat, app, undefined)).toBe(
      "using Mail needs the person's yes first.",
    );
  });
});
