import { SETTINGS_FILE_NAME } from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { withTempDir } from "../../../test/helpers/temp-dir";
import { chatFolderNames } from "../../chat-folders/own-folder";
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

describe("convertChatSettings", () => {
  it("carries the model onto the chat's own session, once", async () => {
    const dir = await chatWith(
      JSON.stringify({
        lastActivityAt: at(5).toISOString(),
        modelURI: MODEL,
      }),
    );

    expect(await convertChatSettings(dir, OPTIONS)).toEqual({
      carried: ["its model"],
      kind: "carried",
    });
    expect(await modelIn(dir)).toMatchObject({
      at: at(5),
      device: DEVICE_A,
      value: MODEL,
    });
    expect(await convertChatSettings(dir, OPTIONS)).toEqual({
      kind: "nothing",
    });
  });

  it("records the folder's name on this computer, unless it has one", async () => {
    const dir = await chatWith(JSON.stringify({ folder: "Trip plans" }));

    expect(await convertChatSettings(dir, OPTIONS)).toEqual({
      carried: ["its folder's name"],
      kind: "carried",
    });
    expect(chatFolderNames(machine.path).get("a-chat")).toBe("Trip plans");

    await fs.writeFile(
      path.join(dir, SETTINGS_FILE_NAME),
      JSON.stringify({ folder: "Older name" }),
    );
    expect(await convertChatSettings(dir, OPTIONS)).toEqual({
      kind: "nothing",
    });
    expect(chatFolderNames(machine.path).get("a-chat")).toBe("Trip plans");
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
      kind: "nothing",
    });
    expect((await modelIn(dir))?.value).toBe("anthropic/claude-opus-5.5");
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
    await chatWith("[]", "unreadable");
    await chatWith(undefined, "no-settings");

    expect(
      await convertChatSettingsFiles({
        chatsDir: root.path,
        deviceId: DEVICE_A,
        machineDir: machine.path,
      }),
    ).toEqual({
      done: ["carried: carried its model"],
      left: [
        { reason: `${SETTINGS_FILE_NAME} cannot be read`, where: "unreadable" },
      ],
    });
  });
});
