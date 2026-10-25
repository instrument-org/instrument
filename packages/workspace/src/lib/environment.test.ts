import { AIGatewayProviderConfig } from "@instrument-org/ai-gateway/schemas";
import { describe, expect, it } from "vitest";

import { type Environment } from "../schemas/environment";
import { type SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { ChatIdSchema } from "../schemas/chat-id";
import { createMockAIGatewayModel } from "../test/helpers/mock-ai-gateway-model";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { ChatWrites } from "./chat-writes";
import {
  currentEnvironment,
  detectEnvironmentChange,
  environmentChange,
  lastToldEnvironment,
} from "./environment";
import { environmentChangeModelNote } from "./environment-model-text";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

const MAC: Environment = {
  appsFolder: "/Users/mytop/Instrument/.instrument/apps",
  computer: "macOS (darwin 25.6.0)",
  homeFolder: "/Users/mytop",
  outputFolder: "/Users/mytop/Instrument",
  platform: "darwin",
  timeZone: "America/Chicago",
  workspaceSkillsFolder: "/Users/mytop/Instrument/.instrument/skills",
};

const sessionId = StoreId.newSessionId();

function baseline(environment?: Environment): SessionMessage.ContextWithParts {
  const id = StoreId.newMessageId();
  const createdAt = new Date();
  return {
    id,
    metadata: {
      agentName: "instrument",
      createdAt,
      ...(environment && { environment }),
      realRole: "user",
      sessionId,
    },
    parts: [
      {
        metadata: {
          createdAt,
          id: StoreId.newPartId(),
          messageId: id,
          sessionId,
        },
        state: "done",
        text: "<system_info>…</system_info>",
        type: "text",
      },
    ],
    role: "session-context",
  };
}

function noted(change: Partial<Environment>): SessionMessage.UserWithParts {
  const id = StoreId.newMessageId();
  const createdAt = new Date();
  return {
    id,
    metadata: { createdAt, sessionId },
    parts: [
      {
        data: change,
        metadata: {
          createdAt,
          id: StoreId.newPartId(),
          messageId: id,
          sessionId,
        },
        type: "data-environmentChange",
      },
    ],
    role: "user",
  };
}

describe("environmentChange", () => {
  it("is nothing when every fact matches", () => {
    expect(environmentChange(MAC, { ...MAC })).toBeUndefined();
  });

  it("carries only the facts that differ, at their new values", () => {
    expect(
      environmentChange(MAC, {
        ...MAC,
        computer: "macOS (darwin 26.0.0)",
        timeZone: "Europe/Lisbon",
      }),
    ).toEqual({ computer: "macOS (darwin 26.0.0)", timeZone: "Europe/Lisbon" });
  });
});

describe("lastToldEnvironment", () => {
  it("lays every note since the baseline over what it recorded, in order", () => {
    const messages = [
      baseline(MAC),
      noted({ timeZone: "Europe/Lisbon" }),
      noted({ homeFolder: "/c/Users/windows-user", platform: "win32" }),
    ];

    expect(lastToldEnvironment(messages, sessionId)).toEqual({
      ...MAC,
      homeFolder: "/c/Users/windows-user",
      platform: "win32",
      timeZone: "Europe/Lisbon",
    });
  });

  it("ignores a note from before the baseline, which the baseline already holds", () => {
    const early = noted({ timeZone: "Asia/Tokyo" });

    expect(lastToldEnvironment([early, baseline(MAC)], sessionId)).toEqual(MAC);
  });

  it("is unknown for a baseline from before it recorded the computer", () => {
    expect(lastToldEnvironment([baseline()], sessionId)).toBeUndefined();
  });
});

describe("currentEnvironment", () => {
  // What the image model takes is per computer and per chat model, so it is
  // told here rather than in the tool's definition.
  it("names the image options for the chat's model among the connected providers", async () => {
    const model = createMockAIGatewayModel({
      providerConfigId: "image-capable",
    });
    const chatId = createMockChatConfig(ChatIdSchema.parse("env-image"), {
      model,
    });
    const none = (await currentEnvironment(chatId)).imageOptions;
    expect(none).toMatchInlineSnapshot(
      `"The selected image model accepts no additional parameters."`,
    );
    setWorkspaceConfig({
      ...getWorkspaceConfig(),
      getAIProviderConfigs: () => [
        AIGatewayProviderConfig.Schema.parse({
          apiKey: "key",
          cacheIdentifier: "test",
          id: "image-capable",
          type: "openai",
        }),
      ],
    });
    expect((await currentEnvironment(chatId, model.uri)).imageOptions)
      .toMatchInlineSnapshot(`
      "Optional image parameters supported by the selected model, passed as a \`parameters\` object:
      - quality: one of auto, low, medium, high
      Unsupported parameter names or values are ignored.
      This model has no size or aspect-ratio parameter; describe the desired dimensions, orientation, or framing directly in the prompt."
    `);
    expect((await currentEnvironment(chatId)).imageOptions).toBe(none);
  });
});

describe("environmentChangeModelNote", () => {
  it("tells a move to a Windows computer with that platform's guidance", () => {
    expect(
      environmentChangeModelNote({
        appsFolder: "/c/Users/windows-user/Instrument/.instrument/apps",
        computer: "Windows (win32 10.0.26200)",
        homeFolder: "/c/Users/windows-user",
        outputFolder: "/c/Users/windows-user/Instrument",
        platform: "win32",
        workspaceSkillsFolder:
          "/c/Users/windows-user/Instrument/.instrument/skills",
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      These facts about the computer changed since the system information above was written, which they supersede:
      - The computer: Windows (win32 10.0.26200)
      - The user's home folder: \`/c/Users/windows-user\`
      - The output folder (\`$INSTRUMENT_OUTPUT\`): \`/c/Users/windows-user/Instrument\`
      - The apps folder (\`$INSTRUMENT_APPS\`): \`/c/Users/windows-user/Instrument/.instrument/apps\`
      - The workspace's skills folder (\`$INSTRUMENT_WORKSPACE_SKILLS\`): \`/c/Users/windows-user/Instrument/.instrument/skills\`
      Paths named earlier in this conversation may belong to the computer it ran on before; check one before you rely on it.
      The shell spells a Windows path the POSIX way (\`C:\\Users\\sam\` is \`/c/Users/sam\`); when you name a path to the user, write it the Windows way. Paths you pass a program as arguments are converted, but paths written inside a script's own code are not: write those the Windows way. \`/tmp\` in the shell is the temp folder (\`%TEMP%\`); a script gets it from its language (\`tempfile.gettempdir()\`, \`os.tmpdir()\`, \`$env:TEMP\`) rather than writing \`/tmp\`. \`tasklist\` lists every process on the computer; a program you start (PowerShell's \`Get-Process\` included) may see only its own.
      </instrument-system-note>"
    `);
  });

  it("points paths named before a workspace move at the new folders", () => {
    expect(
      environmentChangeModelNote({
        outputFolder: "/Volumes/Archive/Instrument/Chats/Trip",
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      These facts about the computer changed since the system information above was written, which they supersede:
      - The output folder (\`$INSTRUMENT_OUTPUT\`): \`/Volumes/Archive/Instrument/Chats/Trip\`
      Paths named earlier in this conversation, such as the files the user sent, may point where these folders were before; look under the new ones instead.
      </instrument-system-note>"
    `);
  });

  it("tells the commands and image options this computer has now", () => {
    expect(
      environmentChangeModelNote({
        commands: "Your shell on this computer also has `ps`, `top`.",
        imageOptions:
          "Optional image parameters supported by the selected model, passed as a `parameters` object:\n- quality: one of low, high",
      }),
    ).toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      These facts about the computer changed since the system information above was written, which they supersede:
      - Commands beyond the bash tool's list:
      Your shell on this computer also has \`ps\`, \`top\`.
      - For \`generate_image\`: Optional image parameters supported by the selected model, passed as a \`parameters\` object:
      - quality: one of low, high
      </instrument-system-note>"
    `);
    expect(environmentChangeModelNote({ commands: "" })).toContain(
      "Your shell has only the commands the bash tool lists.",
    );
  });

  it("leaves out the warning about old paths when only the time zone moved", () => {
    expect(environmentChangeModelNote({ timeZone: "Europe/Lisbon" }))
      .toMatchInlineSnapshot(`
        "
        <instrument-system-note>
        These facts about the computer changed since the system information above was written, which they supersede:
        - Time zone: Western European Time
        </instrument-system-note>"
      `);
  });
});

describe("detectEnvironmentChange", () => {
  let chats = 0;

  /**
   * Stores what `history` returns for the computer this test runs on, then
   * asks what the next message should note. In a chat of its own, so the
   * session holds the history this case wrote and no other's.
   */
  async function detect(
    history: (here: Environment) => SessionMessage.WithParts[],
  ) {
    const chatId = createMockChatConfig(
      ChatIdSchema.parse(`environment-${++chats}`),
    );
    await ChatWrites.saveSession(
      { createdAt: new Date(), id: sessionId, title: "Test session" },
      chatId,
    );
    const here = await currentEnvironment();
    for (const message of history(here)) {
      await ChatWrites.saveMessageWithParts(message, chatId);
    }
    const result = await detectEnvironmentChange({
      chatId,
      messageId: StoreId.newMessageId(),
      runsOn: undefined,
      sessionId,
    });
    return { here, part: result._unsafeUnwrap() };
  }

  it("notes the facts that differ from what the chat was told on another computer", async () => {
    const { here, part } = await detect((current) => [
      baseline({
        ...current,
        computer: MAC.computer,
        homeFolder: MAC.homeFolder,
      }),
    ]);

    expect(part?.type).toBe("data-environmentChange");
    expect(part?.type === "data-environmentChange" && part.data).toEqual({
      computer: here.computer,
      homeFolder: here.homeFolder,
    });
  });

  it("says nothing once a note has told the computer it runs on", async () => {
    const { part } = await detect((current) => [
      baseline({ ...current, computer: MAC.computer }),
      noted({ computer: current.computer }),
    ]);

    expect(part).toBeUndefined();
  });
});
