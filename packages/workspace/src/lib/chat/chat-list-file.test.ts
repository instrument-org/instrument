import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { WorkspaceDirSchema } from "../../schemas/paths";
import { DEVICE_FILE_NAME } from "../records/device-file";
import { newDeviceId } from "../records/device-id";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { workspaceLayout } from "../workspace-layout";
import { CHAT_LIST_FILE_NAME, startChatListFile } from "./chat-list-file";
import { liveChatList } from "./live-chat-list";

vi.mock("./live-chat-list", () => ({
  liveChatList: vi.fn(async function* () {
    yield [];
  }),
}));

const previous = getWorkspaceConfig();
const device = newDeviceId();
let root: string;
let stop: AbortController;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "chat-list-file-"));
  setWorkspaceConfig({
    ...previous,
    deviceId: device,
    rootDir: WorkspaceDirSchema.parse(root),
  });
  stop = new AbortController();
});

afterEach(() => {
  stop.abort();
  setWorkspaceConfig(previous);
  fs.rmSync(root, { force: true, recursive: true });
});

/** Writes a device's `device.json` as its own app would. */
function says(id: string, platform: string) {
  const dir = path.join(workspaceLayout(root).devicesDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, DEVICE_FILE_NAME),
    JSON.stringify({ name: "A device", platform }),
  );
}

const file = () =>
  path.join(workspaceLayout(root).devicesDir, device, CHAT_LIST_FILE_NAME);

it("reads no chat on a workspace no phone has used", async () => {
  says(device, "darwin");

  startChatListFile({ signal: stop.signal });
  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(liveChatList).not.toHaveBeenCalled();
  expect(fs.existsSync(file())).toBe(false);
});

it("follows the list and writes the file once a phone has used it", async () => {
  says(device, "darwin");
  says(newDeviceId(), "ios");

  startChatListFile({ signal: stop.signal });

  await vi.waitFor(() => {
    expect(fs.existsSync(file())).toBe(true);
  });
  expect(liveChatList).toHaveBeenCalledTimes(1);
});
