import { beforeEach, describe, expect, it, vi } from "vitest";

import { agentSettings } from "./agent-settings";

const { kept, machine, workspace } = vi.hoisted(() => ({
  kept: new Map<string, unknown>(),
  machine: new Map<string, unknown>(),
  workspace: new Map<string, unknown>(),
}));

vi.mock("@/electron-main/stores/machine/preferences", () => ({
  getMachinePreferences: () => machine,
}));
vi.mock("@/electron-main/stores/workspace/preferences", async () => {
  const { z } = await import("zod");
  return {
    AgentCompletionNotificationModeSchema: z.enum([
      "always",
      "unfocused",
      "never",
    ]),
    getWorkspacePreferences: () => workspace,
    WorkspacePreferencesSchema: z.object({
      theme: z.enum(["light", "dark", "system"]),
    }),
  };
});
vi.mock("@/electron-main/stores/workspace/kept-state", () => ({
  changeKeptState: (_file: string, key: string, value: unknown) => {
    kept.set(key, value);
  },
  getKeptState: (_file: string, key: string) => kept.get(key),
}));
vi.mock("./list-microphones", () => ({
  microphones: () =>
    Promise.resolve([
      { deviceId: "a", label: "Desk Mic (046d:0ab1)" },
      { deviceId: "b", label: "Headset" },
    ]),
}));

const valueOf = async (id: string) =>
  (await agentSettings.list()).find((each) => each.id === id)?.value;

beforeEach(() => {
  kept.clear();
  machine.clear();
  workspace.clear();
  workspace.set("theme", "system");
  workspace.set("agentCompletionNotifications", "unfocused");
});

describe("agentSettings", () => {
  it.each([
    ["theme", "Dark", "dark", "Dark"],
    ["zoom", "125", "125%", "125%"],
    ["notifications", "not focused", "unfocused", "Not focused"],
    ["dictation-language", "french", "fr", "French"],
    ["dictation-language", "auto", "auto", "Auto-detect"],
    ["dictation-microphone", "desk mic", "Desk Mic", "Desk Mic"],
    ["dictation-microphone", "default", "default", "System default"],
    ["dictation-sounds", "off", "off", "Off"],
    ["block-ads", "on", "on", "On"],
    ["bookmarks-bar", "on", "on", "On"],
    ["offer-feedback", "off", "off", "Off"],
    ["suggest-next-message", "on", "on", "On"],
  ])("sets %s to %s", async (id, asked, value, label) => {
    await agentSettings.set(id, asked);
    expect(await valueOf(id)).toEqual({ label, value });
  });

  it.each([
    ["zoom", "900%"],
    ["zoom", "bigger"],
    ["theme", "blue"],
    ["dictation-microphone", "Kazoo"],
    ["keep-history", "off"],
    ["share-activity", "on"],
    ["send-error-reports", "on"],
    ["nothing", "on"],
  ])("refuses %s as %s", async (id, value) => {
    await expect(agentSettings.set(id, value)).rejects.toThrow(
      /takes|user's|no setting/,
    );
  });

  it("keeps a microphone as dictation finds it again", async () => {
    await agentSettings.set("dictation-microphone", "Headset");
    expect(machine.get("dictationMicrophone")).toEqual({
      deviceId: "b",
      label: "Headset",
    });
  });
});
