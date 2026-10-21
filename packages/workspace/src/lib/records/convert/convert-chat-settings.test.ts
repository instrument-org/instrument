import {
  SETTINGS_FILE_NAME,
  WORKSPACE_MACHINE_ENTRIES,
} from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { withTempDir } from "../../../test/helpers/temp-dir";
import { logFileName, settingsFileName } from "../file-names";
import { foldChatInFolder } from "../fold-folder";
import { recordLine } from "../record";
import { at, DEVICE_A, DEVICE_B, header, sessionId } from "../test-records";
import {
  convertChatSettings,
  convertChatSettingsFiles,
} from "./convert-chat-settings";

const root = withTempDir("convert-chat-settings");
const machine = withTempDir("convert-chat-settings-machine");

const MODEL =
  "openai/gpt-6.1-sol?provider=chatgpt-account&providerConfigId=mock-provider-config-id";

/** A chat whose own session has a log, with a `settings.json` beside it. */
async function chatWith(settings: string | undefined, name = "a-chat") {
  const dir = path.join(root.path, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, logFileName(sessionId(1), DEVICE_A)),
    recordLine(header(0, { device: DEVICE_A, id: sessionId(1) })),
  );
  if (settings !== undefined) {
    await fs.writeFile(path.join(dir, SETTINGS_FILE_NAME), settings);
  }
  return dir;
}

const OPTIONS = {
  deviceId: DEVICE_A,
  get machineDir() {
    return machine.path;
  },
};

async function modelIn(dir: string) {
  const chat = await foldChatInFolder(dir);
  return chat.sessions.find((session) => !session.parent)?.settings.model;
}

async function exists(file: string) {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}

describe("convertChatSettings", () => {
  it("carries the model onto the chat's own session and removes the file", async () => {
    const dir = await chatWith(
      JSON.stringify({
        lastActivityAt: at(5).toISOString(),
        modelURI: MODEL,
      }),
    );

    expect(await convertChatSettings(dir, OPTIONS)).toEqual({
      carried: ["its model"],
      kind: "converted",
    });
    expect(await modelIn(dir)).toMatchObject({
      at: at(5),
      device: DEVICE_A,
      value: MODEL,
    });
    expect(await exists(path.join(dir, SETTINGS_FILE_NAME))).toBe(false);
    expect(await convertChatSettings(dir, OPTIONS)).toEqual({
      kind: "nothing",
    });
  });

  it("leaves a model another device already set", async () => {
    const dir = await chatWith(JSON.stringify({ modelURI: MODEL }));
    await fs.writeFile(
      path.join(dir, settingsFileName(DEVICE_B)),
      recordLine({
        t: "set",
        seq: 0,
        at: at(9),
        session: sessionId(1),
        field: "model",
        value: "anthropic/claude-opus-5.5",
        device: DEVICE_B,
      }),
    );

    expect(await convertChatSettings(dir, OPTIONS)).toEqual({
      carried: [],
      kind: "converted",
    });
    expect((await modelIn(dir))?.value).toBe("anthropic/claude-opus-5.5");
  });

  it("moves what the chat allowed onto this computer, unless it already answers for the chat", async () => {
    const grant = {
      grantedAt: at(1).toISOString(),
      path: "/Users/someone/Trip",
      source: "card",
    };
    const one = await chatWith(JSON.stringify({ grants: [grant] }), "one");
    const two = await chatWith(JSON.stringify({ grants: [grant] }), "two");
    const permissions = path.join(
      machine.path,
      WORKSPACE_MACHINE_ENTRIES.permissions,
    );
    await fs.writeFile(
      permissions,
      JSON.stringify({ chats: { two: { grants: [] } }, folders: [] }),
    );

    expect(await convertChatSettings(one, OPTIONS)).toEqual({
      carried: ["what it allowed"],
      kind: "converted",
    });
    expect(await convertChatSettings(two, OPTIONS)).toEqual({
      carried: [],
      kind: "converted",
    });
    const written = JSON.parse(await fs.readFile(permissions, "utf8")) as {
      chats: Record<string, { grants: unknown[] }>;
      folders: unknown[];
    };
    expect(written.chats.one?.grants).toHaveLength(1);
    expect(written.chats.two?.grants).toEqual([]);
    expect(written.folders).toEqual([]);
  });

  it("moves where this device left off into its own state file", async () => {
    const dir = await chatWith(
      JSON.stringify({ state: { appGuidesRead: ["mail"], browserTabs: [] } }),
    );

    expect(await convertChatSettings(dir, OPTIONS)).toEqual({
      carried: ["where this device left off"],
      kind: "converted",
    });
    expect(
      JSON.parse(
        await fs.readFile(path.join(dir, `state.${DEVICE_A}.json`), "utf8"),
      ),
    ).toEqual({ browserTabs: [] });
  });

  it("leaves a chat with no records of its own for a later launch", async () => {
    const dir = path.join(root.path, "on-its-database");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, SETTINGS_FILE_NAME),
      JSON.stringify({ modelURI: MODEL }),
    );

    expect(await convertChatSettings(dir, OPTIONS)).toEqual({
      kind: "left",
      reason: "it has no records of its own yet",
    });
    expect(await exists(path.join(dir, SETTINGS_FILE_NAME))).toBe(true);
  });

  it("leaves a settings file it cannot read", async () => {
    const dir = await chatWith('{"modelURI": "openai/gp');

    expect(await convertChatSettings(dir, OPTIONS)).toEqual({
      kind: "left",
      reason: `${SETTINGS_FILE_NAME} cannot be read`,
    });
  });
});

describe("convertChatSettingsFiles", () => {
  it("says what it carried for each chat and what it left", async () => {
    await chatWith(JSON.stringify({ modelURI: MODEL }), "carried");
    await chatWith("{}", "empty");
    await chatWith("[]", "unreadable");
    await chatWith(undefined, "no-settings");

    expect(
      await convertChatSettingsFiles({
        chatsDir: root.path,
        deviceId: DEVICE_A,
        machineDir: machine.path,
      }),
    ).toEqual({
      done: [
        `carried: carried its model, removed ${SETTINGS_FILE_NAME}`,
        `empty: removed ${SETTINGS_FILE_NAME}`,
      ],
      left: [
        { reason: `${SETTINGS_FILE_NAME} cannot be read`, where: "unreadable" },
      ],
    });
  });
});
